import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { generateReply, replyToInstagramLoginMessage } from '../services/autoReplyService.js';
import { getInstagramLoginAccounts, getInstagramLoginToken, } from '../services/instagramAccountRegistry.js';
import { recordOptOutIfRequested, recordOutreachOptIn } from '../services/outreachConsentService.js';
const enabled = process.env.IG_DM_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.IG_DM_POLL_CRON ?? '*/1 * * * *';
const conversationLimit = Math.max(Number(process.env.IG_DM_CONVERSATION_LIMIT ?? 10), 1);
const messageLimit = Math.max(Number(process.env.IG_DM_MESSAGE_LIMIT ?? 10), 1);
const startAtMs = Date.parse(process.env.IG_DM_POLL_START_AT ?? new Date().toISOString());
const processedInMemory = new Set();
const withinWindow = (createdAt) => {
    const createdAtMs = Date.parse(createdAt ?? '');
    if (!Number.isFinite(createdAtMs))
        return false;
    return createdAtMs >= startAtMs;
};
const isAlreadyExistsError = (error) => {
    const err = error;
    return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};
const fetchConversations = async (accessToken) => {
    const response = await axios.get('https://graph.instagram.com/me/conversations', {
        params: {
            fields: `id,updated_time,participants,messages.limit(${messageLimit}){id,created_time,from,message}`,
            limit: conversationLimit,
            access_token: accessToken,
        },
        timeout: 30000,
    });
    return Array.isArray(response.data?.data) ? response.data.data : [];
};
const upsertReplyStatus = async (docRef, status, error) => {
    const update = {
        replyStatus: status,
        replyAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (error)
        update.replyError = error;
    await docRef.set(update, { merge: true });
};
const reserveMessage = async (target, message) => {
    const messageId = String(message.id ?? '').trim();
    const memoryKey = `${target.key}:${messageId}`;
    if (!messageId || processedInMemory.has(memoryKey))
        return null;
    processedInMemory.add(memoryKey);
    const text = String(message.message ?? '').trim();
    if (!text)
        return null;
    const senderId = String(message.from?.id ?? '').trim();
    const senderUsername = String(message.from?.username ?? '').trim().toLowerCase();
    if (!senderId || senderUsername === target.username.toLowerCase())
        return null;
    if (!withinWindow(message.created_time))
        return null;
    await recordOutreachOptIn({
        platform: 'instagram',
        recipientId: senderId,
        ownerId: target.userId,
        source: 'dm',
        text,
        metadata: { accountKey: target.key, senderUsername },
    }).catch(error => console.warn('[ig-dm-poll] opt-in record failed', error.message));
    await recordOptOutIfRequested({
        platform: 'instagram',
        recipientId: senderId,
        ownerId: target.userId,
        text,
    }).catch(error => console.warn('[ig-dm-poll] opt-out record failed', error.message));
    const docRef = firestore.collection('messages').doc(`instagram_dm_${target.key}_${messageId}`);
    const payload = {
        platform: 'instagram',
        type: 'dm',
        senderId,
        senderUsername: senderUsername || null,
        text,
        ownerId: target.userId,
        accountId: target.username,
        targetKey: target.key,
        source: 'instagram-login-poller',
        replyStatus: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        await docRef.create(payload);
    }
    catch (error) {
        if (isAlreadyExistsError(error))
            return null;
        console.warn('[ig-dm-poll] Firestore reservation failed; skipping reply to avoid duplicates', error.message);
        return null;
    }
    return { docRef, senderId, text };
};
export const pollInstagramDmsOnce = async () => {
    const targets = getInstagramLoginAccounts().map((target) => ({ target, accessToken: getInstagramLoginToken(target) })).filter(({ accessToken }) => Boolean(accessToken));
    if (targets.length === 0) {
        console.warn('[ig-dm-poll] no Instagram Login tokens configured; polling skipped');
        return;
    }
    for (const { target, accessToken } of targets) {
        try {
            const conversations = await fetchConversations(accessToken);
            for (const conversation of conversations) {
                const messages = conversation.messages?.data ?? [];
                for (const message of messages.reverse()) {
                    const reserved = await reserveMessage(target, message);
                    if (!reserved)
                        continue;
                    try {
                        const reply = await generateReply(reserved.text, 'instagram', target.userId, 'message', { username: target.username });
                        await replyToInstagramLoginMessage(reserved.senderId, reply, accessToken);
                        await upsertReplyStatus(reserved.docRef, 'sent');
                    }
                    catch (error) {
                        await upsertReplyStatus(reserved.docRef, 'failed', error.message).catch(() => undefined);
                        console.warn(`[ig-dm-poll] ${target.key} reply failed`, error.message);
                    }
                }
            }
        }
        catch (error) {
            console.warn(`[ig-dm-poll] ${target.key} poll failed`, error.message);
        }
    }
};
export function scheduleInstagramDmPollJob() {
    if (!enabled) {
        console.info('[ig-dm-poll] disabled');
        return;
    }
    cron.schedule(scheduleExpression, async () => {
        await pollInstagramDmsOnce();
    });
    console.info(`[ig-dm-poll] job scheduled (${scheduleExpression}) for ${getInstagramLoginAccounts().length} accounts.`);
    if (process.env.IG_DM_POLL_ON_STARTUP === 'true') {
        void pollInstagramDmsOnce();
    }
}
scheduleInstagramDmPollJob();

import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { generateReply, replyToThreadsComment } from '../services/autoReplyService.js';
import { supabaseFallbackService } from '../services/supabaseFallbackService.js';
const GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';
const enabled = process.env.THREADS_COMMENT_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.THREADS_COMMENT_POLL_CRON ?? '*/1 * * * *';
const threadLimit = Math.max(Number(process.env.THREADS_COMMENT_THREAD_LIMIT ?? 8), 1);
const replyLimit = Math.max(Number(process.env.THREADS_COMMENT_LIMIT ?? 25), 1);
const windowHours = Math.max(Number(process.env.THREADS_COMMENT_WINDOW_HOURS ?? 24), 1);
const CLIENT_POLL_USER_IDS = [
    '1zvY9nNyXMcfxdPQEyx0bIdK7r53',
    'acmVetCcOiTHeGk5D7eDYieamDF3',
    'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    'vzdH1DnfFLVjlY8bBgC26WACmmw2',
];
const isAlreadyExistsError = (error) => {
    const err = error;
    return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};
const shouldRetryExisting = (data) => {
    if (!data)
        return true;
    const status = data.replyStatus;
    if (status === 'sent' || status === 'pending')
        return false;
    if (status !== 'failed')
        return true;
    const retryDelayMs = Math.max(Number(process.env.META_COMMENT_RETRY_DELAY_MS ?? 300000), 0);
    if (!retryDelayMs)
        return true;
    const replyAtMs = typeof data.replyAt?.toMillis === 'function'
        ? data.replyAt.toMillis()
        : typeof data.replyAt?.toDate === 'function'
            ? data.replyAt.toDate().getTime()
            : 0;
    return !replyAtMs || Date.now() - replyAtMs >= retryDelayMs;
};
const withinWindow = (timestamp) => {
    if (!timestamp)
        return true;
    const createdAt = new Date(timestamp).getTime();
    if (!Number.isFinite(createdAt))
        return true;
    return Date.now() - createdAt <= windowHours * 60 * 60 * 1000;
};
const fetchRecentThreads = async (target) => {
    const response = await axios.get(`${GRAPH_BASE_URL}/${GRAPH_VERSION}/${target.accountId}/threads`, {
        params: {
            fields: 'id,timestamp,is_reply',
            limit: threadLimit,
            access_token: target.accessToken,
        },
        timeout: 30000,
    });
    return (response.data?.data ?? []).filter(item => item.id && !item.is_reply);
};
const fetchReplies = async (threadId, accessToken) => {
    const response = await axios.get(`${GRAPH_BASE_URL}/${GRAPH_VERSION}/${threadId}/replies`, {
        params: {
            fields: 'id,text,timestamp,username,is_reply_owned_by_me',
            limit: replyLimit,
            access_token: accessToken,
        },
        timeout: 30000,
    });
    return response.data?.data ?? [];
};
const upsertReplyStatus = async (docRef, status, error) => {
    const update = {
        replyStatus: status,
        replyAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (error)
        update.replyError = error;
    await docRef.update(update);
};
const reserveReply = async (reply, threadId, target) => {
    const replyId = reply.id;
    const text = reply.text?.trim();
    if (!replyId || !text)
        return null;
    if (reply.is_reply_owned_by_me)
        return null;
    if (target.username && reply.username?.toLowerCase() === target.username.toLowerCase())
        return null;
    if (!withinWindow(reply.timestamp))
        return null;
    const docRef = firestore.collection('messages').doc(`threads_reply_${replyId}`);
    try {
        await docRef.create({
            platform: 'threads',
            type: 'comment',
            senderId: reply.username ?? null,
            text,
            commentId: replyId,
            postId: threadId,
            ownerId: target.userId,
            accountId: target.accountId,
            source: 'poller',
            replyStatus: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { docRef, text, replyId };
    }
    catch (error) {
        if (!isAlreadyExistsError(error))
            throw error;
        const snap = await docRef.get();
        if (!shouldRetryExisting(snap.data()))
            return null;
        await docRef.set({
            platform: 'threads',
            type: 'comment',
            senderId: reply.username ?? null,
            text,
            commentId: replyId,
            postId: threadId,
            ownerId: target.userId,
            accountId: target.accountId,
            source: 'poller',
            replyStatus: 'pending',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { docRef, text, replyId };
    }
};
const processReply = async (reply, threadId, target) => {
    const reserved = await reserveReply(reply, threadId, target);
    if (!reserved)
        return;
    try {
        const response = await generateReply(reserved.text, 'threads', target.userId, 'comment');
        await replyToThreadsComment(reserved.replyId, response, {
            accountId: target.accountId,
            accessToken: target.accessToken,
        });
        await upsertReplyStatus(reserved.docRef, 'sent');
    }
    catch (error) {
        await upsertReplyStatus(reserved.docRef, 'failed', error.message);
        console.warn('[threads-comment-poll] reply failed', error.message);
    }
};
const loadClientTargets = async () => {
    const configuredIds = (process.env.THREADS_COMMENT_POLL_USER_IDS ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    const userIds = Array.from(new Set([...CLIENT_POLL_USER_IDS, ...configuredIds]));
    const targets = [];
    await Promise.all(userIds.map(async (userId) => {
        try {
            const snap = await firestore.collection('users').doc(userId).get();
            const threads = snap.data()
                ?.socialAccounts?.threads;
            if (threads?.accountId && threads.accessToken) {
                targets.push({
                    userId,
                    accountId: threads.accountId,
                    accessToken: threads.accessToken,
                    username: threads.username,
                });
                return;
            }
        }
        catch (error) {
            console.warn('[threads-comment-poll] Firestore target lookup failed', userId, error.message);
        }
        try {
            const fallback = await supabaseFallbackService.getSocialAccounts(userId);
            const threads = fallback?.socialAccounts
                ?.threads;
            if (threads?.accountId && threads.accessToken) {
                targets.push({
                    userId,
                    accountId: threads.accountId,
                    accessToken: threads.accessToken,
                    username: threads.username,
                });
            }
        }
        catch (error) {
            console.warn('[threads-comment-poll] Supabase target lookup failed', userId, error.message);
        }
    }));
    const seen = new Set();
    return targets.filter(target => {
        const key = `${target.accountId}:${target.accessToken}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
};
export const pollThreadsCommentsOnce = async () => {
    const targets = await loadClientTargets();
    if (!targets.length) {
        console.warn('[threads-comment-poll] missing Threads credentials; polling skipped');
        return;
    }
    for (const target of targets) {
        try {
            const threads = await fetchRecentThreads(target);
            for (const thread of threads) {
                const replies = await fetchReplies(thread.id, target.accessToken);
                for (const reply of replies) {
                    await processReply(reply, thread.id, target);
                }
            }
        }
        catch (error) {
            console.warn('[threads-comment-poll] poll failed', {
                accountId: target.accountId,
                error: error.message,
            });
        }
    }
};
export function scheduleThreadsCommentPollJob() {
    if (!enabled) {
        console.info('[threads-comment-poll] disabled');
        return;
    }
    cron.schedule(scheduleExpression, async () => {
        await pollThreadsCommentsOnce();
    });
    console.info(`[threads-comment-poll] job scheduled (${scheduleExpression}).`);
    if (process.env.META_COMMENT_POLL_ON_STARTUP === 'true') {
        void pollThreadsCommentsOnce();
    }
}
scheduleThreadsCommentPollJob();

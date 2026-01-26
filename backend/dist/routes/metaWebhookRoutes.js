import { Router } from 'express';
import admin from 'firebase-admin';
import { generateReply, replyToFacebookComment, replyToInstagramComment, replyToInstagramMessage, replyToFacebookMessage, likeInstagramComment, likeFacebookComment, } from '../services/autoReplyService.js';
import { incrementEngagementAnalytics, incrementInboundAnalytics } from '../services/analyticsService.js';
import fs from 'fs';
import path from 'path';
import { firestore } from '../db/firestore.js';
const router = Router();
const verifyToken = process.env.META_VERIFY_TOKEN ?? process.env.VERIFY_TOKEN;
const igBusinessId = process.env.INSTAGRAM_BUSINESS_ID;
const pageId = process.env.FACEBOOK_PAGE_ID;
const logFile = path.join(process.cwd(), 'meta-webhook.log');
const resolvePlatformContext = async (platform, entryId) => {
    if (!entryId)
        return null;
    const field = platform === 'instagram' ? 'accountId' : 'pageId';
    try {
        const snap = await firestore
            .collection('users')
            .where(`socialAccounts.${platform}.${field}`, '==', entryId)
            .limit(1)
            .get();
        if (snap.empty)
            return null;
        const doc = snap.docs[0];
        const data = doc.data();
        const account = data.socialAccounts?.[platform] ?? {};
        return {
            userId: doc.id,
            orgId: data.orgId,
            accessToken: account.accessToken,
            accountId: account.accountId,
            pageId: account.pageId,
        };
    }
    catch (error) {
        console.warn('[meta-webhook] failed to resolve user context', error.message);
        return null;
    }
};
const buildDedupeKey = (platform, type, id) => {
    if (!id)
        return undefined;
    return `${platform}_${type}_${id}`;
};
const isAlreadyExistsError = (error) => {
    const err = error;
    return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};
const timestampToMs = (value) => {
    if (!value)
        return null;
    if (typeof value === 'number')
        return value;
    const maybe = value;
    if (typeof maybe.toMillis === 'function')
        return maybe.toMillis();
    if (typeof maybe.toDate === 'function')
        return maybe.toDate().getTime();
    return null;
};
const shouldSkipExistingReply = (existing) => {
    if (!existing)
        return false;
    const status = existing.replyStatus;
    if (status === 'sent' || status === 'pending')
        return true;
    if (status !== 'failed')
        return false;
    const retryDelayMs = Math.max(Number(process.env.META_COMMENT_RETRY_DELAY_MS ?? 300000), 0);
    if (!retryDelayMs)
        return false;
    const replyAtMs = timestampToMs(existing.replyAt);
    if (!replyAtMs)
        return true;
    return Date.now() - replyAtMs < retryDelayMs;
};
const logEvent = (message, payload) => {
    const line = `[${new Date().toISOString()}] ${message} ${payload ? JSON.stringify(payload).slice(0, 2000) : ''}\n`;
    console.info(line.trim());
    try {
        fs.appendFileSync(logFile, line);
    }
    catch {
        // ignore file logging failures
    }
};
const saveInbound = async (event) => {
    try {
        const docRef = await firestore.collection('messages').add({
            ...event,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            replyStatus: 'pending',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const analyticsScope = event.scopeId ? { scopeId: event.scopeId } : undefined;
        try {
            if (event.type === 'dm') {
                await incrementInboundAnalytics({ messages: 1 }, analyticsScope);
            }
            else {
                await incrementEngagementAnalytics({ commentsDetected: 1 }, analyticsScope);
            }
        }
        catch (error) {
            console.warn('Failed to update analytics for inbound event', error.message);
        }
        return docRef;
    }
    catch (err) {
        console.warn('Failed to persist inbound webhook event', err.message);
        return null;
    }
};
const reserveInbound = async (event) => {
    const dedupeKey = buildDedupeKey(event.platform, event.type, event.commentId);
    if (!dedupeKey) {
        const ref = await saveInbound(event);
        return { ref, shouldProcess: true };
    }
    const ref = firestore.collection('messages').doc(dedupeKey);
    const payload = {
        ...event,
        replyStatus: 'pending',
        dedupeKey,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        await ref.create(payload);
        return { ref, shouldProcess: true };
    }
    catch (error) {
        if (!isAlreadyExistsError(error))
            throw error;
        const snap = await ref.get();
        const existing = snap.exists ? snap.data() : null;
        if (shouldSkipExistingReply(existing)) {
            return { ref, shouldProcess: false };
        }
        await ref.set({
            ...event,
            replyStatus: 'pending',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { ref, shouldProcess: true };
    }
};
const updateReplyStatus = async (ref, status, error) => {
    if (!ref)
        return;
    const update = {
        replyStatus: status,
        replyAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (error) {
        update.replyError = error;
    }
    try {
        await ref.update(update);
    }
    catch (err) {
        console.warn('Failed to update reply status', err.message);
    }
};
router.get('/meta/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === verifyToken) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});
router.post('/meta/webhook', async (req, res) => {
    try {
        const body = req.body;
        logEvent('meta/webhook received', { object: body?.object, hasEntry: Array.isArray(body?.entry) });
        if (!body?.object || !Array.isArray(body.entry)) {
            return res.sendStatus(400);
        }
        // Acknowledge quickly to prevent retries; processing continues asynchronously.
        res.sendStatus(200);
        for (const entry of body.entry) {
            const entryId = entry?.id;
            const instagramContext = body.object === 'instagram' ? await resolvePlatformContext('instagram', entryId) : null;
            const facebookContext = body.object === 'page' ? await resolvePlatformContext('facebook', entryId) : null;
            if (!entry.changes)
                continue;
            for (const change of entry.changes) {
                // Instagram comments
                if (change.field === 'comments' && body.object === 'instagram') {
                    const commentId = change.value?.id;
                    const text = change.value?.text;
                    const fromId = change.value?.from?.id;
                    logEvent('IG comment event', { commentId, fromId, text });
                    if (!commentId || !text)
                        continue;
                    const igAccountId = instagramContext?.accountId ?? igBusinessId;
                    if (igAccountId && fromId && fromId === igAccountId)
                        continue; // avoid replying to self
                    const analyticsScopeId = instagramContext?.orgId ?? instagramContext?.userId;
                    const inbound = await reserveInbound({
                        platform: 'instagram',
                        type: 'comment',
                        senderId: fromId,
                        text,
                        commentId,
                        ownerId: instagramContext?.userId,
                        scopeId: analyticsScopeId,
                        raw: change,
                    });
                    if (!inbound.shouldProcess) {
                        logEvent('IG comment duplicate skipped', { commentId });
                        continue;
                    }
                    try {
                        const reply = await generateReply(text, 'instagram', instagramContext?.userId, 'comment');
                        await replyToInstagramComment(commentId, reply, instagramContext?.accessToken);
                        await updateReplyStatus(inbound.ref, 'sent');
                        await likeInstagramComment(commentId, instagramContext?.accessToken).catch(err => console.warn('IG comment like failed', err));
                        if (analyticsScopeId) {
                            await incrementEngagementAnalytics({ repliesSent: 1 }, { scopeId: analyticsScopeId });
                        }
                        if (fromId) {
                            const dmFollowUp = `${reply}\n\nWant a quick demo? I can send the link.`;
                            await replyToInstagramMessage(fromId, dmFollowUp, {
                                accessToken: instagramContext?.accessToken,
                                igBusinessId: igAccountId ?? undefined,
                            }).catch(err => console.warn('IG DM follow-up failed', err));
                        }
                    }
                    catch (err) {
                        await updateReplyStatus(inbound.ref, 'failed', err.message);
                        logEvent('IG comment handler error', { commentId, error: err.message });
                    }
                }
                // Instagram message events (changes payload)
                if (change.field === 'messages' && body.object === 'instagram') {
                    const messages = Array.isArray(change.value?.messages) ? change.value.messages : [];
                    for (const msg of messages) {
                        const senderId = msg?.from;
                        const text = msg?.text?.body;
                        logEvent('IG message (changes)', { senderId, text });
                        if (!senderId || !text)
                            continue;
                        const igAccountId = instagramContext?.accountId ?? igBusinessId;
                        if (igAccountId && senderId === igAccountId)
                            continue; // avoid replying to self
                        const analyticsScopeId = instagramContext?.orgId ?? instagramContext?.userId;
                        const inboundRef = await saveInbound({
                            platform: 'instagram',
                            type: 'dm',
                            senderId,
                            text,
                            ownerId: instagramContext?.userId,
                            scopeId: analyticsScopeId,
                            raw: msg,
                        });
                        try {
                            const reply = await generateReply(text, 'instagram', instagramContext?.userId, 'message');
                            await replyToInstagramMessage(senderId, reply, {
                                accessToken: instagramContext?.accessToken,
                                igBusinessId: igAccountId ?? undefined,
                            });
                            await updateReplyStatus(inboundRef, 'sent');
                        }
                        catch (err) {
                            await updateReplyStatus(inboundRef, 'failed', err.message);
                            logEvent('IG message handler error', { senderId, error: err.message });
                        }
                    }
                }
                // Facebook page comments
                if (change.field === 'feed' && body.object === 'page') {
                    const item = change.value?.item;
                    const commentId = change.value?.comment_id;
                    const message = change.value?.message;
                    const fromId = change.value?.from?.id;
                    logEvent('FB feed event', { item, commentId, fromId, message });
                    if (item === 'comment' && commentId && message) {
                        const fbPageId = facebookContext?.pageId ?? pageId;
                        if (fbPageId && fromId && fromId === fbPageId)
                            continue; // avoid replying to self
                        const analyticsScopeId = facebookContext?.orgId ?? facebookContext?.userId;
                        const inbound = await reserveInbound({
                            platform: 'facebook',
                            type: 'comment',
                            senderId: fromId,
                            text: message,
                            commentId,
                            ownerId: facebookContext?.userId,
                            scopeId: analyticsScopeId,
                            raw: change,
                        });
                        if (!inbound.shouldProcess) {
                            logEvent('FB comment duplicate skipped', { commentId });
                            continue;
                        }
                        try {
                            const reply = await generateReply(message, 'facebook', facebookContext?.userId, 'comment');
                            await replyToFacebookComment(commentId, reply, facebookContext?.accessToken);
                            await updateReplyStatus(inbound.ref, 'sent');
                            await likeFacebookComment(commentId, facebookContext?.accessToken).catch(err => console.warn('FB comment like failed', err));
                            if (analyticsScopeId) {
                                await incrementEngagementAnalytics({ repliesSent: 1 }, { scopeId: analyticsScopeId });
                            }
                            if (fromId) {
                                const dmFollowUp = `${reply}\n\nHappy to send a quick AI Sales Agent demo link — want it?`;
                                await replyToFacebookMessage(fromId, dmFollowUp, facebookContext?.accessToken).catch(err => console.warn('FB DM follow-up failed', err));
                            }
                        }
                        catch (err) {
                            await updateReplyStatus(inbound.ref, 'failed', err.message);
                            logEvent('FB comment handler error', { commentId, error: err.message });
                        }
                    }
                }
            }
            // Messenger / IG DM events (entry.messaging)
            if (Array.isArray(entry.messaging)) {
                for (const event of entry.messaging) {
                    const senderId = event.sender?.id;
                    const message = event.message?.text;
                    logEvent('DM event', { senderId, message, object: body.object });
                    if (!senderId || !message)
                        continue;
                    // Avoid replying to self
                    const context = body.object === 'instagram' ? instagramContext : facebookContext;
                    const ownId = body.object === 'instagram'
                        ? (context?.accountId ?? igBusinessId)
                        : (context?.pageId ?? pageId);
                    if (ownId && senderId === ownId)
                        continue;
                    const analyticsScopeId = context?.orgId ?? context?.userId;
                    const inboundRef = await saveInbound({
                        platform: body.object === 'instagram' ? 'instagram' : 'facebook',
                        type: 'dm',
                        senderId,
                        text: message,
                        ownerId: context?.userId,
                        scopeId: analyticsScopeId,
                        raw: event,
                    });
                    try {
                        const platform = body.object === 'instagram' ? 'instagram' : 'facebook';
                        const reply = await generateReply(message, platform, context?.userId, 'message');
                        if (body.object === 'instagram') {
                            await replyToInstagramMessage(senderId, reply, {
                                accessToken: context?.accessToken,
                                igBusinessId: (context?.accountId ?? igBusinessId) ?? undefined,
                            });
                        }
                        else {
                            await replyToFacebookMessage(senderId, reply, context?.accessToken);
                        }
                        await updateReplyStatus(inboundRef, 'sent');
                    }
                    catch (err) {
                        await updateReplyStatus(inboundRef, 'failed', err.message);
                        logEvent('DM handler error', { senderId, error: err.message });
                    }
                }
            }
        }
    }
    catch (error) {
        // Never block the webhook; log and ack so Meta doesn't retry forever.
        console.error('[meta-webhook] handler failed', error);
        return;
    }
});
// Simple health endpoint for webhook visibility
router.get('/meta/webhook/health', (_req, res) => res.json({ ok: true }));
export default router;

import { Router } from 'express';
import axios from 'axios';
import admin from 'firebase-admin';
import {
  generateReply,
  replyToFacebookComment,
  replyToInstagramComment,
  replyToInstagramMessage,
  replyToFacebookMessage,
  likeInstagramComment,
  likeFacebookComment,
} from '../services/autoReplyService.js';
import fs from 'fs';
import path from 'path';
import { firestore } from '../db/firestore.js';

const router = Router();
const verifyToken = process.env.META_VERIFY_TOKEN ?? process.env.VERIFY_TOKEN;
const igBusinessId = process.env.INSTAGRAM_BUSINESS_ID;
const pageId = process.env.FACEBOOK_PAGE_ID;
const logFile = path.join(process.cwd(), 'meta-webhook.log');

const buildDedupeKey = (platform: 'instagram' | 'facebook', type: 'comment' | 'dm', id?: string) => {
  if (!id) return undefined;
  return `${platform}_${type}_${id}`;
};

const isAlreadyExistsError = (error: unknown) => {
  const err = error as { code?: number | string; message?: string };
  return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};

const timestampToMs = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  const maybe = value as { toMillis?: () => number; toDate?: () => Date };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.toDate === 'function') return maybe.toDate().getTime();
  return null;
};

const shouldSkipExistingReply = (existing?: admin.firestore.DocumentData | null) => {
  if (!existing) return false;
  const status = existing.replyStatus as string | undefined;
  if (status === 'sent' || status === 'pending') return true;
  if (status !== 'failed') return false;
  const retryDelayMs = Math.max(Number(process.env.META_COMMENT_RETRY_DELAY_MS ?? 300000), 0);
  if (!retryDelayMs) return false;
  const replyAtMs = timestampToMs(existing.replyAt);
  if (!replyAtMs) return true;
  return Date.now() - replyAtMs < retryDelayMs;
};

const logEvent = (message: string, payload?: unknown) => {
  const line = `[${new Date().toISOString()}] ${message} ${payload ? JSON.stringify(payload).slice(0, 2000) : ''}\n`;
  console.info(line.trim());
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // ignore file logging failures
  }
};

const saveInbound = async (event: {
  platform: 'instagram' | 'facebook';
  type: 'comment' | 'dm';
  senderId?: string;
  text?: string;
  commentId?: string;
  raw?: unknown;
}) => {
  try {
    const docRef = await firestore.collection('messages').add({
      ...event,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      replyStatus: 'pending',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return docRef;
  } catch (err) {
    console.warn('Failed to persist inbound webhook event', (err as Error).message);
    return null;
  }
};

const reserveInbound = async (event: {
  platform: 'instagram' | 'facebook';
  type: 'comment';
  senderId?: string;
  text?: string;
  commentId?: string;
  raw?: unknown;
}) => {
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
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    if (shouldSkipExistingReply(existing)) {
      return { ref, shouldProcess: false };
    }
    await ref.set(
      {
        ...event,
        replyStatus: 'pending',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ref, shouldProcess: true };
  }
};

const updateReplyStatus = async (
  ref: admin.firestore.DocumentReference<admin.firestore.DocumentData> | null,
  status: 'sent' | 'failed',
  error?: string,
) => {
  if (!ref) return;
  const update: Record<string, unknown> = {
    replyStatus: status,
    replyAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (error) {
    update.replyError = error;
  }
  try {
    await ref.update(update);
  } catch (err) {
    console.warn('Failed to update reply status', (err as Error).message);
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
      if (!entry.changes) continue;
      for (const change of entry.changes) {
        // Instagram comments
        if (change.field === 'comments' && body.object === 'instagram') {
          const commentId = change.value?.id as string | undefined;
          const text = change.value?.text as string | undefined;
          const fromId = change.value?.from?.id as string | undefined;
          logEvent('IG comment event', { commentId, fromId, text });
          if (!commentId || !text) continue;
          if (igBusinessId && fromId && fromId === igBusinessId) continue; // avoid replying to self
          const inbound = await reserveInbound({
            platform: 'instagram',
            type: 'comment',
            senderId: fromId,
            text,
            commentId,
            raw: change,
          });
          if (!inbound.shouldProcess) {
            logEvent('IG comment duplicate skipped', { commentId });
            continue;
          }
          try {
            const reply = await generateReply(text, 'instagram');
            await replyToInstagramComment(commentId, reply);
            await updateReplyStatus(inbound.ref, 'sent');
            await likeInstagramComment(commentId).catch(err => console.warn('IG comment like failed', err));
            if (fromId) {
              const dmFollowUp = `${reply}\n\nWant a quick demo? I can send the link.`;
              await replyToInstagramMessage(fromId, dmFollowUp).catch(err => console.warn('IG DM follow-up failed', err));
            }
          } catch (err) {
            await updateReplyStatus(inbound.ref, 'failed', (err as Error).message);
            logEvent('IG comment handler error', { commentId, error: (err as Error).message });
          }
        }

        // Instagram message events (changes payload)
        if (change.field === 'messages' && body.object === 'instagram') {
          const messages = Array.isArray(change.value?.messages) ? change.value.messages : [];
          for (const msg of messages) {
            const senderId = msg?.from as string | undefined;
            const text = msg?.text?.body as string | undefined;
            logEvent('IG message (changes)', { senderId, text });
            if (!senderId || !text) continue;
            if (igBusinessId && senderId === igBusinessId) continue; // avoid replying to self
            const inboundRef = await saveInbound({ platform: 'instagram', type: 'dm', senderId, text, raw: msg });
            try {
              const reply = await generateReply(text, 'instagram');
              await replyToInstagramMessage(senderId, reply);
              await updateReplyStatus(inboundRef, 'sent');
            } catch (err) {
              await updateReplyStatus(inboundRef, 'failed', (err as Error).message);
              logEvent('IG message handler error', { senderId, error: (err as Error).message });
            }
          }
        }

        // Facebook page comments
        if (change.field === 'feed' && body.object === 'page') {
          const item = change.value?.item as string | undefined;
          const commentId = change.value?.comment_id as string | undefined;
          const message = change.value?.message as string | undefined;
          const fromId = change.value?.from?.id as string | undefined;
          logEvent('FB feed event', { item, commentId, fromId, message });
          if (item === 'comment' && commentId && message) {
            if (pageId && fromId && fromId === pageId) continue; // avoid replying to self
            const inbound = await reserveInbound({
              platform: 'facebook',
              type: 'comment',
              senderId: fromId,
              text: message,
              commentId,
              raw: change,
            });
            if (!inbound.shouldProcess) {
              logEvent('FB comment duplicate skipped', { commentId });
              continue;
            }
            try {
              const reply = await generateReply(message, 'facebook');
              await replyToFacebookComment(commentId, reply);
              await updateReplyStatus(inbound.ref, 'sent');
              await likeFacebookComment(commentId).catch(err => console.warn('FB comment like failed', err));
              if (fromId) {
                const dmFollowUp = `${reply}\n\nHappy to send a quick AI Sales Agent demo link — want it?`;
                await replyToFacebookMessage(fromId, dmFollowUp).catch(err => console.warn('FB DM follow-up failed', err));
              }
            } catch (err) {
              await updateReplyStatus(inbound.ref, 'failed', (err as Error).message);
              logEvent('FB comment handler error', { commentId, error: (err as Error).message });
            }
          }
        }
      }

      // Messenger / IG DM events (entry.messaging)
      if (Array.isArray(entry.messaging)) {
        for (const event of entry.messaging) {
          const senderId = event.sender?.id as string | undefined;
          const message = event.message?.text as string | undefined;
          logEvent('DM event', { senderId, message, object: body.object });
          if (!senderId || !message) continue;

          // Avoid replying to self
          if (pageId && senderId === pageId) continue;
          if (igBusinessId && senderId === igBusinessId) continue;

          const inboundRef = await saveInbound({
            platform: body.object === 'instagram' ? 'instagram' : 'facebook',
            type: 'dm',
            senderId,
            text: message,
            raw: event,
          });
          try {
            const reply = await generateReply(message, body.object === 'instagram' ? 'instagram' : 'facebook');
            if (body.object === 'instagram') {
              await replyToInstagramMessage(senderId, reply);
            } else {
              await replyToFacebookMessage(senderId, reply);
            }
            await updateReplyStatus(inboundRef, 'sent');
          } catch (err) {
            await updateReplyStatus(inboundRef, 'failed', (err as Error).message);
            logEvent('DM handler error', { senderId, error: (err as Error).message });
          }
        }
      }
    }

  } catch (error) {
    // Never block the webhook; log and ack so Meta doesn't retry forever.
    console.error('[meta-webhook] handler failed', error);
    return;
  }
});

// Simple health endpoint for webhook visibility
router.get('/meta/webhook/health', (_req, res) => res.json({ ok: true }));

export default router;

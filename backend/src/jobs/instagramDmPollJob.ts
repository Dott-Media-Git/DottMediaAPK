import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { generateReply, replyToInstagramLoginMessage } from '../services/autoReplyService';

const enabled = process.env.IG_DM_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.IG_DM_POLL_CRON ?? '*/1 * * * *';
const conversationLimit = Math.max(Number(process.env.IG_DM_CONVERSATION_LIMIT ?? 10), 1);
const messageLimit = Math.max(Number(process.env.IG_DM_MESSAGE_LIMIT ?? 10), 1);
const startAtMs = Date.parse(process.env.IG_DM_POLL_START_AT ?? new Date().toISOString());
const DOTT_HR_USER_ID = '80bYIeiuukNFtUvXTUobXmfC7pu1';
const processedInMemory = new Set<string>();

type IgConversation = {
  id: string;
  updated_time?: string;
  participants?: { data?: Array<{ id?: string; username?: string; name?: string }> };
  messages?: {
    data?: Array<{
      id?: string;
      created_time?: string;
      from?: { id?: string; username?: string; name?: string };
      message?: string;
    }>;
  };
};

const getDottHrInstagramLoginToken = () =>
  (
    process.env.DOTT_HR_INSTAGRAM_LOGIN_TOKEN ??
    process.env.DOTTHR_INSTAGRAM_LOGIN_TOKEN ??
    ''
  ).trim();

const withinWindow = (createdAt?: string) => {
  const createdAtMs = Date.parse(createdAt ?? '');
  if (!Number.isFinite(createdAtMs)) return false;
  return createdAtMs >= startAtMs;
};

const isAlreadyExistsError = (error: unknown) => {
  const err = error as { code?: number | string; message?: string };
  return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};

const fetchConversations = async (accessToken: string): Promise<IgConversation[]> => {
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

const upsertReplyStatus = async (
  docRef: admin.firestore.DocumentReference<admin.firestore.DocumentData>,
  status: 'sent' | 'failed',
  error?: string,
) => {
  const update: Record<string, unknown> = {
    replyStatus: status,
    replyAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (error) update.replyError = error;
  await docRef.set(update, { merge: true });
};

const reserveMessage = async (message: NonNullable<IgConversation['messages']>['data'][number]) => {
  const messageId = String(message.id ?? '').trim();
  if (!messageId || processedInMemory.has(messageId)) return null;
  processedInMemory.add(messageId);

  const text = String(message.message ?? '').trim();
  if (!text) return null;
  const senderId = String(message.from?.id ?? '').trim();
  const senderUsername = String(message.from?.username ?? '').trim();
  if (!senderId || senderUsername === 'dott_human_resource') return null;
  if (!withinWindow(message.created_time)) return null;

  const docRef = firestore.collection('messages').doc(`instagram_dm_${messageId}`);
  const payload = {
    platform: 'instagram',
    type: 'dm',
    senderId,
    senderUsername: senderUsername || null,
    text,
    ownerId: DOTT_HR_USER_ID,
    accountId: 'dott_human_resource',
    source: 'instagram-login-poller',
    replyStatus: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await docRef.create(payload);
  } catch (error) {
    if (isAlreadyExistsError(error)) return null;
    console.warn('[ig-dm-poll] Firestore reservation failed; replying with in-memory dedupe', (error as Error).message);
  }
  return { docRef, senderId, text };
};

export const pollInstagramDmsOnce = async () => {
  const accessToken = getDottHrInstagramLoginToken();
  if (!accessToken) {
    console.warn('[ig-dm-poll] missing Dott HR Instagram Login token; polling skipped');
    return;
  }

  try {
    const conversations = await fetchConversations(accessToken);
    for (const conversation of conversations) {
      const messages = conversation.messages?.data ?? [];
      for (const message of messages.reverse()) {
        const reserved = await reserveMessage(message);
        if (!reserved) continue;
        try {
          const reply = await generateReply(reserved.text, 'instagram', DOTT_HR_USER_ID, 'message');
          await replyToInstagramLoginMessage(reserved.senderId, reply, accessToken);
          await upsertReplyStatus(reserved.docRef, 'sent');
        } catch (error) {
          await upsertReplyStatus(reserved.docRef, 'failed', (error as Error).message).catch(() => undefined);
          console.warn('[ig-dm-poll] reply failed', (error as Error).message);
        }
      }
    }
  } catch (error) {
    console.warn('[ig-dm-poll] poll failed', (error as Error).message);
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
  console.info(`[ig-dm-poll] job scheduled (${scheduleExpression}).`);

  if (process.env.IG_DM_POLL_ON_STARTUP === 'true') {
    void pollInstagramDmsOnce();
  }
}

scheduleInstagramDmPollJob();

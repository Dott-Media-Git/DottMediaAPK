import cron from 'node-cron';
import axios from 'axios';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { generateReply, replyToInstagramLoginMessage } from '../services/autoReplyService';
import {
  getInstagramLoginAccounts,
  getInstagramLoginToken,
  InstagramLoginAccount,
} from '../services/instagramAccountRegistry';
import { recordOptOutIfRequested, recordOutreachOptIn } from '../services/outreachConsentService';
import { getInstagramAutoResponseEnabledForAccount } from '../services/instagramInboxService';
import { syncInstagramInboxForUser } from '../services/instagramInboxSyncService';
import { supabaseFallbackService } from '../services/supabaseFallbackService';

const enabled = process.env.IG_DM_POLL_ENABLED !== 'false';
const scheduleExpression = process.env.IG_DM_POLL_CRON ?? '*/1 * * * *';
const conversationLimit = Math.max(Number(process.env.IG_DM_CONVERSATION_LIMIT ?? 10), 1);
const messageLimit = Math.max(Number(process.env.IG_DM_MESSAGE_LIMIT ?? 10), 1);
const startAtMs = Date.parse(process.env.IG_DM_POLL_START_AT ?? new Date().toISOString());
const processedInMemory = new Set<string>();
let storedAccountsCache: { expiresAt: number; accounts: Array<{ userId: string; email?: string | null }> } = {
  expiresAt: 0,
  accounts: [],
};

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

const isInstagramLoginAccount = (account: unknown) => {
  if (!account || typeof account !== 'object') return false;
  const value = account as Record<string, unknown>;
  const provider = String(value.provider ?? '').toLowerCase().replace(/[-\s]/g, '_');
  const graphBaseUrl = String(value.graphBaseUrl ?? '').toLowerCase();
  return provider === 'instagram_login' || provider === 'instagramlogin' || graphBaseUrl.includes('graph.instagram.com');
};

const getStoredInstagramLoginUsers = async () => {
  if (storedAccountsCache.expiresAt > Date.now()) return storedAccountsCache.accounts;

  const accounts = new Map<string, { userId: string; email?: string | null }>();
  try {
    const rows = await supabaseFallbackService.getAllSocialAccounts(1000);
    for (const row of rows) {
      const instagram = row.socialAccounts?.instagram;
      if (!row.userId || !instagram || !isInstagramLoginAccount(instagram) || !String((instagram as any).accessToken ?? '').trim()) continue;
      accounts.set(row.userId, { userId: row.userId, email: row.email ?? null });
    }
  } catch (error) {
    console.warn('[ig-dm-poll] stored Instagram account lookup failed', (error as Error).message);
  }

  // Supabase is the primary fallback store, but a newly connected account may
  // be visible in Firestore before the fallback row is written.
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const snapshot = await Promise.race([
      firestore.collection('users').select('email', 'socialAccounts').limit(1000).get(),
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 5000); }),
    ]).finally(() => { if (timeout) clearTimeout(timeout); });
    for (const doc of snapshot?.docs ?? []) {
      const data = doc.data() as { email?: string; socialAccounts?: Record<string, any> };
      const instagram = data.socialAccounts?.instagram;
      if (!isInstagramLoginAccount(instagram) || !String(instagram?.accessToken ?? '').trim()) continue;
      accounts.set(doc.id, { userId: doc.id, email: data.email ?? null });
    }
  } catch (error) {
    console.warn('[ig-dm-poll] Firestore Instagram account lookup failed', (error as Error).message);
  }

  storedAccountsCache = { expiresAt: Date.now() + 60_000, accounts: [...accounts.values()] };
  return storedAccountsCache.accounts;
};

const upsertReplyStatus = async (
  docRef: admin.firestore.DocumentReference<admin.firestore.DocumentData> | null,
  status: 'sent' | 'failed' | 'disabled',
  error?: string,
  storageId?: string,
) => {
  const update: Record<string, unknown> = {
    replyStatus: status,
    replyAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (error) update.replyError = error;
  if (docRef) {
    await docRef.set(update, { merge: true });
    return;
  }
  await supabaseFallbackService.updateInboundMessage(storageId ?? '', {
    status,
    error: error ?? null,
  });
};

const reserveMessage = async (
  target: InstagramLoginAccount,
  message: NonNullable<IgConversation['messages']>['data'][number],
) => {
  const messageId = String(message.id ?? '').trim();
  const memoryKey = `${target.key}:${messageId}`;
  if (!messageId || processedInMemory.has(memoryKey)) return null;
  processedInMemory.add(memoryKey);

  const text = String(message.message ?? '').trim();
  if (!text) return null;
  const senderId = String(message.from?.id ?? '').trim();
  const senderUsername = String(message.from?.username ?? '').trim().toLowerCase();
  if (!senderId || senderUsername === target.username.toLowerCase()) return null;
  if (!withinWindow(message.created_time)) return null;
  await recordOutreachOptIn({
    platform: 'instagram',
    recipientId: senderId,
    ownerId: target.userId,
    source: 'dm',
    text,
    metadata: { accountKey: target.key, senderUsername },
  }).catch(error => console.warn('[ig-dm-poll] opt-in record failed', (error as Error).message));
  await recordOptOutIfRequested({
    platform: 'instagram',
    recipientId: senderId,
    ownerId: target.userId,
    text,
  }).catch(error => console.warn('[ig-dm-poll] opt-out record failed', (error as Error).message));

  const storageId = `instagram_dm_${target.key}_${messageId}`;
  const docRef = firestore.collection('messages').doc(storageId);
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
  } catch (error) {
    if (isAlreadyExistsError(error)) return null;
    try {
      await supabaseFallbackService.addInboundMessage({
        id: storageId,
        channel: 'instagram',
        senderId,
        message: text,
        messageType: 'dm',
        profileName: senderUsername || null,
        status: 'pending',
        receivedAt: message.created_time ?? new Date().toISOString(),
        payload: { ownerId: target.userId, targetKey: target.key, accountId: target.username, source: 'instagram-login-poller' },
      });
      console.warn('[ig-dm-poll] Firestore unavailable; stored inbound DM in Supabase', (error as Error).message);
      return { docRef: null, storageId, senderId, text };
    } catch (fallbackError) {
      console.warn('[ig-dm-poll] inbound storage failed; skipping reply to avoid duplicates', (fallbackError as Error).message);
      return null;
    }
  }
  return { docRef, storageId, senderId, text };
};

export const pollInstagramDmsOnce = async () => {
  const storedAccounts = await getStoredInstagramLoginUsers();
  // Keep Ngogo responsive even when another account's provider is slow.
  storedAccounts.sort((a, b) => Number(b.userId === 'ouwaugr76lhdQ6IJbTuoCK9yMV93') - Number(a.userId === 'ouwaugr76lhdQ6IJbTuoCK9yMV93'));
  const handledUserIds = new Set<string>();

  // OAuth-connected Instagram Login accounts are persisted per user. Poll
  // those credentials directly so auto-response continues while the user is
  // offline; the same sync path is used by the Inbox screen.
  for (const account of storedAccounts) {
    try {
      await syncInstagramInboxForUser(account.userId, account.email);
      handledUserIds.add(account.userId);
    } catch (error) {
      console.warn(`[ig-dm-poll] stored account ${account.userId} poll failed`, (error as Error).message);
    }
  }

  // Some known client accounts are provisioned with a server-side Meta token
  // rather than a user OAuth row. Try the shared sync path for those accounts
  // first so Page-token Instagram messaging works as well. If no credential is
  // available, the dedicated Login-token poll below remains the fallback.
  for (const target of getInstagramLoginAccounts()) {
    if (handledUserIds.has(target.userId)) continue;
    try {
      await syncInstagramInboxForUser(target.userId);
      handledUserIds.add(target.userId);
    } catch {
      // The target may only have a graph.instagram.com Login token; leave it
      // for the dedicated poller below.
    }
  }

  const targets = getInstagramLoginAccounts().map((target) => ({ target, accessToken: getInstagramLoginToken(target) })).filter(
    ({ accessToken }) => Boolean(accessToken),
  ).filter(({ target }) => !handledUserIds.has(target.userId));
  if (targets.length === 0) {
    if (storedAccounts.length === 0) console.warn('[ig-dm-poll] no Instagram Login accounts configured; polling skipped');
    return;
  }

  for (const { target, accessToken } of targets) {
    try {
      const conversations = await fetchConversations(accessToken);
      for (const conversation of conversations) {
        const messages = conversation.messages?.data ?? [];
        for (const message of messages.reverse()) {
          const reserved = await reserveMessage(target, message);
          if (!reserved) continue;
          if (!(await getInstagramAutoResponseEnabledForAccount(target.userId, target.username))) {
            await upsertReplyStatus(reserved.docRef, 'disabled', undefined, reserved.storageId);
            continue;
          }
          try {
            const reply = await generateReply(reserved.text, 'instagram', target.userId, 'message', { username: target.username });
            if (!(await getInstagramAutoResponseEnabledForAccount(target.userId, target.username))) {
              await upsertReplyStatus(reserved.docRef, 'disabled', undefined, reserved.storageId);
              continue;
            }
            await replyToInstagramLoginMessage(reserved.senderId, reply, accessToken);
            await upsertReplyStatus(reserved.docRef, 'sent', undefined, reserved.storageId);
          } catch (error) {
            await upsertReplyStatus(reserved.docRef, 'failed', (error as Error).message, reserved.storageId).catch(() => undefined);
            console.warn(`[ig-dm-poll] ${target.key} reply failed`, (error as Error).message);
          }
        }
      }
    } catch (error) {
      console.warn(`[ig-dm-poll] ${target.key} poll failed`, (error as Error).message);
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
  console.info(`[ig-dm-poll] job scheduled (${scheduleExpression}) for ${getInstagramLoginAccounts().length} configured accounts plus persisted OAuth accounts.`);

  if (process.env.IG_DM_POLL_ON_STARTUP === 'true') {
    void pollInstagramDmsOnce();
  }
}

scheduleInstagramDmPollJob();

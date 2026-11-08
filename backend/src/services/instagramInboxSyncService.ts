import axios from 'axios';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { generateReply, replyToInstagramLoginMessage, replyToInstagramMessage } from './autoReplyService';
import {
  getInstagramAutoResponseEnabledForAccount,
  getStoredInstagramAccount,
  serializeInstagramMessage,
} from './instagramInboxService';
import { supabaseFallbackService } from './supabaseFallbackService';

type InstagramConversation = {
  id?: string;
  messages?: {
    data?: Array<{
      id?: string;
      created_time?: string;
      from?: { id?: string; username?: string; name?: string };
      message?: string;
    }>;
  };
};

type InstagramSyncAccount = {
  accessToken: string;
  pageAccessToken?: string;
  accountId: string;
  pageId?: string;
  username?: string;
  provider?: string;
  graphBaseUrl?: string;
  graphVersion?: string;
};

const isAlreadyExistsError = (error: unknown) => {
  const err = error as { code?: number | string; message?: string };
  return err.code === 6 || err.code === 'already-exists' || err.message?.includes('ALREADY_EXISTS') === true;
};

const safeError = (error: unknown) => {
  const err = error as { response?: { status?: number; data?: { error?: { message?: string }; message?: string } }; message?: string };
  const providerMessage = err.response?.data?.error?.message ?? err.response?.data?.message;
  const message = String(providerMessage ?? err.message ?? 'Instagram inbox sync failed');
  return message
    .replace(/access_token(?:=|%3D)[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/EA[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .slice(0, 300);
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const storageIdFor = (accountId: string, messageId: string) =>
  `instagram_dm_${accountId}_${messageId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

const isInstagramLogin = (account: InstagramSyncAccount) =>
  ['instagram_login', 'instagramlogin'].includes(String(account.provider ?? '').toLowerCase().replace(/[-\s]/g, '_')) ||
  String(account.graphBaseUrl ?? '').toLowerCase().includes('graph.instagram.com');

const fetchConversations = async (account: InstagramSyncAccount): Promise<InstagramConversation[]> => {
  const login = isInstagramLogin(account);
  const base = String(account.graphBaseUrl ?? (login ? 'https://graph.instagram.com' : 'https://graph.facebook.com')).replace(/\/$/, '');
  const version = String(account.graphVersion ?? process.env.META_GRAPH_VERSION ?? 'v23.0').replace(/^\//, '');
  const conversationOwnerId = account.pageId || account.accountId;
  const endpoints: Array<{ url: string; accessToken: string }> = login
    ? [
        { url: `${base}/me/conversations`, accessToken: account.accessToken },
        // Some Instagram Login records also retain the linked Page ID. Meta
        // can return an empty /me edge for those records while the Page
        // conversations edge contains the Instagram inbox, so try both before
        // treating an empty response as authoritative.
        ...(account.pageId
          ? [{
              url: `https://graph.facebook.com/${version}/${encodeURIComponent(account.pageId)}/conversations`,
              accessToken: account.pageAccessToken ?? account.accessToken,
            }]
          : []),
      ]
    : [
        {
          url: `${base}/${version}/${encodeURIComponent(conversationOwnerId)}/conversations`,
          accessToken: account.accessToken,
        },
        ...(account.pageId && account.accountId !== account.pageId
          ? [{
              url: `${base}/${version}/${encodeURIComponent(account.accountId)}/conversations`,
              accessToken: account.accessToken,
            }]
          : []),
      ];
  let lastError: unknown = null;
  let receivedEmptyResponse = false;
  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint.url, {
        params: {
          fields: 'id,updated_time,participants,messages.limit(50){id,created_time,from,message}',
          limit: 50,
          ...(!login ? { platform: 'instagram' } : {}),
          access_token: endpoint.accessToken,
        },
        timeout: 10000,
      });
      const conversations = Array.isArray(response.data?.data) ? response.data.data : [];
      if (conversations.length) return conversations;
      receivedEmptyResponse = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (receivedEmptyResponse) return [];
  throw new Error(`Instagram inbox sync failed (${errStatus(lastError)}): ${safeError(lastError)}`);
};

const errStatus = (error: unknown) => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status ? `HTTP ${status}` : 'provider error';
};

const isMessageFromAccount = (message: NonNullable<InstagramConversation['messages']>['data'][number], account: InstagramSyncAccount) => {
  const senderId = String(message.from?.id ?? '').trim();
  const senderUsername = String(message.from?.username ?? '').trim().toLowerCase();
  const accountUsername = String(account.username ?? '').trim().toLowerCase();
  return senderId === account.accountId || (Boolean(accountUsername) && senderUsername === accountUsername);
};

export async function syncInstagramInboxForUser(
  userId: string,
  email?: string | null,
  options: { sendReplies?: boolean } = {},
) {
  const rawAccount = await getStoredInstagramAccount(userId, email);
  const account: InstagramSyncAccount = {
    accessToken: String(rawAccount.accessToken ?? '').trim(),
    pageAccessToken: rawAccount.pageAccessToken ? String(rawAccount.pageAccessToken).trim() : undefined,
    accountId: String(rawAccount.accountId ?? '').trim(),
    pageId: rawAccount.pageId ? String(rawAccount.pageId) : undefined,
    username: rawAccount.username ? String(rawAccount.username) : undefined,
    provider: rawAccount.provider ? String(rawAccount.provider) : undefined,
    graphBaseUrl: rawAccount.graphBaseUrl ? String(rawAccount.graphBaseUrl) : undefined,
    graphVersion: rawAccount.graphVersion ? String(rawAccount.graphVersion) : undefined,
  };
  if (!account.accessToken || !account.accountId) {
    throw new Error('Instagram is connected in Dotti, but no server-side messaging credential is available. Reconnect Instagram and try again.');
  }

  const conversations = await fetchConversations(account);
  const existingRows = await withTimeout(supabaseFallbackService.listInboundMessages('instagram', 500).catch(() => []), 5000, []);
  const existingIds = new Set(existingRows.map(row => String(row.id ?? '')));
  const shouldSendReplies = options.sendReplies !== false;
  const autoResponseEnabled = shouldSendReplies
    ? await getInstagramAutoResponseEnabledForAccount(userId, [account.accountId, account.username ?? ''])
    : false;
  let synced = 0;
  let replied = 0;
  const syncedMessages: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const conversation of conversations) {
    const messages = [...(conversation.messages?.data ?? [])].reverse();
    for (const message of messages) {
      const messageId = String(message.id ?? '').trim();
      const text = String(message.message ?? '').trim();
      const senderId = String(message.from?.id ?? '').trim();
      if (!messageId || !text || !senderId || seen.has(messageId) || isMessageFromAccount(message, account)) continue;
      seen.add(messageId);
      const storageId = storageIdFor(account.accountId, messageId);
      if (existingIds.has(storageId)) continue;

      const createdAt = message.created_time ?? new Date().toISOString();
      const payload = {
        platform: 'instagram',
        type: 'dm',
        senderId,
        senderUsername: message.from?.username ?? message.from?.name ?? null,
        text,
        ownerId: userId,
        accountId: account.accountId,
        source: 'instagram-inbox-sync',
        replyStatus: 'pending',
        createdAt: admin.firestore.Timestamp.fromDate(new Date(createdAt)),
        updatedAt: admin.firestore.Timestamp.now(),
      };

      let firestoreRef: admin.firestore.DocumentReference<admin.firestore.DocumentData> | null = null;
      try {
        firestoreRef = firestore.collection('messages').doc(storageId);
        await firestoreRef.create(payload);
      } catch (error) {
        if (isAlreadyExistsError(error)) continue;
        firestoreRef = null;
      }

      let fallbackStored = false;
      try {
        await supabaseFallbackService.addInboundMessage({
          id: storageId,
          channel: 'instagram',
          senderId,
          message: text,
          messageType: 'dm',
          profileName: message.from?.username ?? message.from?.name ?? null,
          status: 'pending',
          receivedAt: createdAt,
          payload: { ownerId: userId, accountId: account.accountId, source: 'instagram-inbox-sync' },
        });
        fallbackStored = true;
      } catch (error) {
        // A storage outage must not discard a DM that Meta has already
        // delivered. The sanitized sync response below keeps it visible for
        // the current refresh while the background poller retries persistence.
        console.warn('[instagram-inbox] fallback message save failed', (error as Error).message);
      }
      existingIds.add(storageId);
      synced += 1;
      syncedMessages.push(serializeInstagramMessage(storageId, payload));

      if (!firestoreRef && !fallbackStored) {
        console.warn('[instagram-inbox] message was not persisted; returning it in the sync response', { storageId });
      }

      if (!shouldSendReplies) {
        continue;
      }

      if (!autoResponseEnabled) {
        if (firestoreRef) await firestoreRef.set({ replyStatus: 'disabled', replyAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await supabaseFallbackService.updateInboundMessage(storageId, { status: 'disabled' }).catch(() => undefined);
        continue;
      }

      try {
        const reply = await generateReply(text, 'instagram', userId, 'message', { accountId: account.accountId, username: account.username });
        if (!(await getInstagramAutoResponseEnabledForAccount(userId, [account.accountId, account.username ?? '']))) {
          if (firestoreRef) await firestoreRef.set({ replyStatus: 'disabled', replyAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          await supabaseFallbackService.updateInboundMessage(storageId, { status: 'disabled' }).catch(() => undefined);
          continue;
        }
        if (isInstagramLogin(account)) {
          await replyToInstagramLoginMessage(senderId, reply, account.accessToken);
        } else {
          await replyToInstagramMessage(senderId, reply, { accessToken: account.accessToken, igBusinessId: account.accountId, pageId: account.pageId });
        }
        if (firestoreRef) await firestoreRef.set({ replyStatus: 'sent', replyText: reply, replyAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await supabaseFallbackService.updateInboundMessage(storageId, { status: 'sent', reply }).catch(() => undefined);
        replied += 1;
      } catch (error) {
        const messageText = safeError(error);
        if (firestoreRef) await firestoreRef.set({ replyStatus: 'failed', replyError: messageText, replyAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await supabaseFallbackService.updateInboundMessage(storageId, { status: 'failed', error: messageText }).catch(() => undefined);
      }
    }
  }

  return { synced, replied, conversations: conversations.length, messages: syncedMessages };
}


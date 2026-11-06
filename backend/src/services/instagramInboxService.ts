import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { replyToInstagramLoginMessage, replyToInstagramMessage } from './autoReplyService';
import { getInstagramLoginToken, resolveInstagramLoginAccount } from './instagramAccountRegistry';
import { supabaseFallbackService } from './supabaseFallbackService';
import { resolveKnownLiveSocialProfile } from './liveSocialMetricsService';

type StoredMessage = admin.firestore.DocumentData;

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

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'object' && value && typeof (value as { _seconds?: unknown })._seconds === 'number') {
    const seconds = Number((value as { _seconds: number })._seconds);
    const nanos = Number((value as { _nanoseconds?: number })._nanoseconds ?? 0);
    return new Date(seconds * 1000 + nanos / 1_000_000).toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
};

export const serializeInstagramMessage = (id: string, data: StoredMessage) => ({
  id,
  platform: String(data.platform ?? 'instagram'),
  type: String(data.type ?? 'dm'),
  senderId: String(data.senderId ?? ''),
  senderUsername: data.senderUsername ? String(data.senderUsername) : null,
  text: String(data.text ?? ''),
  replyStatus: String(data.replyStatus ?? 'pending'),
  replyText: data.replyText ? String(data.replyText) : null,
  replyError: data.replyError ? String(data.replyError) : null,
  createdAt: toIso(data.createdAt),
  replyAt: toIso(data.replyAt),
  updatedAt: toIso(data.updatedAt),
});

export async function getInstagramAutoResponseEnabled(userId: string) {
  try {
    const snap = await withTimeout(firestore.collection('assistant_settings').doc(userId).get(), 5000, null);
    if (!snap) return true;
    const data = snap.data() ?? {};
    if (typeof data.instagramAutoReplyEnabled === 'boolean') return data.instagramAutoReplyEnabled;
    if (typeof data.autoReplyEnabled === 'boolean') return data.autoReplyEnabled;
  } catch (error) {
    // Keep the background poller fail-safe: a temporary settings read failure
    // should not prevent inbound messages from receiving the normal fallback.
    console.warn('[instagram-inbox] auto-response setting read failed', (error as Error).message);
  }
  return true;
}

export async function setInstagramAutoResponseEnabled(userId: string, enabled: boolean) {
  await firestore.collection('assistant_settings').doc(userId).set(
    {
      instagramAutoReplyEnabled: enabled,
      instagramAutoReplyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return enabled;
}

export async function getStoredInstagramAccount(userId: string, email?: string | null) {
  let account: Record<string, unknown> = {};
  const knownProfile = resolveKnownLiveSocialProfile(userId) || resolveKnownLiveSocialProfile(email);
  const knownInstagram = knownProfile?.socialAccounts?.instagram;
  if (knownInstagram && typeof knownInstagram === 'object') {
    account = { ...(knownInstagram as Record<string, unknown>) };
  }
  try {
    const snap = await withTimeout(firestore.collection('users').doc(userId).get(), 5000, null);
    if (!snap) throw new Error('Firestore account lookup timed out');
    const firestoreAccount = snap.data()?.socialAccounts?.instagram;
    if (firestoreAccount && typeof firestoreAccount === 'object') account = { ...(firestoreAccount as Record<string, unknown>) };
  } catch (error) {
    console.warn('[instagram-inbox] Firestore account lookup failed; checking fallback store', (error as Error).message);
  }
  try {
    const fallback = await withTimeout(supabaseFallbackService.getSocialAccounts(userId, { includePrivate: true }), 5000, null);
    const fallbackAccount = fallback?.socialAccounts?.instagram;
    if (fallbackAccount && typeof fallbackAccount === 'object') {
      account = { ...account, ...(fallbackAccount as Record<string, unknown>) };
    }
  } catch (error) {
    console.warn('[instagram-inbox] fallback account lookup failed', (error as Error).message);
  }
  // OAuth callbacks and older accounts can be keyed by a previous Firebase
  // UID while the signed-in user is identified by the same verified email.
  // Resolve that record without returning any credential to the client.
  if (!account.accessToken && email) {
    try {
      const fallbackByIdentity = await withTimeout(supabaseFallbackService.getSocialAccountsByIdentifiers([userId], [email]), 5000, null);
      const fallbackInstagram = fallbackByIdentity?.socialAccounts?.instagram;
      if (fallbackInstagram && typeof fallbackInstagram === 'object') {
        account = { ...account, ...(fallbackInstagram as Record<string, unknown>) };
      }
    } catch (error) {
      console.warn('[instagram-inbox] identity account lookup failed', (error as Error).message);
    }
    try {
      const emailSnapshot = await withTimeout(firestore.collection('users').where('email', '==', email).limit(1).get(), 5000, null);
      if (!emailSnapshot) throw new Error('Firestore email account lookup timed out');
      const emailAccount = emailSnapshot.docs[0]?.data()?.socialAccounts?.instagram;
      if (emailAccount && typeof emailAccount === 'object') {
        account = { ...account, ...(emailAccount as Record<string, unknown>) };
      }
    } catch (error) {
      console.warn('[instagram-inbox] email account lookup failed', (error as Error).message);
    }
  }
  return account;
}

export async function sendStoredInstagramReply(input: {
  userId: string;
  message: StoredMessage;
  text: string;
}) {
  const senderId = String(input.message.senderId ?? '').trim();
  if (!senderId) throw new Error('This Instagram message has no sender ID.');

  const target = resolveInstagramLoginAccount({
    userId: input.userId,
    accountKey: String(input.message.targetKey ?? ''),
  });
  const loginToken = target ? getInstagramLoginToken(target) : '';
  if (loginToken && String(input.message.source ?? '') === 'instagram-login-poller') {
    await replyToInstagramLoginMessage(senderId, input.text, loginToken);
    return;
  }

  const account = await getStoredInstagramAccount(input.userId);
  const accessToken = String(account.accessToken ?? '').trim();
  const accountId = String(account.accountId ?? input.message.accountId ?? '').trim();
  if (!accessToken || !accountId) {
    throw new Error('Instagram is not connected for this account. Reconnect Instagram and try again.');
  }
  await replyToInstagramMessage(senderId, input.text, { accessToken, igBusinessId: accountId });
}

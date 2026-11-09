import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { replyToInstagramLoginMessage, replyToInstagramMessage } from './autoReplyService';
import { getInstagramLoginToken, resolveInstagramLoginAccount } from './instagramAccountRegistry';
import { supabaseFallbackService } from './supabaseFallbackService';
import { resolveKnownLiveSocialProfile } from './liveSocialMetricsService';
import { config } from '../config';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess';

type StoredMessage = admin.firestore.DocumentData;

const isInstagramLoginAccount = (account: Record<string, unknown>) => {
  const provider = String(account.provider ?? '').toLowerCase();
  const graphBaseUrl = String(account.graphBaseUrl ?? '').toLowerCase();
  return provider === 'instagram_login' || graphBaseUrl.includes('graph.instagram.com');
};

const normalizeInstagramAccount = (socialAccounts: Record<string, any> | undefined) => {
  const instagram = socialAccounts?.instagram;
  if (!instagram || typeof instagram !== 'object') return null;
  const facebook = socialAccounts?.facebook;
  const provider = String(instagram.provider ?? '').toLowerCase();
  const graphBaseUrl = String(instagram.graphBaseUrl ?? '').toLowerCase();
  const isInstagramLogin = provider === 'instagram_login' || graphBaseUrl.includes('graph.instagram.com');
  // Legacy Meta connections stored the user token on Instagram. Use the
  // linked Page token for Instagram Messaging API conversation access.
  if (!isInstagramLogin && facebook?.accessToken && facebook?.pageId) {
    return { ...(instagram as Record<string, unknown>), accessToken: facebook.accessToken, pageId: facebook.pageId };
  }
  if (facebook?.accessToken && facebook?.pageId) {
    return {
      ...(instagram as Record<string, unknown>),
      pageId: (instagram as Record<string, unknown>).pageId ?? facebook.pageId,
      pageAccessToken: facebook.accessToken,
    };
  }
  return instagram as Record<string, unknown>;
};

// Connection records can be written by different flows (OAuth, the fallback
// store, and the social-status resolver). Some of those records intentionally
// omit private credentials. Merge them instead of replacing the whole account
// so a valid server-side token from the trusted profile is not discarded by a
// metadata-only record.
const mergeInstagramAccount = (
  current: Record<string, unknown>,
  incoming: Record<string, unknown> | null | undefined,
) => {
  if (!incoming || typeof incoming !== 'object') return current;
  const merged = { ...current };
  Object.entries(incoming).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && !value.trim()) return;
    merged[key] = value;
  });
  return merged;
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
  return getInstagramAutoResponseEnabledForAccount(userId);
}

const normalizeSettingKeys = (keys: string | string[] | undefined) => {
  const values = Array.isArray(keys) ? keys : keys ? [keys] : [];
  return [...new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))]
    .map(value => value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120))
    .filter(Boolean);
};

export async function getInstagramAutoResponseEnabledForAccount(userId: string, accountKeys?: string | string[]) {
  if (userId === 'ouwaugr76lhdQ6IJbTuoCK9yMV93' && supabaseFallbackService.isConfigured()) {
    try {
      const setting = await supabaseFallbackService.getInboundMessage(`instagram_auto_response_setting_${userId}`);
      const enabled = (setting?.payload as { enabled?: unknown } | undefined)?.enabled;
      if (typeof enabled === 'boolean') return enabled;
    } catch (error) {
      console.warn('[instagram-inbox] durable setting read failed', (error as Error).message);
      return false;
    }
  }
  try {
    const snap = await withTimeout(firestore.collection('assistant_settings').doc(userId).get(), 5000, null);
    if (snap) {
      const data = snap.data() ?? {};
      if (typeof data.instagramAutoReplyEnabled === 'boolean') return data.instagramAutoReplyEnabled;
    }
  } catch (error) {
    // Keep the background poller fail-safe: a temporary settings read failure
    // should not prevent inbound messages from receiving the normal fallback.
    console.warn('[instagram-inbox] auto-response setting read failed', (error as Error).message);
  }
  const keys = normalizeSettingKeys(accountKeys);
  for (const key of keys) {
    try {
      const accountSnap = await withTimeout(firestore.collection('assistant_settings_instagram_accounts').doc(key).get(), 5000, null);
      if (accountSnap) {
        const accountData = accountSnap.data() ?? {};
        if (typeof accountData.instagramAutoReplyEnabled === 'boolean') return accountData.instagramAutoReplyEnabled;
      }
    } catch (error) {
      console.warn('[instagram-inbox] account auto-response setting read failed', (error as Error).message);
    }
  }
  return true;
}

export async function setInstagramAutoResponseEnabled(userId: string, enabled: boolean, accountKeys?: string | string[]) {
  if (userId === 'ouwaugr76lhdQ6IJbTuoCK9yMV93' && supabaseFallbackService.isConfigured()) {
    await supabaseFallbackService.addInboundMessage({
      id: `instagram_auto_response_setting_${userId}`, channel: 'settings', senderId: userId,
      messageType: 'instagram_auto_response', status: 'configured', payload: { enabled },
    });
    return enabled;
  }
  await firestore.collection('assistant_settings').doc(userId).set(
    {
      instagramAutoReplyEnabled: enabled,
      instagramAutoReplyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  for (const key of normalizeSettingKeys(accountKeys)) {
    try {
      await firestore.collection('assistant_settings_instagram_accounts').doc(key).set(
        {
          instagramAutoReplyEnabled: enabled,
          ownerUserId: userId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      // The user-scoped setting above remains authoritative if this optional
      // account alias cannot be written during a provider incident.
      console.warn('[instagram-inbox] account auto-response setting write failed', (error as Error).message);
    }
  }
  return enabled;
}

export async function getStoredInstagramAccount(userId: string, email?: string | null) {
  let account: Record<string, unknown> = {};
  const knownProfile = resolveKnownLiveSocialProfile(userId) || resolveKnownLiveSocialProfile(email);
  const knownInstagram = normalizeInstagramAccount(knownProfile?.socialAccounts as Record<string, any> | undefined);
  if (knownInstagram && typeof knownInstagram === 'object') {
    account = { ...(knownInstagram as Record<string, unknown>) };
  }
  try {
    const snap = await withTimeout(firestore.collection('users').doc(userId).get(), 5000, null);
    if (!snap) throw new Error('Firestore account lookup timed out');
    const firestoreAccount = normalizeInstagramAccount(snap.data()?.socialAccounts as Record<string, any> | undefined);
    if (firestoreAccount && typeof firestoreAccount === 'object') {
      account = mergeInstagramAccount(account, firestoreAccount as Record<string, unknown>);
    }
  } catch (error) {
    console.warn('[instagram-inbox] Firestore account lookup failed; checking fallback store', (error as Error).message);
  }
  try {
    const fallback = await withTimeout(supabaseFallbackService.getSocialAccounts(userId, { includePrivate: true }), 5000, null);
    const fallbackAccount = normalizeInstagramAccount(fallback?.socialAccounts as Record<string, any> | undefined);
    if (fallbackAccount && typeof fallbackAccount === 'object') {
      account = mergeInstagramAccount(account, fallbackAccount as Record<string, unknown>);
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
      const fallbackInstagram = normalizeInstagramAccount(fallbackByIdentity?.socialAccounts as Record<string, any> | undefined);
      if (fallbackInstagram && typeof fallbackInstagram === 'object') {
        account = mergeInstagramAccount(account, fallbackInstagram as Record<string, unknown>);
      }
    } catch (error) {
      console.warn('[instagram-inbox] identity account lookup failed', (error as Error).message);
    }
    try {
      const emailSnapshot = await withTimeout(firestore.collection('users').where('email', '==', email).limit(1).get(), 5000, null);
      if (!emailSnapshot) throw new Error('Firestore email account lookup timed out');
      const emailAccount = normalizeInstagramAccount(emailSnapshot.docs[0]?.data()?.socialAccounts as Record<string, any> | undefined);
      if (emailAccount && typeof emailAccount === 'object') {
        account = mergeInstagramAccount(account, emailAccount as Record<string, unknown>);
      }
    } catch (error) {
      console.warn('[instagram-inbox] email account lookup failed', (error as Error).message);
    }
  }

  // Social Integrations also supports the primary Dotti account's server-side
  // defaults. Use the same guarded fallback here so the inbox connection state
  // matches that page and the sync job can use the same credential.
  if (
    (!account.accessToken || !account.accountId) &&
    canUsePrimarySocialDefaults({ email }, userId) &&
    config.channels.instagram.accessToken &&
    config.channels.instagram.businessId
  ) {
    account = mergeInstagramAccount(account, {
      provider: 'meta_page',
      graphBaseUrl: 'https://graph.facebook.com',
      graphVersion: process.env.META_GRAPH_VERSION ?? 'v23.0',
      accessToken: config.channels.instagram.accessToken,
      accountId: config.channels.instagram.businessId,
      pageId: config.channels.facebook.pageId || undefined,
    });
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
  const pageId = String(account.pageId ?? input.message.pageId ?? '').trim();
  if (!accessToken || !accountId) {
    throw new Error('Instagram is not connected for this account. Reconnect Instagram and try again.');
  }
  if (isInstagramLoginAccount(account)) {
    await replyToInstagramLoginMessage(senderId, input.text, accessToken);
    return;
  }
  await replyToInstagramMessage(senderId, input.text, { accessToken, igBusinessId: accountId, pageId: pageId || undefined });
}

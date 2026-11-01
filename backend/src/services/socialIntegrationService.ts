import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { decryptValueRaw, encryptValueRaw, getEncryptionKey } from './vaultCrypto';
import { supabaseFallbackService } from './supabaseFallbackService';

type EncryptedField = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

export type YouTubeIntegrationRecord = {
  userId: string;
  provider: 'youtube';
  refreshTokenEncrypted: EncryptedField;
  accessTokenEncrypted?: EncryptedField;
  accessTokenExpiresAt?: number | null;
  channelId?: string | null;
  channelTitle?: string | null;
  privacyStatus?: 'private' | 'public' | 'unlisted';
  refreshTokenRevealPending?: boolean;
  refreshTokenRevealedAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
};

export type TikTokIntegrationRecord = {
  userId: string;
  provider: 'tiktok';
  accessTokenEncrypted: EncryptedField;
  refreshTokenEncrypted?: EncryptedField;
  accessTokenExpiresAt?: number | null;
  refreshTokenExpiresAt?: number | null;
  openId?: string | null;
  scope?: string | null;
  refreshTokenRevealPending?: boolean;
  refreshTokenRevealedAt?: admin.firestore.Timestamp | null;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
};

type YouTubeIntegrationInput = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number | null;
  channelId?: string | null;
  channelTitle?: string | null;
  privacyStatus?: 'private' | 'public' | 'unlisted';
  revealToken?: boolean;
};

type TikTokIntegrationInput = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number | null;
  refreshTokenExpiresAt?: number | null;
  openId?: string | null;
  scope?: string | null;
  revealToken?: boolean;
};

const integrationsCollection = firestore.collection('socialIntegrations');
const encryptionKey = getEncryptionKey();

const toEncrypted = (value: string): EncryptedField => {
  const { iv, ciphertext, authTag } = encryptValueRaw(value, encryptionKey);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  };
};

const fromEncrypted = (payload: EncryptedField): string => {
  return decryptValueRaw(
    {
      iv: Buffer.from(payload.iv, 'base64'),
      ciphertext: Buffer.from(payload.ciphertext, 'base64'),
      authTag: Buffer.from(payload.authTag, 'base64'),
    },
    encryptionKey,
  );
};

const docIdForProvider = (userId: string, provider: string) => `${userId}_${provider}`;
const docIdFor = (userId: string) => docIdForProvider(userId, 'youtube');

export async function upsertYouTubeIntegration(userId: string, payload: YouTubeIntegrationInput) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  const now = admin.firestore.FieldValue.serverTimestamp();
  const snap = await ref.get();
  const update: Record<string, unknown> = {
    userId,
    provider: 'youtube',
    updatedAt: now,
  };

  if (!snap.exists) {
    update.createdAt = now;
  }

  update.refreshTokenEncrypted = toEncrypted(payload.refreshToken);
  if (payload.accessToken) {
    update.accessTokenEncrypted = toEncrypted(payload.accessToken);
  }
  if (typeof payload.accessTokenExpiresAt === 'number') {
    update.accessTokenExpiresAt = payload.accessTokenExpiresAt;
  }
  if (payload.channelId !== undefined) update.channelId = payload.channelId;
  if (payload.channelTitle !== undefined) update.channelTitle = payload.channelTitle;
  if (payload.privacyStatus) update.privacyStatus = payload.privacyStatus;
  if (payload.revealToken === true) {
    update.refreshTokenRevealPending = true;
    update.refreshTokenRevealedAt = null;
  }
  if (payload.revealToken === false) {
    update.refreshTokenRevealPending = false;
  }

  await ref.set(update, { merge: true });
  return { id: ref.id };
}

export async function updateYouTubeAccessToken(
  userId: string,
  data: { accessToken?: string; accessTokenExpiresAt?: number | null },
) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  const update: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (data.accessToken) {
    update.accessTokenEncrypted = toEncrypted(data.accessToken);
  }
  if (typeof data.accessTokenExpiresAt === 'number') {
    update.accessTokenExpiresAt = data.accessTokenExpiresAt;
  }
  await ref.set(update, { merge: true });
}

export async function getYouTubeIntegration(userId: string) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as YouTubeIntegrationRecord;
  return {
    userId,
    provider: 'youtube' as const,
    channelId: data.channelId ?? null,
    channelTitle: data.channelTitle ?? null,
    privacyStatus: data.privacyStatus ?? 'unlisted',
    connected: Boolean(data.refreshTokenEncrypted),
    refreshTokenRevealPending: Boolean(data.refreshTokenRevealPending),
    updatedAt: data.updatedAt?.toDate?.().toISOString?.() ?? null,
  };
}

export async function getYouTubeIntegrationSecrets(userId: string) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as YouTubeIntegrationRecord;
  if (!data.refreshTokenEncrypted) return null;
  return {
    userId,
    refreshToken: fromEncrypted(data.refreshTokenEncrypted),
    accessToken: data.accessTokenEncrypted ? fromEncrypted(data.accessTokenEncrypted) : undefined,
    accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
    channelId: data.channelId ?? null,
    channelTitle: data.channelTitle ?? null,
    privacyStatus: data.privacyStatus ?? 'unlisted',
  };
}

export async function revealYouTubeRefreshToken(userId: string) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as YouTubeIntegrationRecord;
  if (!data.refreshTokenEncrypted || !data.refreshTokenRevealPending) {
    return { revealed: false };
  }
  const refreshToken = fromEncrypted(data.refreshTokenEncrypted);
  await ref.set(
    {
      refreshTokenRevealPending: false,
      refreshTokenRevealedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { revealed: true, refreshToken };
}

export async function disconnectYouTube(userId: string) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  await ref.delete();
}

export async function updateYouTubeIntegrationDefaults(
  userId: string,
  payload: { privacyStatus?: 'private' | 'public' | 'unlisted' },
) {
  const ref = integrationsCollection.doc(docIdFor(userId));
  const update: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (payload.privacyStatus) {
    update.privacyStatus = payload.privacyStatus;
  }
  await ref.set(update, { merge: true });
}

const docIdForTikTok = (userId: string) => docIdForProvider(userId, 'tiktok');

const readLegacyTikTokIntegration = async (userId: string): Promise<TikTokIntegrationRecord | null> => {
  try {
    const snap = await integrationsCollection.doc(docIdForTikTok(userId)).get();
    return snap.exists ? (snap.data() as TikTokIntegrationRecord) : null;
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? 'unknown');
    console.warn('[tiktok] legacy Firebase lookup skipped', { code: code.slice(0, 80) });
    return null;
  }
};

const toDateString = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
};

const isEncryptedField = (value: unknown): value is EncryptedField => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EncryptedField>;
  return typeof candidate.iv === 'string' && typeof candidate.authTag === 'string' && typeof candidate.ciphertext === 'string';
};

const parseTikTokRecord = (userId: string, value: unknown): TikTokIntegrationRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TikTokIntegrationRecord>;
  if (!isEncryptedField(candidate.accessTokenEncrypted)) return null;
  return {
    userId,
    provider: 'tiktok',
    accessTokenEncrypted: candidate.accessTokenEncrypted,
    refreshTokenEncrypted: isEncryptedField(candidate.refreshTokenEncrypted) ? candidate.refreshTokenEncrypted : undefined,
    accessTokenExpiresAt: typeof candidate.accessTokenExpiresAt === 'number' ? candidate.accessTokenExpiresAt : null,
    refreshTokenExpiresAt: typeof candidate.refreshTokenExpiresAt === 'number' ? candidate.refreshTokenExpiresAt : null,
    openId: typeof candidate.openId === 'string' ? candidate.openId : null,
    scope: typeof candidate.scope === 'string' ? candidate.scope : null,
    refreshTokenRevealPending: candidate.refreshTokenRevealPending === true,
    updatedAt: candidate.updatedAt as TikTokIntegrationRecord['updatedAt'],
  };
};

const loadTikTokRecord = async (userId: string) => {
  const stored = await supabaseFallbackService.getTikTokIntegration(userId);
  return parseTikTokRecord(userId, stored) ?? (await readLegacyTikTokIntegration(userId));
};

export async function upsertTikTokIntegration(userId: string, payload: TikTokIntegrationInput) {
  const update: Record<string, unknown> = {
    userId,
    provider: 'tiktok',
    updatedAt: new Date().toISOString(),
  };

  update.accessTokenEncrypted = toEncrypted(payload.accessToken);
  if (payload.refreshToken) {
    update.refreshTokenEncrypted = toEncrypted(payload.refreshToken);
  }
  if (typeof payload.accessTokenExpiresAt === 'number') {
    update.accessTokenExpiresAt = payload.accessTokenExpiresAt;
  }
  if (typeof payload.refreshTokenExpiresAt === 'number') {
    update.refreshTokenExpiresAt = payload.refreshTokenExpiresAt;
  }
  if (payload.openId !== undefined) update.openId = payload.openId;
  if (payload.scope !== undefined) update.scope = payload.scope;
  if (payload.revealToken === true) {
    update.refreshTokenRevealPending = true;
    update.refreshTokenRevealedAt = null;
  }
  if (payload.revealToken === false) {
    update.refreshTokenRevealPending = false;
  }

  await supabaseFallbackService.upsertTikTokIntegration(userId, update);
  return { id: docIdForTikTok(userId), store: 'supabase' as const };
}

export async function updateTikTokAccessToken(
  userId: string,
  data: { accessToken: string; accessTokenExpiresAt?: number | null },
) {
  const update: Record<string, unknown> = {
    accessTokenEncrypted: toEncrypted(data.accessToken),
    updatedAt: new Date().toISOString(),
  };
  if (typeof data.accessTokenExpiresAt === 'number') {
    update.accessTokenExpiresAt = data.accessTokenExpiresAt;
  }
  const existing = await loadTikTokRecord(userId);
  await supabaseFallbackService.upsertTikTokIntegration(userId, {
    ...(existing ?? { userId, provider: 'tiktok' }),
    ...update,
  });
}

export async function getTikTokIntegration(userId: string) {
  const data = await loadTikTokRecord(userId);
  if (!data) return null;
  return {
    userId,
    provider: 'tiktok' as const,
    openId: data.openId ?? null,
    scope: data.scope ?? null,
    connected: Boolean(data.accessTokenEncrypted),
    refreshTokenRevealPending: Boolean(data.refreshTokenRevealPending),
    updatedAt: toDateString(data.updatedAt),
  };
}

export async function getTikTokIntegrationSecrets(userId: string) {
  const data = await loadTikTokRecord(userId);
  if (!data) return null;
  if (!data.accessTokenEncrypted) return null;
  return {
    userId,
    accessToken: fromEncrypted(data.accessTokenEncrypted),
    refreshToken: data.refreshTokenEncrypted ? fromEncrypted(data.refreshTokenEncrypted) : undefined,
    accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
    refreshTokenExpiresAt: data.refreshTokenExpiresAt ?? null,
    openId: data.openId ?? null,
    scope: data.scope ?? null,
  };
}

export async function revealTikTokRefreshToken(userId: string) {
  const data = await loadTikTokRecord(userId);
  if (!data) return null;
  if (!data.refreshTokenEncrypted || !data.refreshTokenRevealPending) {
    return { revealed: false };
  }
  const refreshToken = fromEncrypted(data.refreshTokenEncrypted);
  await supabaseFallbackService.upsertTikTokIntegration(userId, {
    ...data,
    refreshTokenRevealPending: false,
    refreshTokenRevealedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { revealed: true, refreshToken };
}

export async function disconnectTikTok(userId: string) {
  await supabaseFallbackService.deleteTikTokIntegration(userId);
}

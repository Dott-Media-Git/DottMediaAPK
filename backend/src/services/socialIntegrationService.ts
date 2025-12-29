import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { decryptValueRaw, encryptValueRaw, getEncryptionKey } from './vaultCrypto';

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

type YouTubeIntegrationInput = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number | null;
  channelId?: string | null;
  channelTitle?: string | null;
  privacyStatus?: 'private' | 'public' | 'unlisted';
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

const docIdFor = (userId: string) => `${userId}_youtube`;

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

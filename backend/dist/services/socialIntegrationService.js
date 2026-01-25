import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { decryptValueRaw, encryptValueRaw, getEncryptionKey } from './vaultCrypto.js';
const integrationsCollection = firestore.collection('socialIntegrations');
const encryptionKey = getEncryptionKey();
const toEncrypted = (value) => {
    const { iv, ciphertext, authTag } = encryptValueRaw(value, encryptionKey);
    return {
        iv: iv.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        authTag: authTag.toString('base64'),
    };
};
const fromEncrypted = (payload) => {
    return decryptValueRaw({
        iv: Buffer.from(payload.iv, 'base64'),
        ciphertext: Buffer.from(payload.ciphertext, 'base64'),
        authTag: Buffer.from(payload.authTag, 'base64'),
    }, encryptionKey);
};
const docIdForProvider = (userId, provider) => `${userId}_${provider}`;
const docIdFor = (userId) => docIdForProvider(userId, 'youtube');
export async function upsertYouTubeIntegration(userId, payload) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    const now = admin.firestore.FieldValue.serverTimestamp();
    const snap = await ref.get();
    const update = {
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
    if (payload.channelId !== undefined)
        update.channelId = payload.channelId;
    if (payload.channelTitle !== undefined)
        update.channelTitle = payload.channelTitle;
    if (payload.privacyStatus)
        update.privacyStatus = payload.privacyStatus;
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
export async function updateYouTubeAccessToken(userId, data) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    const update = {
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
export async function getYouTubeIntegration(userId) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    return {
        userId,
        provider: 'youtube',
        channelId: data.channelId ?? null,
        channelTitle: data.channelTitle ?? null,
        privacyStatus: data.privacyStatus ?? 'unlisted',
        connected: Boolean(data.refreshTokenEncrypted),
        refreshTokenRevealPending: Boolean(data.refreshTokenRevealPending),
        updatedAt: data.updatedAt?.toDate?.().toISOString?.() ?? null,
    };
}
export async function getYouTubeIntegrationSecrets(userId) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (!data.refreshTokenEncrypted)
        return null;
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
export async function revealYouTubeRefreshToken(userId) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (!data.refreshTokenEncrypted || !data.refreshTokenRevealPending) {
        return { revealed: false };
    }
    const refreshToken = fromEncrypted(data.refreshTokenEncrypted);
    await ref.set({
        refreshTokenRevealPending: false,
        refreshTokenRevealedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { revealed: true, refreshToken };
}
export async function disconnectYouTube(userId) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    await ref.delete();
}
export async function updateYouTubeIntegrationDefaults(userId, payload) {
    const ref = integrationsCollection.doc(docIdFor(userId));
    const update = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (payload.privacyStatus) {
        update.privacyStatus = payload.privacyStatus;
    }
    await ref.set(update, { merge: true });
}
const docIdForTikTok = (userId) => docIdForProvider(userId, 'tiktok');
export async function upsertTikTokIntegration(userId, payload) {
    const ref = integrationsCollection.doc(docIdForTikTok(userId));
    const now = admin.firestore.FieldValue.serverTimestamp();
    const snap = await ref.get();
    const update = {
        userId,
        provider: 'tiktok',
        updatedAt: now,
    };
    if (!snap.exists) {
        update.createdAt = now;
    }
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
    if (payload.openId !== undefined)
        update.openId = payload.openId;
    if (payload.scope !== undefined)
        update.scope = payload.scope;
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
export async function updateTikTokAccessToken(userId, data) {
    const ref = integrationsCollection.doc(docIdForTikTok(userId));
    const update = {
        accessTokenEncrypted: toEncrypted(data.accessToken),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (typeof data.accessTokenExpiresAt === 'number') {
        update.accessTokenExpiresAt = data.accessTokenExpiresAt;
    }
    await ref.set(update, { merge: true });
}
export async function getTikTokIntegration(userId) {
    const ref = integrationsCollection.doc(docIdForTikTok(userId));
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    return {
        userId,
        provider: 'tiktok',
        openId: data.openId ?? null,
        scope: data.scope ?? null,
        connected: Boolean(data.accessTokenEncrypted),
        refreshTokenRevealPending: Boolean(data.refreshTokenRevealPending),
        updatedAt: data.updatedAt?.toDate?.().toISOString?.() ?? null,
    };
}
export async function getTikTokIntegrationSecrets(userId) {
    const ref = integrationsCollection.doc(docIdForTikTok(userId));
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (!data.accessTokenEncrypted)
        return null;
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
export async function revealTikTokRefreshToken(userId) {
    const ref = integrationsCollection.doc(docIdForTikTok(userId));
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    if (!data.refreshTokenEncrypted || !data.refreshTokenRevealPending) {
        return { revealed: false };
    }
    const refreshToken = fromEncrypted(data.refreshTokenEncrypted);
    await ref.set({
        refreshTokenRevealPending: false,
        refreshTokenRevealedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { revealed: true, refreshToken };
}
export async function disconnectTikTok(userId) {
    const ref = integrationsCollection.doc(docIdForTikTok(userId));
    await ref.delete();
}

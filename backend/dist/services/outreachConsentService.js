import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
const consentCollection = firestore.collection('outreachConsent');
const suppressionCollection = firestore.collection('outreachSuppression');
const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'remove me', 'no dm', 'no message', 'do not message'];
const safeId = (value) => Buffer.from(value).toString('base64url');
export const normalizeOutreachRecipient = (platform, recipient) => {
    const value = String(recipient ?? '').trim();
    if (!value)
        return '';
    if (platform === 'instagram' || platform === 'x')
        return value.replace(/^@/, '').toLowerCase();
    if (platform === 'whatsapp')
        return value.replace(/[^\d+]/g, '');
    return value;
};
const keyParts = (ownerId, platform, recipient) => ({
    owner: ownerId?.trim() || 'global',
    platform,
    recipient: normalizeOutreachRecipient(platform, recipient),
});
const docId = (ownerId, platform, recipient) => {
    const parts = keyParts(ownerId, platform, recipient);
    return safeId(`${parts.owner}:${parts.platform}:${parts.recipient}`);
};
export const isOptOutText = (text) => {
    const normalized = String(text ?? '').toLowerCase();
    return OPT_OUT_KEYWORDS.some(keyword => normalized.includes(keyword));
};
export async function recordOutreachOptIn(input) {
    const recipientId = normalizeOutreachRecipient(input.platform, input.recipientId);
    if (!recipientId)
        return;
    const ref = consentCollection.doc(docId(input.ownerId, input.platform, recipientId));
    await ref.set({
        ownerId: input.ownerId ?? null,
        platform: input.platform,
        recipientId,
        source: input.source,
        status: 'opted_in',
        lastText: input.text ? String(input.text).slice(0, 500) : null,
        metadata: input.metadata ?? {},
        optedInAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
export async function recordOutreachOptOut(input) {
    const recipientId = normalizeOutreachRecipient(input.platform, input.recipientId);
    if (!recipientId)
        return;
    const id = docId(input.ownerId, input.platform, recipientId);
    await Promise.all([
        consentCollection.doc(id).set({
            ownerId: input.ownerId ?? null,
            platform: input.platform,
            recipientId,
            status: 'opted_out',
            optOutText: input.text ? String(input.text).slice(0, 500) : null,
            optedOutAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }),
        suppressionCollection.doc(id).set({
            ownerId: input.ownerId ?? null,
            channel: input.platform,
            recipientId,
            reason: input.reason ?? 'recipient_opt_out',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }),
    ]);
}
export async function recordOptOutIfRequested(input) {
    if (!isOptOutText(input.text))
        return false;
    await recordOutreachOptOut({ ...input, reason: 'recipient_requested_stop' });
    return true;
}
export async function loadWarmOutreachState(ownerId) {
    const optedIn = new Set();
    const suppressed = new Set();
    if (!ownerId)
        return { optedIn, suppressed };
    const [consentSnap, suppressionSnap] = await Promise.all([
        consentCollection.where('ownerId', '==', ownerId).limit(5000).get(),
        suppressionCollection.where('ownerId', '==', ownerId).limit(5000).get(),
    ]);
    consentSnap.forEach(doc => {
        const data = doc.data();
        if (!data.platform || !data.recipientId)
            return;
        const key = `${data.platform}:${normalizeOutreachRecipient(data.platform, data.recipientId)}`;
        if (data.status === 'opted_out')
            suppressed.add(key);
        if (data.status === 'opted_in')
            optedIn.add(key);
    });
    suppressionSnap.forEach(doc => {
        const data = doc.data();
        const platform = data.channel;
        const recipient = data.recipientId ?? data.handle;
        if (!platform || !recipient)
            return;
        suppressed.add(`${platform}:${normalizeOutreachRecipient(platform, recipient)}`);
    });
    return { optedIn, suppressed };
}

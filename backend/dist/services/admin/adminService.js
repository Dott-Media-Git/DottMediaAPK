import admin from 'firebase-admin';
import Stripe from 'stripe';
import createHttpError from 'http-errors';
import { firestore } from '../../db/firestore.js';
import { putSecret, getSecret } from '../secretVaultService.js';
import { validateSettingsPatch } from './settingsValidator.js';
const orgsCollection = firestore.collection('orgs');
const orgUsersCollection = firestore.collection('orgUsers');
const orgSettingsCollection = firestore.collection('orgSettings');
const secretsCollection = firestore.collection('secrets');
const usageCollection = firestore.collection('usageDaily');
const plansCollection = firestore.collection('plans');
const auditCollection = firestore.collection('audit');
const opsJobsCollection = firestore.collection('ops').doc('jobs').collection('queue');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const defaultSettings = {
    channels: {
        whatsapp: { enabled: false },
        instagram: { enabled: false },
        facebook: { enabled: false },
        linkedin: { enabled: false },
        web: { enabled: true },
    },
    features: {
        leadGen: true,
        crm: true,
        support: true,
        booking: true,
        outbound: true,
        contentEngagement: true,
        retargeting: true,
    },
    booking: {
        provider: 'google',
        calendarId: '',
    },
    knowledgeBase: { sources: [] },
    webWidget: { theme: 'dott', accent: '#FF7A00', position: 'right' },
};
export async function createOrg(payload) {
    const orgRef = orgsCollection.doc();
    const orgDoc = {
        name: payload.name,
        plan: payload.plan ?? 'Free',
        locale: {
            lang: payload.locale?.lang ?? 'en',
            tz: payload.locale?.tz ?? 'UTC',
            currency: payload.locale?.currency ?? 'USD',
        },
        createdAt: Date.now(),
        ownerUid: payload.ownerUid,
        logoUrl: payload.logoUrl,
    };
    await orgRef.set(orgDoc);
    const membershipId = `${orgRef.id}_${payload.ownerUid}`;
    const membership = {
        orgId: orgRef.id,
        uid: payload.ownerUid,
        role: 'Owner',
        createdAt: Date.now(),
    };
    await orgUsersCollection.doc(membershipId).set(membership);
    await orgSettingsCollection.doc(orgRef.id).set({ ...defaultSettings });
    return { id: orgRef.id, ...orgDoc };
}
export async function getOrg(orgId) {
    const snap = await orgsCollection.doc(orgId).get();
    if (!snap.exists)
        throw createHttpError(404, 'Org not found');
    return { id: orgId, ...snap.data() };
}
export async function updateOrg(orgId, data) {
    await orgsCollection.doc(orgId).set({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return getOrg(orgId);
}
export async function listOrgUsers(orgId) {
    const snap = await orgUsersCollection.where('orgId', '==', orgId).get();
    return snap.docs.map(doc => doc.data());
}
export async function inviteOrgUser(orgId, uid, role, invitedBy) {
    const docId = `${orgId}_${uid}`;
    const payload = {
        orgId,
        uid,
        role,
        invitedBy,
        createdAt: Date.now(),
    };
    await orgUsersCollection.doc(docId).set(payload);
    return payload;
}
export async function updateOrgUserRole(orgId, uid, role) {
    await orgUsersCollection.doc(`${orgId}_${uid}`).set({ role }, { merge: true });
}
export async function removeOrgUser(orgId, uid) {
    await orgUsersCollection.doc(`${orgId}_${uid}`).delete();
}
export async function getOrgSettings(orgId) {
    const doc = await orgSettingsCollection.doc(orgId).get();
    if (!doc.exists) {
        await orgSettingsCollection.doc(orgId).set(defaultSettings);
        return defaultSettings;
    }
    return doc.data();
}
export async function updateOrgSettings(orgId, updates) {
    const validated = validateSettingsPatch(updates);
    await orgSettingsCollection.doc(orgId).set({
        ...validated,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return getOrgSettings(orgId);
}
export async function connectChannel(orgId, channel, payload) {
    const key = `${channel.toUpperCase()}_TOKEN`;
    if (payload.token) {
        await putSecret(orgId, key, payload.token);
    }
    const settings = await getOrgSettings(orgId);
    settings.channels[channel] = {
        ...settings.channels[channel],
        enabled: true,
        tokenRef: `vault/${orgId}_${key}`,
        ...(payload.metadata ?? {}),
    };
    await orgSettingsCollection.doc(orgId).set({ channels: settings.channels }, { merge: true });
    return settings.channels[channel];
}
export async function disconnectChannel(orgId, channel) {
    const settings = await getOrgSettings(orgId);
    if (!settings.channels[channel]) {
        throw createHttpError(404, 'Channel not configured');
    }
    settings.channels[channel] = {
        enabled: false,
    };
    await orgSettingsCollection.doc(orgId).set({ channels: settings.channels }, { merge: true });
}
export async function storeSecret(orgId, key, value) {
    await putSecret(orgId, key, value);
}
export async function describeSecret(orgId, key) {
    return getSecret(orgId, key, { decrypt: false });
}
export async function getUsage(orgId, from, to) {
    let query = usageCollection.where('orgId', '==', orgId).orderBy('date', 'desc').limit(30);
    if (from)
        query = query.where('date', '>=', from);
    if (to)
        query = query.where('date', '<=', to);
    const snap = await query.get();
    return snap.docs.map(doc => doc.data());
}
export async function listPlans() {
    const snap = await plansCollection.get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
export async function swapPlan(orgId, plan, successUrl, cancelUrl) {
    if (!stripe)
        throw createHttpError(500, 'Stripe is not configured');
    const priceId = plan === 'Enterprise'
        ? process.env.STRIPE_PRICE_ENTERPRISE
        : plan === 'Pro'
            ? process.env.STRIPE_PRICE_PRO
            : null;
    if (!priceId)
        throw createHttpError(400, 'Unsupported plan for checkout');
    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { orgId, plan },
    });
    return { checkoutUrl: session.url };
}
export async function enqueueJob(orgId, type, uid) {
    const ref = opsJobsCollection.doc();
    await ref.set({
        jobId: ref.id,
        orgId,
        type,
        status: 'queued',
        requestedBy: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { jobId: ref.id };
}
export async function logAuditEvent(orgId, uid, action, resource, meta) {
    const ref = auditCollection.doc(orgId).collection('events').doc();
    await ref.set({
        ts: admin.firestore.FieldValue.serverTimestamp(),
        uid,
        action,
        resource,
        meta,
    });
}

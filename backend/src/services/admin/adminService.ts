import admin from 'firebase-admin';
import Stripe from 'stripe';
import createHttpError from 'http-errors';
import { firestore } from '../../db/firestore';
import { OrgDocument, OrgLocale, OrgPlan, OrgSettingsDocument, OrgUserDocument } from '../../types/org';
import { putSecret, getSecret } from '../secretVaultService';
import { validateSettingsPatch } from './settingsValidator';

const orgsCollection = firestore.collection('orgs');
const orgUsersCollection = firestore.collection('orgUsers');
const orgSettingsCollection = firestore.collection('orgSettings');
const secretsCollection = firestore.collection('secrets');
const usageCollection = firestore.collection('usageDaily');
const plansCollection = firestore.collection('plans');
const auditCollection = firestore.collection('audit');
const opsJobsCollection = firestore.collection('ops').doc('jobs').collection('queue');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const defaultSettings: OrgSettingsDocument = {
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

export async function createOrg(payload: {
  name: string;
  ownerUid: string;
  plan?: OrgPlan;
  locale?: Partial<OrgLocale>;
  logoUrl?: string;
}) {
  const orgRef = orgsCollection.doc();
  const orgDoc: OrgDocument = {
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
  const membership: OrgUserDocument = {
    orgId: orgRef.id,
    uid: payload.ownerUid,
    role: 'Owner',
    createdAt: Date.now(),
  };
  await orgUsersCollection.doc(membershipId).set(membership);
  await orgSettingsCollection.doc(orgRef.id).set({ ...defaultSettings });
  return { id: orgRef.id, ...orgDoc };
}

export async function getOrg(orgId: string) {
  const snap = await orgsCollection.doc(orgId).get();
  if (!snap.exists) throw createHttpError(404, 'Org not found');
  return { id: orgId, ...(snap.data() as OrgDocument) };
}

export async function updateOrg(orgId: string, data: Partial<Pick<OrgDocument, 'name' | 'logoUrl' | 'plan' | 'locale'>>) {
  await orgsCollection.doc(orgId).set(
    {
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return getOrg(orgId);
}

export async function listOrgUsers(orgId: string) {
  const snap = await orgUsersCollection.where('orgId', '==', orgId).get();
  return snap.docs.map(doc => doc.data() as OrgUserDocument);
}

export async function inviteOrgUser(orgId: string, uid: string, role: OrgUserDocument['role'], invitedBy: string) {
  const docId = `${orgId}_${uid}`;
  const payload: OrgUserDocument = {
    orgId,
    uid,
    role,
    invitedBy,
    createdAt: Date.now(),
  };
  await orgUsersCollection.doc(docId).set(payload);
  return payload;
}

export async function updateOrgUserRole(orgId: string, uid: string, role: OrgUserDocument['role']) {
  await orgUsersCollection.doc(`${orgId}_${uid}`).set({ role }, { merge: true });
}

export async function removeOrgUser(orgId: string, uid: string) {
  await orgUsersCollection.doc(`${orgId}_${uid}`).delete();
}

export async function getOrgSettings(orgId: string) {
  const doc = await orgSettingsCollection.doc(orgId).get();
  if (!doc.exists) {
    await orgSettingsCollection.doc(orgId).set(defaultSettings);
    return defaultSettings;
  }
  return doc.data() as OrgSettingsDocument;
}

export async function updateOrgSettings(orgId: string, updates: Partial<OrgSettingsDocument>) {
  const validated = validateSettingsPatch(updates);
  await orgSettingsCollection.doc(orgId).set(
    {
      ...validated,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return getOrgSettings(orgId);
}

export async function connectChannel(
  orgId: string,
  channel: string,
  payload: { token?: string; metadata?: Record<string, string>; [key: string]: unknown },
) {
  const key = `${channel.toUpperCase()}_TOKEN`;
  if (payload.token) {
    await putSecret(orgId, key, payload.token);
  }
  const settings = await getOrgSettings(orgId);
  settings.channels[channel as keyof typeof settings.channels] = {
    ...settings.channels[channel as keyof typeof settings.channels],
    enabled: true,
    tokenRef: `vault/${orgId}_${key}`,
    ...(payload.metadata ?? {}),
  };
  await orgSettingsCollection.doc(orgId).set({ channels: settings.channels }, { merge: true });
  return settings.channels[channel as keyof typeof settings.channels];
}

export async function disconnectChannel(orgId: string, channel: string) {
  const settings = await getOrgSettings(orgId);
  if (!settings.channels[channel as keyof typeof settings.channels]) {
    throw createHttpError(404, 'Channel not configured');
  }
  settings.channels[channel as keyof typeof settings.channels] = {
    enabled: false,
  } as any;
  await orgSettingsCollection.doc(orgId).set({ channels: settings.channels }, { merge: true });
}

export async function storeSecret(orgId: string, key: string, value: string) {
  await putSecret(orgId, key, value);
}

export async function describeSecret(orgId: string, key: string) {
  return getSecret(orgId, key, { decrypt: false });
}

export async function getUsage(orgId: string, from?: string, to?: string) {
  let query = usageCollection.where('orgId', '==', orgId).orderBy('date', 'desc').limit(30);
  if (from) query = query.where('date', '>=', from);
  if (to) query = query.where('date', '<=', to);
  const snap = await query.get();
  return snap.docs.map(doc => doc.data());
}

export async function listPlans() {
  const snap = await plansCollection.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function swapPlan(orgId: string, plan: OrgPlan, successUrl: string, cancelUrl: string) {
  if (!stripe) throw createHttpError(500, 'Stripe is not configured');
  const priceId =
    plan === 'Enterprise'
      ? process.env.STRIPE_PRICE_ENTERPRISE
      : plan === 'Pro'
      ? process.env.STRIPE_PRICE_PRO
      : null;
  if (!priceId) throw createHttpError(400, 'Unsupported plan for checkout');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { orgId, plan },
  });
  return { checkoutUrl: session.url };
}

export async function enqueueJob(orgId: string, type: string, uid: string) {
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

export async function logAuditEvent(orgId: string, uid: string, action: string, resource: string, meta?: Record<string, unknown>) {
  const ref = auditCollection.doc(orgId).collection('events').doc();
  await ref.set({
    ts: admin.firestore.FieldValue.serverTimestamp(),
    uid,
    action,
    resource,
    meta,
  });
}

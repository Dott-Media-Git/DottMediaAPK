import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';
import { ActivationPayload } from '../types/automation';

const automationsCollection = firestore.collection('automations');
const analyticsCollection = firestore.collection('analytics');

const jobDoc = (userId: string, jobId: string) =>
  automationsCollection.doc(userId).collection('jobs').doc(jobId);

export async function createJobDoc(userId: string, jobId: string, payload: ActivationPayload) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await jobDoc(userId, jobId).set({
    jobId,
    userId,
    company: payload.company,
    contact: payload.contact,
    socials: payload.socials ?? [],
    status: 'queued',
    scenarioId: null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function upsertJobDoc(userId: string, jobId: string, data: Record<string, unknown>) {
  await jobDoc(userId, jobId).set(
    {
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getJobDoc(userId: string, jobId: string) {
  const snap = await jobDoc(userId, jobId).get();
  return snap.exists ? snap.data() : null;
}

export async function findJobById(jobId: string) {
  const query = await firestore.collectionGroup('jobs').where('jobId', '==', jobId).limit(1).get();
  if (query.empty) return null;
  const doc = query.docs[0];
  return { userId: doc.ref.parent.parent?.id, ...doc.data() };
}

export type AnalyticsSample = {
  date: string;
  leads: number;
  engagement: number;
  conversions: number;
  feedbackScore: number;
};

export async function recordAnalyticsSample(userId: string, sample: AnalyticsSample) {
  const dailyDoc = analyticsCollection.doc(userId).collection('daily').doc(sample.date);
  await dailyDoc.set(
    {
      date: sample.date,
      leads: admin.firestore.FieldValue.increment(sample.leads),
      engagement: admin.firestore.FieldValue.increment(sample.engagement),
      conversions: admin.firestore.FieldValue.increment(sample.conversions),
      feedbackScore: admin.firestore.FieldValue.increment(sample.feedbackScore),
      samples: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

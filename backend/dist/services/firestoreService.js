import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';
const automationsCollection = firestore.collection('automations');
const analyticsCollection = firestore.collection('analytics');
const jobDoc = (userId, jobId) => automationsCollection.doc(userId).collection('jobs').doc(jobId);
export async function createJobDoc(userId, jobId, payload) {
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
export async function upsertJobDoc(userId, jobId, data) {
    await jobDoc(userId, jobId).set({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
export async function getJobDoc(userId, jobId) {
    const snap = await jobDoc(userId, jobId).get();
    return snap.exists ? snap.data() : null;
}
export async function findJobById(jobId) {
    const query = await firestore.collectionGroup('jobs').where('jobId', '==', jobId).limit(1).get();
    if (query.empty)
        return null;
    const doc = query.docs[0];
    return { userId: doc.ref.parent.parent?.id, ...doc.data() };
}
export async function recordAnalyticsSample(userId, sample) {
    const dailyDoc = analyticsCollection.doc(userId).collection('daily').doc(sample.date);
    await dailyDoc.set({
        date: sample.date,
        leads: admin.firestore.FieldValue.increment(sample.leads),
        engagement: admin.firestore.FieldValue.increment(sample.engagement),
        conversions: admin.firestore.FieldValue.increment(sample.conversions),
        feedbackScore: admin.firestore.FieldValue.increment(sample.feedbackScore),
        samples: admin.firestore.FieldValue.increment(1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

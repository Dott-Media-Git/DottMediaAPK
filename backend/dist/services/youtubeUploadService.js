import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { youtubeQueue } from '../queues/youtubeQueue.js';
const youtubeJobsCollection = firestore.collection('youtubeJobs');
export const enqueueYouTubeUpload = async (userId, payload) => {
    const ref = youtubeJobsCollection.doc();
    const jobId = ref.id;
    await ref.set({
        userId,
        jobType: 'upload',
        status: 'queued',
        payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await youtubeQueue.add('upload', { jobId, userId, type: 'upload', payload }, { jobId });
    return { jobId };
};
export const enqueueYouTubePublish = async (jobId, userId, payload, delayMs) => {
    await youtubeQueue.add('publish', { jobId, userId, type: 'publish', payload }, { jobId: `${jobId}-publish`, delay: Math.max(delayMs, 0) });
};
export const enqueueYouTubeSoraUpload = async (userId, payload) => {
    const ref = youtubeJobsCollection.doc();
    const jobId = ref.id;
    await ref.set({
        userId,
        jobType: 'sora',
        status: 'queued',
        payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await youtubeQueue.add('sora', { jobId, userId, type: 'sora', payload }, { jobId });
    return { jobId };
};
export const updateYouTubeJob = async (jobId, data) => {
    await youtubeJobsCollection.doc(jobId).set({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
};
export const getYouTubeJobStatus = async (jobId) => {
    const snap = await youtubeJobsCollection.doc(jobId).get();
    if (!snap.exists)
        return null;
    return { id: snap.id, ...snap.data() };
};

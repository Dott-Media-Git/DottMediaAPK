import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { youtubeQueue } from '../queues/youtubeQueue';

export type YouTubeUploadPayload = {
  videoUrl: string;
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'private' | 'public' | 'unlisted';
  scheduledPublishTime?: string;
  shorts?: boolean;
};

export type YouTubeSoraPayload = {
  prompt: string;
  model?: 'sora-2' | 'sora-2-pro';
  seconds?: '4' | '8' | '12';
  size?: '720x1280' | '1280x720' | '1024x1792' | '1792x1024';
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'private' | 'public' | 'unlisted';
  scheduledPublishTime?: string;
  shorts?: boolean;
};

export type YouTubeJobData =
  | {
      jobId: string;
      userId: string;
      type: 'upload';
      payload: YouTubeUploadPayload;
    }
  | {
      jobId: string;
      userId: string;
      type: 'publish';
      payload: YouTubeUploadPayload & { videoId: string };
    }
  | {
      jobId: string;
      userId: string;
      type: 'sora';
      payload: YouTubeSoraPayload;
    };

export type YouTubeJobRecord = {
  id: string;
  userId?: string;
  [key: string]: unknown;
};

const youtubeJobsCollection = firestore.collection('youtubeJobs');

export const enqueueYouTubeUpload = async (userId: string, payload: YouTubeUploadPayload) => {
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

export const enqueueYouTubePublish = async (
  jobId: string,
  userId: string,
  payload: YouTubeUploadPayload & { videoId: string },
  delayMs: number,
) => {
  await youtubeQueue.add(
    'publish',
    { jobId, userId, type: 'publish', payload },
    { jobId: `${jobId}-publish`, delay: Math.max(delayMs, 0) },
  );
};

export const enqueueYouTubeSoraUpload = async (userId: string, payload: YouTubeSoraPayload) => {
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

export const updateYouTubeJob = async (jobId: string, data: Record<string, unknown>) => {
  await youtubeJobsCollection.doc(jobId).set(
    {
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
};

export const getYouTubeJobStatus = async (jobId: string): Promise<YouTubeJobRecord | null> => {
  const snap = await youtubeJobsCollection.doc(jobId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) } as YouTubeJobRecord;
};

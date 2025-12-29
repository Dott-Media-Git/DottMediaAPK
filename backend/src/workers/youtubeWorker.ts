import { Worker } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import admin from 'firebase-admin';
import axios from 'axios';
import fs from 'fs';
import { google } from 'googleapis';
import { config } from '../config';
import { captureException } from '../lib/monitoring';
import { getYouTubeIntegrationSecrets, updateYouTubeAccessToken } from '../services/socialIntegrationService';
import { cleanupTempFile, downloadVideoToTemp } from '../services/videoUrlService';
import { generateSoraVideoFile } from '../services/soraVideoService';
import {
  enqueueYouTubePublish,
  updateYouTubeJob,
  type YouTubeJobData,
  type YouTubeUploadPayload,
} from '../services/youtubeUploadService';

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const refreshAccessToken = async (refreshToken: string, clientId: string, clientSecret: string) => {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return {
    accessToken: response.data.access_token as string,
    expiresIn: Number(response.data.expires_in ?? 0),
  };
};

const buildOAuthClient = (accessToken: string) => {
  const clientId = config.youtube.clientId;
  const clientSecret = config.youtube.clientSecret;
  const redirectUri = config.youtube.redirectUri || undefined;
  if (!clientId || !clientSecret) {
    throw new Error('Missing YouTube OAuth client');
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ access_token: accessToken });
  return oauth2;
};

const normalizeShortsMetadata = (payload: YouTubeUploadPayload) => {
  if (!payload.shorts) {
    return {
      title: payload.title ?? 'Dott Media upload',
      description: payload.description ?? '',
      tags: payload.tags ?? [],
    };
  }

  const title = payload.title ?? 'Dott Media AI Sales Bot | #Shorts';
  const description = payload.description ?? '';
  const tag = '#Shorts';
  const hasShorts = `${title}\n${description}`.toLowerCase().includes('#shorts');
  const descriptionWithShorts = hasShorts ? description : `${description}${description ? '\n\n' : ''}${tag}`;
  const tags = payload.tags ?? [];
  if (!tags.map(item => item.toLowerCase()).includes('shorts')) {
    tags.push('shorts');
  }
  return { title, description: descriptionWithShorts, tags };
};

const uploadVideoFile = async (userId: string, payload: YouTubeUploadPayload, filePath: string) => {
  const integration = await getYouTubeIntegrationSecrets(userId);
  if (!integration?.refreshToken) {
    throw new Error('YouTube integration not configured');
  }

  const clientId = config.youtube.clientId;
  const clientSecret = config.youtube.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Missing YouTube client credentials');
  }

  const { accessToken, expiresIn } = await refreshAccessToken(integration.refreshToken, clientId, clientSecret);
  await updateYouTubeAccessToken(userId, {
    accessToken,
    accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
  });

  const oauth2 = buildOAuthClient(accessToken);
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });
  const privacyStatus = payload.scheduledPublishTime
    ? 'private'
    : payload.privacyStatus ?? integration.privacyStatus ?? 'unlisted';

  const metadata = normalizeShortsMetadata(payload);
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
      },
      status: {
        privacyStatus,
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  const videoId = response.data?.id as string | undefined;
  if (!videoId) {
    throw new Error('YouTube upload did not return a video ID');
  }

  return { videoId, videoUrl: `https://youtu.be/${videoId}`, privacyStatus };
};

const finalizeUploadJob = async (jobId: string, userId: string, payload: YouTubeUploadPayload, videoId: string, videoUrl: string) => {
  const scheduledAt = payload.scheduledPublishTime ? new Date(payload.scheduledPublishTime).toISOString() : null;

  if (payload.scheduledPublishTime) {
    const delayMs = new Date(payload.scheduledPublishTime).getTime() - Date.now();
    await enqueueYouTubePublish(jobId, userId, { ...payload, videoId }, delayMs);
    await updateYouTubeJob(jobId, {
      status: 'scheduled',
      videoId,
      videoUrl,
      scheduledPublishTime: scheduledAt,
    });
  } else {
    await updateYouTubeJob(jobId, {
      status: 'completed',
      videoId,
      videoUrl,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
};

const handleUpload = async (job: Extract<YouTubeJobData, { type: 'upload' }>) => {
  const { jobId, userId, payload } = job;
  await updateYouTubeJob(jobId, {
    status: 'processing',
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const tempFile = await downloadVideoToTemp(payload.videoUrl);
  try {
    const { videoId, videoUrl } = await uploadVideoFile(userId, payload, tempFile.filePath);
    await finalizeUploadJob(jobId, userId, payload, videoId, videoUrl);
  } finally {
    await cleanupTempFile(tempFile.filePath);
  }
};

const handleSora = async (job: Extract<YouTubeJobData, { type: 'sora' }>) => {
  const { jobId, userId, payload } = job;
  await updateYouTubeJob(jobId, {
    status: 'generating',
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const { filePath, videoId } = await generateSoraVideoFile({
    prompt: payload.prompt,
    model: payload.model,
    seconds: payload.seconds,
    size: payload.size,
  });

  await updateYouTubeJob(jobId, {
    status: 'uploading',
    soraVideoId: videoId,
  });

  try {
    const uploadPayload: YouTubeUploadPayload = {
      videoUrl: 'sora://generated',
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      privacyStatus: payload.privacyStatus,
      scheduledPublishTime: payload.scheduledPublishTime,
      shorts: payload.shorts,
    };
    const { videoId: youtubeVideoId, videoUrl } = await uploadVideoFile(userId, uploadPayload, filePath);
    await finalizeUploadJob(jobId, userId, uploadPayload, youtubeVideoId, videoUrl);
  } finally {
    await cleanupTempFile(filePath);
  }
};

const handlePublish = async (job: Extract<YouTubeJobData, { type: 'publish' }>) => {
  const { jobId, userId, payload } = job;
  const videoId = payload.videoId;
  if (!videoId) {
    throw new Error('Missing videoId for publish job');
  }

  const integration = await getYouTubeIntegrationSecrets(userId);
  if (!integration?.refreshToken) {
    throw new Error('YouTube integration not configured');
  }
  const clientId = config.youtube.clientId;
  const clientSecret = config.youtube.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error('Missing YouTube client credentials');
  }

  const { accessToken, expiresIn } = await refreshAccessToken(integration.refreshToken, clientId, clientSecret);
  await updateYouTubeAccessToken(userId, {
    accessToken,
    accessTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
  });

  const oauth2 = buildOAuthClient(accessToken);
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });
  const privacyStatus = payload.privacyStatus ?? 'public';

  await youtube.videos.update({
    part: ['status'],
    requestBody: {
      id: videoId,
      status: { privacyStatus },
    },
  });

  await updateYouTubeJob(jobId, {
    status: 'published',
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    videoId,
    privacyStatus,
  });
};

let youtubeWorker: Worker | null = null;

if (process.env.SKIP_REDIS === 'true') {
  console.warn('[youtubeWorker] SKIP_REDIS=true; worker not started');
} else {
  try {
    youtubeWorker = new Worker<YouTubeJobData>(
      'youtube',
      async job => {
        if (job.data.type === 'publish') {
          await handlePublish(job.data);
        } else if (job.data.type === 'sora') {
          await handleSora(job.data);
        } else {
          await handleUpload(job.data);
        }
      },
      { connection: new IORedis(config.redisUrl, redisOptions) },
    );

    youtubeWorker.on('completed', job => {
      console.log(`[youtube] job ${job.id} completed`);
    });

    youtubeWorker.on('failed', async (job, err) => {
      console.error(`[youtube] job ${job?.id} failed:`, err);
      captureException(err, { jobId: job?.id, queue: 'youtube' });
      const jobId = (job?.data as YouTubeJobData | undefined)?.jobId;
      if (jobId) {
        await updateYouTubeJob(jobId, {
          status: 'failed',
          errorMessage: err?.message ?? 'upload_failed',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (error) {
    console.warn('[youtubeWorker] Redis unavailable; worker not started', error);
  }
}

export { youtubeWorker };

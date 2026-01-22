import { Queue } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import { config } from '../config';
import type { YouTubeJobData } from '../services/youtubeUploadService';

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const createQueue = () => {
  if (config.security.allowMockAuth || process.env.SKIP_REDIS === 'true' || !config.redisUrl) {
    console.warn('[youtubeQueue] Redis disabled; queue not started');
    return {
      add: async () => {
        console.info('[youtubeQueue] job skipped (redis disabled)');
        return { id: 'mock-job' } as any;
      },
    } as unknown as Queue<YouTubeJobData>;
  }

  try {
    const connection = new IORedis(config.redisUrl, redisOptions);
    connection.on('error', error => {
      console.warn('[youtubeQueue] Redis connection error', error);
    });
    return new Queue<YouTubeJobData>('youtube', {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  } catch (error) {
    console.warn('[youtubeQueue] Redis unavailable, falling back to no-op queue', error);
    return {
      add: async () => {
        console.info('[youtubeQueue] job skipped (redis unavailable)');
        return { id: 'noop' } as any;
      },
    } as unknown as Queue<YouTubeJobData>;
  }
};

export const youtubeQueue = createQueue();

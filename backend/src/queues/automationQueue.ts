import { Queue } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import { config } from '../config';
import { ActivationPayload } from '../types/automation';

type JobData = {
  jobId: string;
  payload: ActivationPayload;
};

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null, // required by BullMQ when blocking commands are used
  enableReadyCheck: false,
};

const createQueue = () => {
  if (config.security.allowMockAuth || process.env.SKIP_REDIS === 'true' || !config.redisUrl) {
    console.warn('[automationQueue] Redis disabled; queue not started');
    return {
      add: async () => {
        console.info('[automationQueue] job skipped (redis disabled)');
        return { id: 'mock-job' } as any;
      },
    } as unknown as Queue<JobData>;
  }

  try {
    const connection = new IORedis(config.redisUrl, redisOptions);
    connection.on('error', error => {
      console.warn('[automationQueue] Redis connection error', error);
    });
    return new Queue<JobData>('automation', {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  } catch (error) {
    console.warn('[automationQueue] Redis unavailable, falling back to no-op queue', error);
    return {
      add: async () => {
        console.info('[automationQueue] job skipped (redis unavailable)');
        return { id: 'noop' } as any;
      },
    } as unknown as Queue<JobData>;
  }
};

export const automationQueue = createQueue();

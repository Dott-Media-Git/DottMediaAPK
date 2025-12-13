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
  if (config.security.allowMockAuth) {
    console.warn('[automationQueue] mock mode enabled, skipping Redis queue connection');
    return {
      add: async () => {
        console.info('[automationQueue] job skipped in mock mode');
        return { id: 'mock-job' } as any;
      },
    } as unknown as Queue<JobData>;
  }

  const connection = new IORedis(config.redisUrl, redisOptions);
  return new Queue<JobData>('automation', {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
};

export const automationQueue = createQueue();

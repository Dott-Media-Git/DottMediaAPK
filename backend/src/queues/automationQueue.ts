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

const connection = new IORedis(config.redisUrl, redisOptions);

export const automationQueue = new Queue<JobData>('automation', {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

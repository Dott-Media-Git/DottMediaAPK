import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { ActivationPayload } from '../types/automation';

type JobData = {
  jobId: string;
  payload: ActivationPayload;
};

const connection = new IORedis(config.redisUrl);

export const automationQueue = new Queue<JobData>('automation', {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

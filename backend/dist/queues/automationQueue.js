import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
const connection = new IORedis(config.redisUrl);
export const automationQueue = new Queue('automation', {
    connection,
    defaultJobOptions: {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
    },
});

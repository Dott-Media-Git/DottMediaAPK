import { Queue } from 'bullmq';
import { config } from '../config.js';
import { createRedisConnection } from '../lib/redis.js';
const createQueue = () => {
    if (config.security.allowMockAuth || process.env.SKIP_REDIS === 'true' || !config.redisUrl) {
        console.warn('[automationQueue] Redis disabled; queue not started');
        return {
            add: async () => {
                console.info('[automationQueue] job skipped (redis disabled)');
                return { id: 'mock-job' };
            },
        };
    }
    try {
        const connection = createRedisConnection('automationQueue');
        if (!connection) {
            throw new Error('Redis connection unavailable');
        }
        const queue = new Queue('automation', {
            connection,
            defaultJobOptions: {
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
            },
        });
        queue.on('error', error => {
            console.warn('[automationQueue] queue error', error);
        });
        return queue;
    }
    catch (error) {
        console.warn('[automationQueue] Redis unavailable, falling back to no-op queue', error);
        return {
            add: async () => {
                console.info('[automationQueue] job skipped (redis unavailable)');
                return { id: 'noop' };
            },
        };
    }
};
export const automationQueue = createQueue();

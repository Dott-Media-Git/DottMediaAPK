import { Queue } from 'bullmq';
import { config } from '../config';
import { createRedisConnection } from '../lib/redis';
const createQueue = () => {
    if (config.security.allowMockAuth || process.env.SKIP_REDIS === 'true' || !config.redisUrl) {
        console.warn('[youtubeQueue] Redis disabled; queue not started');
        return {
            add: async () => {
                console.info('[youtubeQueue] job skipped (redis disabled)');
                return { id: 'mock-job' };
            },
        };
    }
    try {
        const connection = createRedisConnection('youtubeQueue');
        if (!connection) {
            throw new Error('Redis connection unavailable');
        }
        const queue = new Queue('youtube', {
            connection,
            defaultJobOptions: {
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
            },
        });
        queue.on('error', error => {
            console.warn('[youtubeQueue] queue error', error);
        });
        return queue;
    }
    catch (error) {
        console.warn('[youtubeQueue] Redis unavailable, falling back to no-op queue', error);
        return {
            add: async () => {
                console.info('[youtubeQueue] job skipped (redis unavailable)');
                return { id: 'noop' };
            },
        };
    }
};
export const youtubeQueue = createQueue();

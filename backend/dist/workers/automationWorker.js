import { Worker } from 'bullmq';
import { config } from '../config.js';
import { AutomationService } from '../services/automationService.js';
import { captureException } from '../lib/monitoring.js';
import { createRedisConnection } from '../lib/redis.js';
const service = new AutomationService();
let automationWorker = null;
if (process.env.SKIP_REDIS === 'true' || !config.redisUrl) {
    console.warn('[automationWorker] Redis disabled; worker not started');
}
else {
    try {
        const connection = createRedisConnection('automationWorker');
        if (!connection) {
            throw new Error('Redis connection unavailable');
        }
        automationWorker = new Worker('automation', async (job) => {
            await service.processJob(job.data.jobId, job.data.payload);
        }, { connection });
        automationWorker.on('completed', job => {
            console.log(`[automation] job ${job.id} completed`);
        });
        automationWorker.on('error', err => {
            console.warn('[automation] worker error', err);
        });
        automationWorker.on('failed', (job, err) => {
            console.error(`[automation] job ${job?.id} failed:`, err);
            captureException(err, { jobId: job?.id, queue: 'automation' });
        });
    }
    catch (error) {
        console.warn('[automationWorker] Redis unavailable; worker not started', error);
    }
}
export { automationWorker };

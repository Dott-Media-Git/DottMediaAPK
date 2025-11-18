import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { AutomationService } from '../services/automationService';
import { captureException } from '../lib/monitoring';
const service = new AutomationService();
export const automationWorker = new Worker('automation', async (job) => {
    await service.processJob(job.data.jobId, job.data.payload);
}, { connection: new IORedis(config.redisUrl) });
automationWorker.on('completed', job => {
    console.log(`[automation] job ${job.id} completed`);
});
automationWorker.on('failed', (job, err) => {
    console.error(`[automation] job ${job?.id} failed:`, err);
    captureException(err, { jobId: job?.id, queue: 'automation' });
});

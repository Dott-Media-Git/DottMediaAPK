import crypto from 'crypto';
import { automationQueue } from '../queues/automationQueue.js';
import { MakeClient } from './makeClient.js';
import { sendWorkspaceLiveEmail } from './emailService.js';
import { createJobDoc, upsertJobDoc, getJobDoc, findJobById, recordAnalyticsSample, } from './firestoreService.js';
const make = new MakeClient();
export class AutomationService {
    async enqueueActivation(payload) {
        const jobId = crypto.randomUUID();
        await createJobDoc(payload.firebaseUid, jobId, payload);
        await automationQueue.add('activate', { jobId, payload }, {
            jobId,
        });
        return jobId;
    }
    async processJob(jobId, payload) {
        try {
            await upsertJobDoc(payload.firebaseUid, jobId, { status: 'running' });
            await make.sendWebhook(payload);
            const scenarioName = `Dott_${payload.company.name.replace(/\s+/g, '')}_${payload.firebaseUid}`;
            const scenarioId = await make.cloneScenario(scenarioName);
            await make.enableScenario(scenarioId);
            await sendWorkspaceLiveEmail(payload.contact.email, payload.company.name);
            const performance = this.generatePerformanceSample(payload);
            await upsertJobDoc(payload.firebaseUid, jobId, {
                status: 'active',
                scenarioId,
                analytics: performance,
            });
            await recordAnalyticsSample(payload.firebaseUid, performance);
            return { scenarioId, status: 'active' };
        }
        catch (err) {
            await upsertJobDoc(payload.firebaseUid, jobId, {
                status: 'failed',
                error: err instanceof Error ? err.message : 'Unknown error',
            });
            throw err;
        }
    }
    async getJobStatus(userId, jobId) {
        let doc = await getJobDoc(userId, jobId);
        if (!doc) {
            const found = await findJobById(jobId);
            if (found && found.userId === userId) {
                doc = found;
            }
        }
        return doc;
    }
    generatePerformanceSample(_payload) {
        const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
        const leads = randomRange(8, 28);
        const conversions = Math.max(1, Math.floor(leads * 0.2));
        const engagement = randomRange(35, 85);
        const feedbackScore = Number((3.5 + Math.random() * 1.5).toFixed(1));
        const date = new Date().toISOString().slice(0, 10);
        return { date, leads, engagement, conversions, feedbackScore };
    }
}

import cron from 'node-cron';
import { FollowupService } from '../packages/services/followupService';
const followupService = new FollowupService();
const scheduleExpression = process.env.FOLLOWUP_CRON ?? '0 15 * * *';
export function scheduleFollowupJob() {
    if (process.env.DISABLE_FOLLOWUP_AUTOMATION === 'true') {
        console.info('Follow-up automation disabled by env flag.');
        return;
    }
    cron.schedule(scheduleExpression, async () => {
        await runFollowupJob();
    });
    console.info(`Follow-up job scheduled (${scheduleExpression}).`);
}
export async function runFollowupJob() {
    try {
        console.info('Running follow-up job...');
        const result = await followupService.runDailyFollowups();
        console.info('Follow-up job finished', result);
    }
    catch (error) {
        console.error('Follow-up job failed', error);
    }
}
scheduleFollowupJob();

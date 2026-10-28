import cron from 'node-cron';
import { scheduleMatchdayTables } from '../services/matchdayResultsService.js';
const scheduleExpression = process.env.MATCHDAY_RESULTS_CRON ?? '30 23 * * *';
const scheduleTimezone = process.env.MATCHDAY_RESULTS_TIMEZONE ?? 'Africa/Kampala';
export function scheduleMatchdayResultsJob() {
    if (!scheduleExpression.trim()) {
        console.info('[matchday] job not scheduled (MATCHDAY_RESULTS_CRON not set).');
        return;
    }
    cron.schedule(scheduleExpression, async () => {
        try {
            const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const startAt = new Date(Date.now() + 5 * 60 * 1000);
            const spacingHours = Math.max(Number(process.env.MATCHDAY_RESULTS_SPACING_HOURS ?? 3), 1);
            const result = await scheduleMatchdayTables({ date, startAt, spacingHours });
            console.info('[matchday] scheduled', result);
        }
        catch (error) {
            console.error('[matchday] job failed', error);
        }
    }, { timezone: scheduleTimezone });
    console.info(`[matchday] job scheduled (${scheduleExpression}) tz=${scheduleTimezone}.`);
}
scheduleMatchdayResultsJob();

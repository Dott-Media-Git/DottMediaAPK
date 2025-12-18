import cron from 'node-cron';
import { autoPostService } from '../services/autoPostService';

const scheduleExpression = process.env.AUTOPOST_CRON ?? '0 */3 * * *';

/**
 * Runs autopost queue on a cron so any due jobs (per-user intervals) fire regularly.
 */
export function scheduleAutoPostJob() {
  cron.schedule(scheduleExpression, async () => {
    try {
      const result = await autoPostService.runDueJobs();
      console.info('[autopost] runDueJobs complete', result);
    } catch (error) {
      console.error('[autopost] runDueJobs failed', error);
    }
  });
  console.info(`[autopost] job scheduled (${scheduleExpression}).`);

  // Kick off one run immediately so posts happen on startup.
  void (async () => {
    try {
      const result = await autoPostService.runDueJobs();
      console.info('[autopost] initial runDueJobs complete', result);
    } catch (error) {
      console.error('[autopost] initial runDueJobs failed', error);
    }
  })();
}

scheduleAutoPostJob();

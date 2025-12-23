import cron from 'node-cron';
import { autoPostService } from '../services/autoPostService';

const scheduleExpression = process.env.AUTOPOST_CRON ?? '0 */3 * * *';
const pollMinutes = Math.max(Number(process.env.AUTOPOST_POLL_MINUTES ?? 10), 1);

/**
 * Runs autopost queue on a cron so any due jobs (per-user intervals) fire regularly.
 */
export function scheduleAutoPostJob() {
  let running = false;
  const runDueJobs = async (label: string) => {
    if (running) return;
    running = true;
    try {
      const result = await autoPostService.runDueJobs();
      console.info(`[autopost] runDueJobs complete (${label})`, result);
    } catch (error) {
      console.error(`[autopost] runDueJobs failed (${label})`, error);
    } finally {
      running = false;
    }
  };

  cron.schedule(scheduleExpression, async () => {
    await runDueJobs('cron');
  });
  console.info(`[autopost] job scheduled (${scheduleExpression}).`);
  console.info(`[autopost] poll interval set (${pollMinutes}m).`);

  // Kick off one run immediately so posts happen on startup.
  void runDueJobs('startup');

  setInterval(() => {
    void runDueJobs('poll');
  }, pollMinutes * 60 * 1000);
}

scheduleAutoPostJob();

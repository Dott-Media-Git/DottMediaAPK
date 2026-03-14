import cron from 'node-cron';
import { socialPostingService } from '../packages/services/socialPostingService';

const scheduleExpression = process.env.SOCIAL_QUEUE_CRON ?? '*/1 * * * *';
const pollMinutes = Math.max(Number(process.env.SOCIAL_QUEUE_POLL_MINUTES ?? 1), 1);
const queueLimit = Math.max(Number(process.env.SOCIAL_QUEUE_LIMIT ?? 25), 1);

export function scheduleSocialQueueJob() {
  if (process.env.DISABLE_SOCIAL_QUEUE_AUTOMATION === 'true') {
    console.info('Scheduled social queue automation disabled by env flag.');
    return;
  }

  let running = false;
  const runQueue = async (label: string) => {
    if (running) return;
    running = true;
    try {
      const result = await socialPostingService.runQueue(queueLimit);
      console.info(`[social-queue] runQueue complete (${label})`, result);
    } catch (error) {
      console.error(`[social-queue] runQueue failed (${label})`, error);
    } finally {
      running = false;
    }
  };

  cron.schedule(scheduleExpression, async () => {
    await runQueue('cron');
  });
  console.info(`[social-queue] job scheduled (${scheduleExpression}).`);
  console.info(`[social-queue] poll interval set (${pollMinutes}m).`);

  void runQueue('startup');

  setInterval(() => {
    void runQueue('poll');
  }, pollMinutes * 60 * 1000);
}

scheduleSocialQueueJob();

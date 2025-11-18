import cron from 'node-cron';
import { runProspectDiscovery } from '../packages/services/prospectFinder';
import { outreachAgent } from '../packages/services/outreachAgent';

const scheduleExpression = process.env.OUTBOUND_CRON ?? '0 9 * * *';
const industry = process.env.OUTBOUND_TARGET_INDUSTRY ?? 'real estate';
const country = process.env.OUTBOUND_TARGET_COUNTRY ?? 'Uganda';

/**
 * Schedules the daily autonomous prospect discovery + outreach routine.
 */
export function scheduleProspectJob() {
  if (process.env.DISABLE_OUTBOUND_AUTOMATION === 'true') {
    console.info('Outbound automation disabled via env flag.');
    return;
  }

  cron.schedule(scheduleExpression, async () => {
    await runProspectJob();
  });
  console.info(`Outbound prospect job scheduled (${scheduleExpression}) targeting ${industry} in ${country}.`);
}

/**
 * Runs one full discovery + outreach pass immediately.
 */
export async function runProspectJob() {
  try {
    console.info('Running outbound prospect discovery job...');
    const prospects = await runProspectDiscovery({ industry, country });
    await outreachAgent.runDailyOutreach(prospects);
    console.info(`Outbound prospect job complete. ${prospects.length} prospects discovered.`);
  } catch (error) {
    console.error('Outbound prospect job failed', error);
  }
}

scheduleProspectJob();

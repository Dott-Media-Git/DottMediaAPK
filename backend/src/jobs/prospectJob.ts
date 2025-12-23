import cron from 'node-cron';
import { runProspectDiscovery } from '../packages/services/prospectFinder';
import { outreachAgent } from '../packages/services/outreachAgent';
import { resolveOutboundDiscoveryTarget } from '../services/outboundTargetingService';

const scheduleExpression = process.env.OUTBOUND_CRON ?? '0 9 * * *';
const manualIndustry = process.env.OUTBOUND_TARGET_INDUSTRY ?? process.env.OUTBOUND_TARGET_INDUSTRIES;
const manualCountry = process.env.OUTBOUND_TARGET_COUNTRY ?? process.env.OUTBOUND_TARGET_COUNTRIES;
const targetMode = manualIndustry || manualCountry ? 'manual' : 'auto';

const resolveDiscoveryLimit = () => {
  const perChannelCap = Number(process.env.OUTBOUND_DAILY_CAP_PER_CHANNEL ?? 20);
  const channelCount = 3;
  const defaultLimit = perChannelCap * channelCount * 2;
  const configured = Number(process.env.OUTBOUND_DISCOVERY_LIMIT ?? defaultLimit);
  return Math.max(10, Math.min(configured, 200));
};

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
  console.info(`Outbound prospect job scheduled (${scheduleExpression}) using ${targetMode} targeting.`);
}

/**
 * Runs one full discovery + outreach pass immediately.
 */
export async function runProspectJob() {
  try {
    console.info('Running outbound prospect discovery job...');
    const target = await resolveOutboundDiscoveryTarget();
    const limit = resolveDiscoveryLimit();
    console.info(
      `[outbound] targeting industry="${target.industry}" country="${target.country}" (expanded=${target.expanded}, source=${target.source})`,
    );
    const prospects = await runProspectDiscovery({ industry: target.industry, country: target.country, limit });
    const outreach = await outreachAgent.runDailyOutreach(prospects);
    console.info(
      `Outbound prospect job complete. ${prospects.length} prospects discovered, ${outreach.messagesSent} messages sent.`,
    );
  } catch (error) {
    console.error('Outbound prospect job failed', error);
  }
}

scheduleProspectJob();

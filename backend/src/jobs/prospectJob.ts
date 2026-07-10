import cron from 'node-cron';
import { runProspectDiscovery } from '../packages/services/prospectFinder';
import { outreachAgent } from '../packages/services/outreachAgent';
import { resolveDiscoveryLimit, resolveOutboundDiscoveryTarget } from '../services/outboundTargetingService';
import { canUseOutboundPipeline } from '../utils/socialAccess';

const scheduleExpression = process.env.OUTBOUND_CRON ?? '0 * * * *';
const manualIndustry = process.env.OUTBOUND_TARGET_INDUSTRY ?? process.env.OUTBOUND_TARGET_INDUSTRIES;
const manualCountry = process.env.OUTBOUND_TARGET_COUNTRY ?? process.env.OUTBOUND_TARGET_COUNTRIES;
const targetMode = manualIndustry || manualCountry ? 'manual' : 'auto';

/**
 * Schedules the autonomous prospect discovery + outreach routine.
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

  // Run once on startup so outreach resumes immediately after restarts/deploys.
  void runProspectJob();
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
    const primaryUserId = process.env.PRIMARY_SOCIAL_USER_IDS?.split(',')[0]?.trim() || 'cMPZQccGggbhZe9dbvtxFmBehP02';
    const primaryEmail = process.env.PRIMARY_SOCIAL_EMAILS?.split(',')[0]?.trim() || 'brasioxirin@gmail.com';
    if (!canUseOutboundPipeline({ email: primaryEmail }, primaryUserId)) {
      console.info('Outbound prospect job skipped because outbound is restricted to the primary Dott Media account.');
      return;
    }
    const outreach = await outreachAgent.runDailyOutreach(prospects, { userId: primaryUserId });
    console.info(
      `Outbound prospect job complete. ${prospects.length} prospects discovered, ${outreach.messagesSent} messages sent.`,
    );
  } catch (error) {
    console.error('Outbound prospect job failed', error);
  }
}

scheduleProspectJob();

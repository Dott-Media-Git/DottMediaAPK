import cron from 'node-cron';
import { firebaseApp, firestore } from '../db/firestore';
import { AssistantStrategyService } from '../services/assistantStrategyService';

const strategyService = new AssistantStrategyService();
const scheduleExpression = process.env.WEEKLY_REPORT_CRON?.trim() || '0 8 * * 1';
const timezone = process.env.WEEKLY_REPORT_TIMEZONE?.trim() || 'Africa/Kampala';

const runWeeklyReports = async () => {
  if (!firebaseApp) {
    console.warn('[weekly-report] Firebase Admin is unavailable');
    return;
  }
  let pageToken: string | undefined;
  do {
    const page = await firebaseApp.auth().listUsers(500, pageToken);
    for (const user of page.users) {
      if (!user.email || !user.emailVerified || user.disabled) continue;
      let company = user.displayName || 'your team';
      let enabled = true;
      try {
        const profile = await firestore.collection('profiles').doc(user.uid).get();
        const data = profile.data() as Record<string, any> | undefined;
        enabled = data?.weeklyReportEnabled !== false;
        company = data?.crmData?.companyName || data?.user?.name || company;
      } catch (error) {
        console.warn('[weekly-report] profile lookup failed; using auth profile', user.uid, (error as Error).message);
      }
      if (!enabled) continue;
      try {
        await strategyService.sendWeeklyReport({
          userId: user.uid,
          email: user.email,
          company,
        });
      } catch (error) {
        console.error('[weekly-report] delivery failed', user.uid, (error as Error).message);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
};

cron.schedule(
  scheduleExpression,
  () => {
    void runWeeklyReports();
  },
  { timezone },
);

console.log(`[weekly-report] scheduled ${scheduleExpression} (${timezone})`);

export { runWeeklyReports };

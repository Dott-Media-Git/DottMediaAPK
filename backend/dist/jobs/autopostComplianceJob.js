import { autopostComplianceService } from '../services/autopostComplianceService.js';
const pollMinutes = Math.max(Number(process.env.AUTOPOST_COMPLIANCE_POLL_MINUTES ?? 15), 5);
export function scheduleAutopostComplianceJob() {
    let running = false;
    const runCheck = async (label) => {
        if (running)
            return;
        running = true;
        try {
            const result = await autopostComplianceService.checkAndRepair(label);
            console.info('[autopost-compliance] check complete', {
                label,
                ok: result.ok,
                issueCount: result.issueCount,
                remediated: result.remediated,
                emailed: result.emailed,
            });
        }
        catch (error) {
            console.error('[autopost-compliance] check failed', error);
        }
        finally {
            running = false;
        }
    };
    console.info(`[autopost-compliance] poll interval set (${pollMinutes}m).`);
    if (process.env.AUTOPOST_COMPLIANCE_RUN_ON_STARTUP === 'true') {
        void runCheck('startup');
    }
    setInterval(() => {
        void runCheck('poll');
    }, pollMinutes * 60 * 1000);
}
scheduleAutopostComplianceJob();

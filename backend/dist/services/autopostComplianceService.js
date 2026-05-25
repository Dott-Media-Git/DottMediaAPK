import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { autoPostService } from './autoPostService.js';
import { sendOperationalAlertEmail } from './emailService.js';
import { supabaseFallbackService } from './supabaseFallbackService.js';
const accounts = [
    {
        label: 'Bwin',
        userId: '1zvY9nNyXMcfxdPQEyx0bIdK7r53',
        channels: [
            {
                name: 'news',
                intervalField: 'trendIntervalHours',
                nextRunField: 'trendNextRun',
                lastRunField: 'trendLastRunAt',
                resultField: 'trendLastResult',
                fallbackIntervalHours: 1,
            },
            {
                name: 'stories',
                intervalField: 'storyIntervalHours',
                nextRunField: 'storyNextRun',
                lastRunField: 'storyLastRunAt',
                resultField: 'storyLastResult',
                fallbackIntervalHours: 4,
            },
        ],
    },
    {
        label: 'CarmarketPlace',
        userId: 'acmVetCcOiTHeGk5D7eDYieamDF3',
        channels: [
            { name: 'feed', intervalField: 'intervalHours', nextRunField: 'nextRun', lastRunField: 'lastRunAt', resultField: 'lastResult', fallbackIntervalHours: 3 },
            { name: 'stories', intervalField: 'storyIntervalHours', nextRunField: 'storyNextRun', lastRunField: 'storyLastRunAt', resultField: 'storyLastResult', fallbackIntervalHours: 3 },
            { name: 'reels', intervalField: 'reelsIntervalHours', nextRunField: 'reelsNextRun', lastRunField: 'reelsLastRunAt', resultField: 'reelsLastResult', fallbackIntervalHours: 4 },
        ],
    },
    {
        label: 'Staysphere',
        userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
        channels: [
            { name: 'feed', intervalField: 'intervalHours', nextRunField: 'nextRun', lastRunField: 'lastRunAt', resultField: 'lastResult', fallbackIntervalHours: 3 },
            { name: 'stories', intervalField: 'storyIntervalHours', nextRunField: 'storyNextRun', lastRunField: 'storyLastRunAt', resultField: 'storyLastResult', fallbackIntervalHours: 3 },
            { name: 'reels', intervalField: 'reelsIntervalHours', nextRunField: 'reelsNextRun', lastRunField: 'reelsLastRunAt', resultField: 'reelsLastResult', fallbackIntervalHours: 4 },
        ],
    },
    {
        label: 'Gamers44life',
        userId: 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
        channels: [
            { name: 'feed', intervalField: 'intervalHours', nextRunField: 'nextRun', lastRunField: 'lastRunAt', resultField: 'lastResult', fallbackIntervalHours: 3 },
            { name: 'stories', intervalField: 'storyIntervalHours', nextRunField: 'storyNextRun', lastRunField: 'storyLastRunAt', resultField: 'storyLastResult', fallbackIntervalHours: 3 },
            { name: 'reels', intervalField: 'reelsIntervalHours', nextRunField: 'reelsNextRun', lastRunField: 'reelsLastRunAt', resultField: 'reelsLastResult', fallbackIntervalHours: 2 },
        ],
    },
];
const autopostCollection = firestore.collection('autopostJobs');
const stateRef = firestore.collection('system').doc('autopostCompliance');
const timeoutMs = (name, fallback) => Math.max(Number(process.env[name] ?? fallback), 3000);
const withTimeout = async (promise, ms, label) => {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
};
const toMillis = (value) => {
    if (!value)
        return null;
    if (value instanceof Date)
        return value.getTime();
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const candidate = value;
    if (typeof candidate.toMillis === 'function')
        return candidate.toMillis();
    if (typeof candidate.toDate === 'function')
        return candidate.toDate().getTime();
    const seconds = typeof candidate._seconds === 'number' ? candidate._seconds : candidate.seconds;
    return typeof seconds === 'number' ? seconds * 1000 : null;
};
const toIso = (value) => {
    const ms = toMillis(value);
    return ms ? new Date(ms).toISOString() : null;
};
const isFailedResult = (value) => {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    return value.every(result => {
        const status = String(result?.status ?? '').toLowerCase();
        return status === 'failed' || status === 'error';
    });
};
const numberValue = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const loadJob = async (userId) => {
    const errors = [];
    try {
        const snap = await withTimeout(autopostCollection.doc(userId).get(), timeoutMs('AUTOPOST_COMPLIANCE_FIRESTORE_TIMEOUT_MS', 15000), 'firestore_job_fetch');
        if (snap.exists)
            return { job: snap.data(), errors };
    }
    catch (error) {
        errors.push(`firestore:${error instanceof Error ? error.message : String(error)}`);
        console.warn('[autopost-compliance] Firestore job fetch failed; checking Supabase fallback.', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    try {
        const job = (await withTimeout(supabaseFallbackService.getAutopostJob(userId), timeoutMs('AUTOPOST_COMPLIANCE_SUPABASE_TIMEOUT_MS', 15000), 'supabase_job_fetch'));
        return { job, errors };
    }
    catch (error) {
        errors.push(`supabase:${error instanceof Error ? error.message : String(error)}`);
        console.warn('[autopost-compliance] Supabase job fetch failed.', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { job: null, errors };
    }
    return { job: null, errors };
};
const updateJob = async (userId, job, patch) => {
    const nextJob = { ...job, ...patch, active: job.active !== false };
    try {
        await withTimeout(autopostCollection.doc(userId).set({
            ...patch,
            active: job.active !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }), timeoutMs('AUTOPOST_COMPLIANCE_FIRESTORE_TIMEOUT_MS', 15000), 'firestore_job_update');
    }
    catch (error) {
        console.warn('[autopost-compliance] Firestore remediation write failed.', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    try {
        await withTimeout(supabaseFallbackService.upsertAutopostJob(userId, nextJob), timeoutMs('AUTOPOST_COMPLIANCE_SUPABASE_TIMEOUT_MS', 15000), 'supabase_job_update');
    }
    catch (error) {
        console.warn('[autopost-compliance] Supabase remediation mirror failed.', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
const formatIssueEmail = (issues) => [
    'Autopost compliance found stalled or failing channels and attempted remediation.',
    '',
    ...issues.map(issue => [
        `${issue.severity.toUpperCase()}: ${issue.account} ${issue.channel}`,
        `Reason: ${issue.reason}`,
        `Last run: ${issue.lastRunAt ?? 'never'}`,
        `Next run: ${issue.nextRun ?? 'not set'}`,
        `Minutes late: ${issue.minutesLate}`,
        `Action: ${issue.action}`,
        '',
    ].join('\n')),
].join('\n');
const triggerDueRunner = (label) => {
    void autoPostService.runDueJobs().then(result => {
        console.info('[autopost-compliance] due runner completed after repair', {
            label,
            processed: result?.processed ?? null,
        });
    }, error => {
        console.error('[autopost-compliance] due runner failed after repair', error);
    });
};
export const autopostComplianceService = {
    accounts,
    async checkAndRepair(label = 'manual') {
        const now = Date.now();
        const nowTimestamp = admin.firestore.Timestamp.fromMillis(now);
        const graceMinutes = Math.max(Number(process.env.AUTOPOST_COMPLIANCE_GRACE_MINUTES ?? 30), 5);
        const staleMultiplier = Math.max(Number(process.env.AUTOPOST_COMPLIANCE_STALE_MULTIPLIER ?? 1.5), 1.1);
        const issues = [];
        let remediated = 0;
        for (const account of accounts) {
            const { job, errors } = await loadJob(account.userId);
            if (!job) {
                const storeUnavailable = errors.length > 0;
                issues.push({
                    account: account.label,
                    userId: account.userId,
                    channel: 'feed',
                    severity: 'critical',
                    reason: storeUnavailable
                        ? `autopost job store unavailable (${errors.map(error => error.split(':')[0]).join(', ')})`
                        : 'autopost job is missing',
                    intervalHours: 0,
                    lastRunAt: null,
                    nextRun: null,
                    minutesLate: 0,
                    action: storeUnavailable ? 'alert and trigger due runner when stores recover' : 'alert only',
                });
                continue;
            }
            if (job.active === false)
                continue;
            const patch = {};
            for (const channel of account.channels) {
                const intervalHours = numberValue(job[channel.intervalField], channel.fallbackIntervalHours);
                const intervalMs = intervalHours * 60 * 60 * 1000;
                const nextRunMs = toMillis(job[channel.nextRunField]);
                const lastRunMs = toMillis(job[channel.lastRunField]);
                const graceMs = graceMinutes * 60 * 1000;
                const staleMs = Math.max(intervalMs * staleMultiplier, intervalMs + graceMs);
                const overdueMs = nextRunMs === null ? Number.POSITIVE_INFINITY : now - nextRunMs;
                const staleByMs = lastRunMs === null ? Number.POSITIVE_INFINITY : now - lastRunMs;
                const resultFailed = isFailedResult(job[channel.resultField]);
                const channelIssues = [];
                if (nextRunMs === null)
                    channelIssues.push('next run is missing');
                if (nextRunMs !== null && overdueMs > graceMs)
                    channelIssues.push('next run is overdue');
                if (lastRunMs === null)
                    channelIssues.push('last run is missing');
                if (lastRunMs !== null && staleByMs > staleMs)
                    channelIssues.push('last successful attempt is stale');
                if (resultFailed)
                    channelIssues.push('last attempt failed on every platform');
                if (!channelIssues.length)
                    continue;
                patch[channel.intervalField] = intervalHours;
                patch[channel.nextRunField] = nowTimestamp;
                const minutesLate = Math.max(0, Math.round((nextRunMs === null ? staleByMs : Math.max(overdueMs, staleByMs - intervalMs)) / 60000));
                issues.push({
                    account: account.label,
                    userId: account.userId,
                    channel: channel.name,
                    severity: minutesLate >= intervalHours * 90 || resultFailed ? 'critical' : 'warning',
                    reason: channelIssues.join('; '),
                    intervalHours,
                    lastRunAt: toIso(job[channel.lastRunField]),
                    nextRun: toIso(job[channel.nextRunField]),
                    minutesLate,
                    action: 'set next run to now and trigger due runner',
                });
            }
            if (Object.keys(patch).length > 0) {
                await updateJob(account.userId, job, patch);
                remediated += 1;
            }
        }
        let dueResult = null;
        if (issues.length) {
            dueResult = { triggered: true };
            triggerDueRunner(label);
        }
        const issueSignature = issues
            .map(issue => `${issue.userId}:${issue.channel}:${issue.reason}`)
            .sort()
            .join('|');
        let emailed = false;
        if (issues.length) {
            const cooldownMinutes = Math.max(Number(process.env.AUTOPOST_COMPLIANCE_ALERT_COOLDOWN_MINUTES ?? 60), 5);
            const stateSnap = await withTimeout(stateRef.get(), timeoutMs('AUTOPOST_COMPLIANCE_FIRESTORE_TIMEOUT_MS', 15000), 'firestore_state_fetch').catch(() => null);
            const state = stateSnap?.exists ? stateSnap.data() : {};
            const lastAlertMs = toMillis(state?.lastAlertAt);
            const lastSignature = String(state?.lastIssueSignature ?? '');
            const shouldAlert = issueSignature !== lastSignature ||
                lastAlertMs === null ||
                now - lastAlertMs > cooldownMinutes * 60 * 1000;
            if (shouldAlert) {
                const recipients = (process.env.AUTOPOST_COMPLIANCE_ALERT_EMAILS ?? 'xbrasio@gmail.com')
                    .split(',')
                    .map(value => value.trim())
                    .filter(Boolean);
                if (recipients.length) {
                    try {
                        await withTimeout(sendOperationalAlertEmail(recipients, `[DottMedia] Autopost compliance alert: ${issues.length} issue(s)`, formatIssueEmail(issues)), timeoutMs('AUTOPOST_COMPLIANCE_EMAIL_TIMEOUT_MS', 15000), 'alert_email_send');
                        emailed = true;
                    }
                    catch (error) {
                        console.warn('[autopost-compliance] alert email failed.', {
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
            await withTimeout(firestore.collection('autopostComplianceAlerts').add({
                label,
                issues,
                remediated,
                dueResult: JSON.parse(JSON.stringify(dueResult ?? null)),
                emailed,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }), timeoutMs('AUTOPOST_COMPLIANCE_FIRESTORE_TIMEOUT_MS', 15000), 'firestore_alert_write').catch(error => {
                console.warn('[autopost-compliance] alert log write failed.', {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            await withTimeout(stateRef.set({
                lastCheckAt: admin.firestore.FieldValue.serverTimestamp(),
                lastIssueSignature: issueSignature,
                lastAlertAt: emailed ? admin.firestore.FieldValue.serverTimestamp() : state?.lastAlertAt ?? null,
                lastIssueCount: issues.length,
                lastRemediatedCount: remediated,
            }, { merge: true }), timeoutMs('AUTOPOST_COMPLIANCE_FIRESTORE_TIMEOUT_MS', 15000), 'firestore_state_write').catch(error => {
                console.warn('[autopost-compliance] state write failed.', {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }
        else {
            await withTimeout(stateRef.set({
                lastCheckAt: admin.firestore.FieldValue.serverTimestamp(),
                lastIssueCount: 0,
                lastRemediatedCount: 0,
            }, { merge: true }), timeoutMs('AUTOPOST_COMPLIANCE_FIRESTORE_TIMEOUT_MS', 15000), 'firestore_state_write').catch(error => {
                console.warn('[autopost-compliance] state write failed.', {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }
        return {
            ok: issues.length === 0,
            checked: accounts.length,
            issueCount: issues.length,
            remediated,
            emailed,
            dueResult,
            issues,
        };
    },
};

import { Router } from 'express';
import createHttpError from 'http-errors';
// TODO: Extend with Google/Microsoft SSO claims once identity providers are connected.
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { withOrgContext, requireRole } from '../middleware/orgAuth.js';
import { createOrg, getOrg, updateOrg, listOrgUsers, inviteOrgUser, updateOrgUserRole, removeOrgUser, getOrgSettings, updateOrgSettings, connectChannel, disconnectChannel, storeSecret, describeSecret, getUsage, listPlans, swapPlan, enqueueJob, logAuditEvent, } from '../services/admin/adminService.js';
import { getAdminMetrics } from '../services/admin/adminMetricsService.js';
import { autopostComplianceService } from '../services/autopostComplianceService.js';
import { firestore } from '../db/firestore.js';
import { getLiveSocialMetrics } from '../services/liveSocialMetricsService.js';
import { pollFacebookCommentsOnce } from '../jobs/facebookCommentPollJob.js';
import { pollInstagramCommentsOnce } from '../jobs/instagramCommentPollJob.js';
import { pollThreadsCommentsOnce } from '../jobs/threadsCommentPollJob.js';
import { pollInstagramDmsOnce } from '../jobs/instagramDmPollJob.js';
import { supabaseFallbackService } from '../services/supabaseFallbackService.js';
const router = Router();
const ADMIN_LIVE_SOCIAL_CLIENTS = [
    { label: 'Aux Wellness Hub', userId: 'cMPZQccGggbhZe9dbvtxFmBehP02', email: 'xbrasio@gmail.com' },
    { label: 'SheCare Doctor', userId: 'tCE1FQ1cOFgdupOXP23mPUMQRAz1', email: 'shecaredoctor@gmail.com' },
    { label: 'Dott HR', userId: '80bYIeiuukNFtUvXTUobXmfC7pu1', email: 'kingbrasio100@gmail.com' },
    { label: 'Dott Energy', userId: 'LVR7p3WzdFM51ds92Kacf6S40og2' },
    { label: 'Car Marketplace', userId: 'acmVetCcOiTHeGk5D7eDYieamDF3' },
    { label: 'Staysphere', userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2' },
    { label: 'Gamers 4 Life', userId: 'vzdH1DnfFLVjlY8bBgC26WACmmw2' },
    { label: 'Bwin / Ball Analytics', userId: process.env.BWIN_USER_ID || '1zvY9nNyXMcfxdPQEyx0bIdK7r53', scopeId: process.env.BWIN_SCOPE_ID || 'bwinbetug', email: 'ball_analytics' },
];
const loadAdminLiveSocialClients = async () => {
    const clients = new Map(ADMIN_LIVE_SOCIAL_CLIENTS.map(client => [client.userId, client]));
    try {
        const [jobs, socialRows] = await Promise.all([
            supabaseFallbackService.getActiveAutopostJobs(1000),
            supabaseFallbackService.getAllSocialAccounts(1000),
        ]);
        const socialByUser = new Map(socialRows.map(row => [row.userId, row]));
        jobs.forEach(job => {
            const userId = String(job.userId ?? '').trim();
            if (!userId)
                return;
            const social = socialByUser.get(userId);
            const accounts = social?.socialAccounts;
            const hasConnectedSocial = Boolean(accounts?.facebook || accounts?.instagram || accounts?.threads || accounts?.linkedin ||
                accounts?.twitter || accounts?.tiktok || accounts?.youtube);
            if (!hasConnectedSocial)
                return;
            const existing = clients.get(userId);
            const pageName = String(accounts?.facebook?.pageName ?? '').trim();
            const instagramName = String(accounts?.instagram?.username ?? '').trim();
            clients.set(userId, {
                ...existing,
                userId,
                label: existing?.label || pageName || instagramName || social?.email || `Connected account ${userId.slice(0, 8)}`,
                email: existing?.email ?? social?.email ?? null,
            });
        });
    }
    catch (error) {
        console.warn('[admin-live-social] dynamic client discovery failed; using configured clients', error instanceof Error ? error.message : String(error));
    }
    return Array.from(clients.values());
};
const ADMIN_LIVE_SOCIAL_CLIENT_TIMEOUT_MS = Number(process.env.ADMIN_LIVE_SOCIAL_CLIENT_TIMEOUT_MS ?? 90000);
const ADMIN_METRICS_FRESH_MS = Number(process.env.ADMIN_METRICS_FRESH_MS ?? 15000);
const ADMIN_METRICS_STALE_MS = Number(process.env.ADMIN_METRICS_STALE_MS ?? 180000);
const ADMIN_COMPLIANCE_LIVE_CACHE_MS = Number(process.env.ADMIN_COMPLIANCE_LIVE_CACHE_MS ?? 180000);
let adminMetricsCache = null;
let adminMetricsRefresh = null;
let adminComplianceLiveCache = null;
let adminComplianceLiveRefresh = null;
const adminLiveSocialAccountCache = new Map();
const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
]);
const refreshAdminMetricsCache = async () => {
    if (adminMetricsRefresh)
        return adminMetricsRefresh;
    adminMetricsRefresh = getAdminMetrics()
        .then(metrics => {
        adminMetricsCache = { metrics, fetchedAt: Date.now() };
        return adminMetricsCache;
    })
        .finally(() => {
        adminMetricsRefresh = null;
    });
    return adminMetricsRefresh;
};
const refreshAdminComplianceLiveCache = async () => {
    if (adminComplianceLiveRefresh)
        return adminComplianceLiveRefresh;
    adminComplianceLiveRefresh = autopostComplianceService
        .checkAndRepair('admin_dashboard_live')
        .then(result => {
        adminComplianceLiveCache = { result, fetchedAt: Date.now() };
        return adminComplianceLiveCache;
    })
        .finally(() => {
        adminComplianceLiveRefresh = null;
    });
    return adminComplianceLiveRefresh;
};
setTimeout(() => {
    refreshAdminMetricsCache().catch(error => {
        console.warn('[admin-metrics] prewarm failed', error instanceof Error ? error.message : String(error));
    });
}, 1000);
router.get('/admin/metrics', requireFirebase, requireAdmin, async (_req, res, next) => {
    try {
        const now = Date.now();
        const ageMs = adminMetricsCache ? now - adminMetricsCache.fetchedAt : Number.POSITIVE_INFINITY;
        if (adminMetricsCache && ageMs < ADMIN_METRICS_STALE_MS) {
            if (ageMs > ADMIN_METRICS_FRESH_MS) {
                refreshAdminMetricsCache().catch(error => {
                    console.warn('[admin-metrics] background refresh failed', error instanceof Error ? error.message : String(error));
                });
            }
            res.set({
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
            });
            return res.json({ metrics: adminMetricsCache.metrics, cache: { ageMs, refreshing: Boolean(adminMetricsRefresh) } });
        }
        const result = await refreshAdminMetricsCache();
        if (!result)
            throw new Error('Admin metrics refresh did not return data');
        const metrics = result.metrics;
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        });
        res.json({ metrics, cache: { ageMs: 0, refreshing: false } });
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/live-social', requireFirebase, requireAdmin, async (req, res, next) => {
    try {
        const lookbackRaw = typeof req.query.lookbackHours === 'string' ? Number(req.query.lookbackHours) : 720;
        const lookbackHours = Number.isFinite(lookbackRaw) && lookbackRaw > 0 ? lookbackRaw : 720;
        const liveSocialClients = await loadAdminLiveSocialClients();
        const rows = await Promise.all(liveSocialClients.map(async (client) => {
            try {
                const stats = await withTimeout(getLiveSocialMetrics(client.userId, {
                    lookbackHours,
                    scope: {
                        userId: client.userId,
                        scopeId: client.scopeId ?? client.userId,
                        email: client.email,
                    },
                }), ADMIN_LIVE_SOCIAL_CLIENT_TIMEOUT_MS, `live social ${client.label}`);
                const row = {
                    label: client.label,
                    userId: client.userId,
                    scopeId: client.scopeId ?? client.userId,
                    email: client.email ?? null,
                    status: 'ok',
                    stats,
                };
                adminLiveSocialAccountCache.set(client.userId, { row, fetchedAt: Date.now() });
                return row;
            }
            catch (error) {
                const cached = adminLiveSocialAccountCache.get(client.userId);
                if (cached?.row) {
                    return {
                        ...cached.row,
                        stale: true,
                        staleReason: error instanceof Error ? error.message : String(error),
                    };
                }
                return {
                    label: client.label,
                    userId: client.userId,
                    scopeId: client.scopeId ?? client.userId,
                    email: client.email ?? null,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error),
                    stats: null,
                };
            }
        }));
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        });
        res.json({ generatedAt: new Date().toISOString(), lookbackHours, rows });
    }
    catch (error) {
        next(error);
    }
});
const runReplyPollersOnce = async () => {
    const settled = await Promise.allSettled([
        pollFacebookCommentsOnce(),
        pollInstagramCommentsOnce(),
        pollThreadsCommentsOnce(),
        pollInstagramDmsOnce(),
    ]);
    return settled.map((result, index) => ({
        poller: ['facebook_comments', 'instagram_comments', 'threads_replies', 'instagram_dms'][index],
        status: result.status,
        error: result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : null,
    }));
};
const timestampToIso = (value) => {
    if (!value)
        return null;
    if (typeof value === 'string')
        return value;
    const candidate = value;
    if (typeof candidate.toDate === 'function')
        return candidate.toDate().toISOString();
    if (typeof candidate.toMillis === 'function')
        return new Date(candidate.toMillis()).toISOString();
    const seconds = typeof candidate._seconds === 'number' ? candidate._seconds : candidate.seconds;
    return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
};
router.get('/admin/compliance/reports', requireFirebase, requireAdmin, async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
        const [alertsSnap, stateSnap] = await Promise.all([
            firestore.collection('autopostComplianceAlerts').orderBy('createdAt', 'desc').limit(limit).get().catch(error => {
                console.warn('[admin-compliance] Firestore alert read failed; using live fallback', error instanceof Error ? error.message : String(error));
                return null;
            }),
            firestore.collection('system').doc('autopostCompliance').get().catch(error => {
                console.warn('[admin-compliance] Firestore state read failed; using live fallback', error instanceof Error ? error.message : String(error));
                return null;
            }),
        ]);
        const reports = (alertsSnap?.docs ?? []).map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                label: data.label ?? null,
                issues: Array.isArray(data.issues) ? data.issues : [],
                issueCount: Array.isArray(data.issues) ? data.issues.length : 0,
                remediated: Number(data.remediated ?? 0),
                emailed: Boolean(data.emailed),
                dueResult: data.dueResult ?? null,
                createdAt: timestampToIso(data.createdAt),
            };
        });
        const state = stateSnap?.exists ? stateSnap.data() : {};
        let liveResult = null;
        const stateHasLiveSignal = Boolean(state?.lastCheckAt) || Number(state?.lastIssueCount ?? 0) > 0 || Number(state?.lastRemediatedCount ?? 0) > 0;
        if (!reports.length || !stateHasLiveSignal || req.query.live === '1') {
            const ageMs = adminComplianceLiveCache ? Date.now() - adminComplianceLiveCache.fetchedAt : Number.POSITIVE_INFINITY;
            const cached = adminComplianceLiveCache && ageMs < ADMIN_COMPLIANCE_LIVE_CACHE_MS ? adminComplianceLiveCache : await refreshAdminComplianceLiveCache();
            liveResult = cached?.result ?? null;
            if (liveResult && !reports.length) {
                reports.push({
                    id: 'live-compliance',
                    label: 'admin_dashboard_live',
                    issues: liveResult.issues,
                    issueCount: liveResult.issueCount,
                    remediated: liveResult.remediated,
                    emailed: liveResult.emailed,
                    dueResult: liveResult.dueResult ?? null,
                    createdAt: new Date(cached?.fetchedAt ?? Date.now()).toISOString(),
                });
            }
        }
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        });
        res.json({
            reports,
            state: {
                lastCheckAt: timestampToIso(state?.lastCheckAt) ?? (liveResult ? new Date(adminComplianceLiveCache?.fetchedAt ?? Date.now()).toISOString() : null),
                lastAlertAt: timestampToIso(state?.lastAlertAt),
                lastIssueCount: Number(state?.lastIssueCount ?? liveResult?.issueCount ?? 0),
                lastRemediatedCount: Number(state?.lastRemediatedCount ?? liveResult?.remediated ?? 0),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/compliance/run', requireFirebase, requireAdmin, async (_req, res, next) => {
    try {
        const result = await autopostComplianceService.checkAndRepair('admin_dashboard');
        res.json({ result });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/global-run', requireFirebase, requireAdmin, async (_req, res, next) => {
    try {
        const [autopostResult, replyPollers] = await Promise.all([
            autopostComplianceService.globalRunNow('admin_global_run'),
            runReplyPollersOnce(),
        ]);
        res.json({ ok: true, autopostResult, replyPollers });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/compliance/run-issue', requireFirebase, requireAdmin, async (req, res, next) => {
    try {
        const userId = String(req.body?.userId ?? '').trim();
        const channel = String(req.body?.channel ?? '').trim();
        if (!userId || !['feed', 'stories', 'reels', 'news'].includes(channel)) {
            throw createHttpError(400, 'userId and channel are required');
        }
        const [autopostResult, replyPollers] = await Promise.all([
            autopostComplianceService.rerunIssue({ userId, channel }, 'admin_issue_rerun'),
            runReplyPollersOnce(),
        ]);
        res.json({ ok: true, autopostResult, replyPollers });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs', requireFirebase, async (req, res, next) => {
    try {
        const user = req.authUser;
        if (!user)
            throw createHttpError(401, 'Auth required');
        const org = await createOrg({
            name: req.body.name,
            ownerUid: user.uid,
            plan: req.body.plan,
            locale: req.body.locale,
            logoUrl: req.body.logoUrl,
        });
        res.status(201).json({ org });
    }
    catch (error) {
        next(error);
    }
});
router.use('/admin/orgs/:orgId', requireFirebase, withOrgContext);
router.get('/admin/orgs/:orgId', requireRole(['Owner', 'Admin', 'Agent', 'Viewer']), async (req, res, next) => {
    try {
        const org = await getOrg(req.params.orgId);
        res.json({ org });
    }
    catch (error) {
        next(error);
    }
});
router.patch('/admin/orgs/:orgId', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const org = await updateOrg(req.params.orgId, req.body);
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'org.update', 'orgs', req.body);
        res.json({ org });
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/orgs/:orgId/users', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const users = await listOrgUsers(req.params.orgId);
        res.json({ users });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs/:orgId/users/invite', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const { uid, role } = req.body;
        const membership = await inviteOrgUser(req.params.orgId, uid, role, req.authUser.uid);
        await logAuditEvent(req.params.orgId, membership.invitedBy ?? 'system', 'user.invite', 'orgUsers', { uid, role });
        res.status(201).json({ membership });
    }
    catch (error) {
        next(error);
    }
});
router.patch('/admin/orgs/:orgId/users/:uid', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        await updateOrgUserRole(req.params.orgId, req.params.uid, req.body.role);
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'user.role.update', 'orgUsers', {
            uid: req.params.uid,
            role: req.body.role,
        });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
router.delete('/admin/orgs/:orgId/users/:uid', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        await removeOrgUser(req.params.orgId, req.params.uid);
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'user.remove', 'orgUsers', {
            uid: req.params.uid,
        });
        res.status(204).end();
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/orgs/:orgId/settings', requireRole(['Owner', 'Admin', 'Agent']), async (req, res, next) => {
    try {
        const settings = await getOrgSettings(req.params.orgId);
        res.json({ settings });
    }
    catch (error) {
        next(error);
    }
});
router.patch('/admin/orgs/:orgId/settings', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const settings = await updateOrgSettings(req.params.orgId, req.body);
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'settings.update', 'orgSettings', req.body);
        res.json({ settings });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs/:orgId/channels/:channel/connect', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const channelState = await connectChannel(req.params.orgId, req.params.channel, {
            token: req.body.token,
            metadata: req.body.metadata,
        });
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'channel.connect', req.params.channel, {});
        res.json({ channel: channelState });
    }
    catch (error) {
        next(error);
    }
});
router.delete('/admin/orgs/:orgId/channels/:channel/disconnect', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        await disconnectChannel(req.params.orgId, req.params.channel);
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'channel.disconnect', req.params.channel, {});
        res.status(204).end();
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs/:orgId/secret', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        await storeSecret(req.params.orgId, req.body.key, req.body.value);
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'secret.put', req.body.key, {});
        res.status(201).json({ ref: `vault/${req.params.orgId}_${req.body.key}` });
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/orgs/:orgId/secret/:key', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const secret = await describeSecret(req.params.orgId, req.params.key);
        res.json({ secret });
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/orgs/:orgId/usage', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const usage = await getUsage(req.params.orgId, req.query.from, req.query.to);
        res.json({ usage });
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/plans', requireFirebase, async (_req, res, next) => {
    try {
        const plans = await listPlans();
        res.json({ plans });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs/:orgId/plan/swap', requireRole(['Owner']), async (req, res, next) => {
    try {
        const session = await swapPlan(req.params.orgId, req.body.plan, req.body.successUrl ?? 'https://admin.dott-media.com/success', req.body.cancelUrl ?? 'https://admin.dott-media.com/cancel');
        await updateOrg(req.params.orgId, { plan: req.body.plan });
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'plan.swap', 'orgs', {
            plan: req.body.plan,
        });
        res.json(session);
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs/:orgId/test/webhook', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        // TODO: send sample payload to stored webhook URL.
        await logAuditEvent(req.params.orgId, req.authUser.uid, 'webhook.test', 'ops', req.body);
        res.json({ status: 'sent' });
    }
    catch (error) {
        next(error);
    }
});
router.post('/admin/orgs/:orgId/jobs/run', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const job = await enqueueJob(req.params.orgId, req.body.type, req.authUser.uid);
        res.json(job);
    }
    catch (error) {
        next(error);
    }
});
router.get('/admin/orgs/:orgId/audit', requireRole(['Owner', 'Admin']), async (req, res, next) => {
    try {
        const limit = Number(req.query.limit ?? 100);
        const snap = await firestore
            .collection('audit')
            .doc(req.params.orgId)
            .collection('events')
            .orderBy('ts', 'desc')
            .limit(limit)
            .get();
        const events = snap.docs.map(eventDoc => ({ id: eventDoc.id, ...eventDoc.data() }));
        res.json({ events });
    }
    catch (error) {
        next(error);
    }
});
export default router;

import { Router } from 'express';
import createHttpError from 'http-errors';
// TODO: Extend with Google/Microsoft SSO claims once identity providers are connected.
import { requireFirebase } from '../middleware/firebaseAuth';
import { withOrgContext, requireRole } from '../middleware/orgAuth';
import { createOrg, getOrg, updateOrg, listOrgUsers, inviteOrgUser, updateOrgUserRole, removeOrgUser, getOrgSettings, updateOrgSettings, connectChannel, disconnectChannel, storeSecret, describeSecret, getUsage, listPlans, swapPlan, enqueueJob, logAuditEvent, } from '../services/admin/adminService';
import { firestore } from '../lib/firebase';
const router = Router();
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

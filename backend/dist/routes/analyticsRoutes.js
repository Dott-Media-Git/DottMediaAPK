import { Router } from 'express';
import { requireFirebase } from '../middleware/firebaseAuth';
import { AnalyticsService, getOutboundStats, getInboundStats, getEngagementStats, getFollowupStats, getWebLeadStats, } from '../services/analyticsService';
const router = Router();
const analytics = new AnalyticsService();
router.get('/analytics', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const data = await analytics.getSummary(authUser.uid);
        res.json({ analytics: data });
    }
    catch (err) {
        next(err);
    }
});
router.get('/stats/outbound', async (_req, res, next) => {
    try {
        const stats = await getOutboundStats();
        res.json({ stats });
    }
    catch (err) {
        next(err);
    }
});
router.get('/stats/inbound', async (_req, res, next) => {
    try {
        const stats = await getInboundStats();
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/engagement', async (_req, res, next) => {
    try {
        const stats = await getEngagementStats();
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/followups', async (_req, res, next) => {
    try {
        const stats = await getFollowupStats();
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/webLeads', async (_req, res, next) => {
    try {
        const stats = await getWebLeadStats();
        res.json({ stats });
    }
    catch (error) {
        next(error);
    }
});
export default router;

import { Router } from 'express';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import {
  AnalyticsService,
  getOutboundStats,
  getInboundStats,
  getEngagementStats,
  getFollowupStats,
  getWebLeadStats,
} from '../services/analyticsService';
import { getLiveSocialMetrics } from '../services/liveSocialMetricsService';

const router = Router();
const analytics = new AnalyticsService();

router.get('/analytics', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const data = await analytics.getSummary(authUser.uid);
    res.json({ analytics: data });
  } catch (err) {
    next(err);
  }
});

router.get('/stats/outbound', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const stats = await getOutboundStats({ userId: authUser?.uid, scopeId });
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

router.get('/stats/inbound', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const stats = await getInboundStats({ userId: authUser?.uid, scopeId });
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

router.get('/stats/engagement', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const stats = await getEngagementStats({ userId: authUser?.uid, scopeId });
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

router.get('/stats/followups', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const stats = await getFollowupStats({ userId: authUser?.uid, scopeId });
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

router.get('/stats/webLeads', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const stats = await getWebLeadStats({ userId: authUser?.uid, scopeId });
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

router.get('/stats/socialLive', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
    const lookbackRaw = typeof req.query.lookbackHours === 'string' ? Number(req.query.lookbackHours) : undefined;
    const lookbackHours = Number.isFinite(lookbackRaw) && (lookbackRaw as number) > 0 ? Number(lookbackRaw) : undefined;
    const stats = await getLiveSocialMetrics(authUser.uid, {
      lookbackHours,
      scope: { userId: authUser.uid, scopeId },
    });
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

export default router;

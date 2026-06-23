import { Router } from 'express';
import createHttpError from 'http-errors';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import {
  createCheckoutSession,
  getBillingOverview,
  listBillingPlans,
  resolveBillingScope,
  consumeUsage,
} from '../services/billing/billingService';
import { UsageResource } from '../services/billing/planCatalog';

const router = Router();

const getScope = (req: AuthedRequest) => {
  const user = req.authUser;
  if (!user) throw createHttpError(401, 'Authentication required');
  return resolveBillingScope(user.uid, req.header('x-org-id'), user.email);
};

router.get('/billing/plans', requireFirebase, (_req, res) => {
  res.json({ plans: listBillingPlans() });
});

router.get('/billing/overview', requireFirebase, async (req, res, next) => {
  try {
    const overview = await getBillingOverview(getScope(req as AuthedRequest));
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

router.post('/billing/checkout', requireFirebase, async (req, res, next) => {
  try {
    const { plan, successUrl, cancelUrl } = req.body ?? {};
    if (!plan) throw createHttpError(400, 'Missing plan');
    const fallbackBase = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://dottmediaapk.web.app';
    const session = await createCheckoutSession(
      getScope(req as AuthedRequest),
      plan,
      successUrl || `${fallbackBase}/subscription?checkout=success`,
      cancelUrl || `${fallbackBase}/subscription?checkout=cancel`,
    );
    res.json(session);
  } catch (error) {
    next(error);
  }
});

router.post('/billing/usage/consume', requireFirebase, async (req, res, next) => {
  try {
    const { resource, amount } = req.body ?? {};
    const allowed: UsageResource[] = ['aiReplies', 'images', 'basicVideos', 'proVideos', 'scheduledPosts', 'connectedSocials'];
    if (!allowed.includes(resource)) throw createHttpError(400, 'Unsupported usage resource');
    const result = await consumeUsage(getScope(req as AuthedRequest), resource, Number(amount ?? 1));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;


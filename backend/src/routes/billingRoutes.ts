import { z } from 'zod';
import { Router } from 'express';
import createHttpError from 'http-errors';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import {
  createCheckoutSession,
  getBillingOverview,
  listBillingPlans,
  resolveBillingScope,
  consumeUsage,
  listFinancialAllocations,
  applyFlutterwavePayment,
} from '../services/billing/billingService';
import { UsageResource } from '../services/billing/planCatalog';

import {
  createMtnQuote, currentMtnPayment, mtnCheckoutMode, startMtnPayment, checkMtnPayment,
} from '../services/billing/mtnMomoCheckout';

const router = Router();

const mtnPaths = '/billing/payments/mtn';

const mtnBody = z.object({
  planId: z.enum(['creator', 'agency']),
  mode: z.enum(['sandbox', 'production']),
  amountUgx: z.number().int().positive().safe(),
  phone: z.string().min(1).max(40),
});

router.use(mtnPaths, requireFirebase, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get(mtnPaths + '/config', (req, res) => {
  res.json({ mode: mtnCheckoutMode((req as AuthedRequest).authUser!.uid) });
});

router.get(mtnPaths + '/quote', (req, res, next) => {
  try {
    const planId = req.query.plan;
    if (typeof planId !== 'string') throw createHttpError(400, 'Choose a plan.');
    res.json(createMtnQuote((req as AuthedRequest).authUser!.uid, planId));
  } catch (error) { next(error); }
});

router.get(mtnPaths + '/current', async (req, res, next) => {
  try {
    res.json({ payment: await currentMtnPayment((req as AuthedRequest).authUser!.uid) });
  } catch (error) { next(error); }
});

router.post(mtnPaths + '/checkout', async (req, res, next) => {
  try {
    const request = mtnBody.safeParse(req.body);
    if (!request.success) throw createHttpError(400, 'A valid plan, quote and mobile number are required.');
    res.json({ payment: await startMtnPayment((req as AuthedRequest).authUser!.uid, request.data) });
  } catch (error) { next(error); }
});

router.post(mtnPaths + '/:id/check', async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) throw createHttpError(404, 'MTN MoMo payment not found.');
    res.json({ payment: await checkMtnPayment((req as AuthedRequest).authUser!.uid, req.params.id) });
  } catch (error) { next(error); }
});

const getScope = (req: AuthedRequest) => {
  const user = req.authUser;
  if (!user) throw createHttpError(401, 'Authentication required');
  return resolveBillingScope(user.uid, req.header('x-org-id'), user.email);
};

router.get('/billing/plans', (_req, res) => {
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
    const { plan, successUrl, cancelUrl, provider, phoneNumber } = req.body ?? {};
    if (!plan) throw createHttpError(400, 'Missing plan');
    const fallbackBase = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://dottmediaapk.web.app';
    const session = await createCheckoutSession(
      getScope(req as AuthedRequest),
      plan,
      successUrl || `${fallbackBase}/subscription?checkout=success`,
      cancelUrl || `${fallbackBase}/subscription?checkout=cancel`,
      { provider, phoneNumber },
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

router.get('/billing/financial-ledger', requireFirebase, async (req, res, next) => {
  try {
    const allocations = await listFinancialAllocations(
      getScope(req as AuthedRequest),
      Number(req.query.limit ?? 12),
    );
    res.json({ allocations });
  } catch (error) {
    next(error);
  }
});

router.post('/billing/payments/flutterwave/verify', requireFirebase, async (req, res, next) => {
  try {
    const { txRef, transactionId } = req.body ?? {};
    const result = await applyFlutterwavePayment({ txRef, transactionId });
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

export default router;

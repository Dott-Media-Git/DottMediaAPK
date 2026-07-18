import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth.js';
import { metaAdsService } from '../services/metaAdsService.js';
import { metaAdsControlService } from '../services/metaAdsControlService.js';

const router = Router();

const audienceSchema = z
  .object({
    countries: z.array(z.string().min(2)).optional(),
    ageMin: z.number().int().min(13).max(65).optional(),
    ageMax: z.number().int().min(13).max(65).optional(),
  })
  .optional();

const boostRuleSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['manual', 'auto']).optional(),
  adAccountId: z.string().optional(),
  pageId: z.string().optional(),
  instagramActorId: z.string().optional(),
  whatsappNumber: z.string().optional(),
  whatsappLink: z.string().optional(),
  dailyBudgetUsd: z.number().positive().optional(),
  dailyBudgetMinor: z.number().int().positive().optional(),
  durationHours: z.number().int().positive().optional(),
  currency: z.string().optional(),
  objective: z.string().optional(),
  billingEvent: z.string().optional(),
  optimizationGoal: z.string().optional(),
  statusOnCreate: z.enum(['PAUSED', 'ACTIVE']).optional(),
  autoBoostPlatforms: z.array(z.string()).optional(),
  autoBoostStrategy: z.enum(['latest', 'best_performing']).optional(),
  performanceWindowHours: z.number().positive().optional(),
  minCandidateAgeMinutes: z.number().min(0).optional(),
  autoBoostCooldownHours: z.number().min(0).optional(),
  audience: audienceSchema,
});

const boostPostSchema = z.object({
  platform: z.string().default('facebook'),
  postId: z.string().min(1),
  caption: z.string().default(''),
  imageUrl: z.string().optional(),
  adAccountId: z.string().optional(),
  dailyBudgetUsd: z.number().positive().optional(),
  dailyBudgetMinor: z.number().int().positive().optional(),
  durationHours: z.number().int().positive().optional(),
  whatsappNumber: z.string().optional(),
});

const policySchema = z.object({
  dailySpendLimitUsd: z.number().positive().max(100000).optional(),
  perActionLimitUsd: z.number().positive().max(100000).optional(),
  requireApproval: z.boolean().optional(),
  allowActivation: z.boolean().optional(),
  allowBudgetChanges: z.boolean().optional(),
});

const connectionSchema = z.object({
  accessToken: z.string().min(10).optional(),
  selectedAdAccountId: z.string().optional(),
});

const actionSchema = z.object({
  action: z.enum(['create_campaign_draft', 'activate_ad', 'pause_ad', 'update_budget', 'mcp_tool']),
  payload: z.record(z.string(), z.any()).default({}),
  source: z.string().max(40).default('ads_manager'),
});

router.get('/meta-ads/ad-accounts', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const accounts = await metaAdsService.listAdAccounts(userId);
    res.json({ accounts });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/boost-rule', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const rule = await metaAdsService.getBoostRule(userId);
    res.json({ rule });
  } catch (error) {
    next(error);
  }
});

router.post('/meta-ads/boost-rule', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const payload = boostRuleSchema.parse(req.body ?? {});
    const rule = await metaAdsService.upsertBoostRule(userId, payload);
    res.json({ ok: true, rule });
  } catch (error) {
    next(error);
  }
});

router.post('/meta-ads/boost-post', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const payload = boostPostSchema.parse(req.body ?? {});
    const run = await metaAdsService.boostPublishedPost({
      userId,
      platform: payload.platform,
      postId: payload.postId,
      caption: payload.caption,
      imageUrl: payload.imageUrl,
      adAccountId: payload.adAccountId,
      dailyBudgetUsd: payload.dailyBudgetUsd,
      dailyBudgetMinor: payload.dailyBudgetMinor,
      durationHours: payload.durationHours,
      whatsappNumber: payload.whatsappNumber,
    });
    res.json({ ok: true, run });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/runs', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const limit = Number(req.query.limit ?? 25);
    const runs = await metaAdsService.listRuns(userId, limit);
    res.json({ runs });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/performance', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const limit = Number(req.query.limit ?? 25);
    const performance = await metaAdsService.getPerformance(userId, limit);
    res.json({ performance });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/connection', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    res.json({ connection: await metaAdsControlService.getConnectionStatus(userId) });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/mcp/tools', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    res.json(await metaAdsControlService.listMcpTools(userId));
  } catch (error) {
    next(error);
  }
});

router.post('/meta-ads/connection', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const payload = connectionSchema.parse(req.body ?? {});
    res.json({ ok: true, connection: await metaAdsControlService.saveConnection(userId, payload) });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/policy', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    res.json({ policy: await metaAdsControlService.getPolicy(userId) });
  } catch (error) {
    next(error);
  }
});

router.post('/meta-ads/policy', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const payload = policySchema.parse(req.body ?? {});
    res.json({ ok: true, policy: await metaAdsControlService.savePolicy(userId, payload) });
  } catch (error) {
    next(error);
  }
});

router.post('/meta-ads/actions', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const payload = actionSchema.parse(req.body ?? {});
    const approval = await metaAdsControlService.requestAction(userId, payload.action, payload.payload, payload.source);
    res.status(202).json({ ok: true, approval });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/approvals', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    res.json({ approvals: await metaAdsControlService.listApprovals(userId, Number(req.query.limit ?? 30)) });
  } catch (error) {
    next(error);
  }
});

router.post('/meta-ads/approvals/:id/:decision', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const decision = z.enum(['approve', 'reject']).parse(req.params.decision);
    res.json({ ok: true, approval: await metaAdsControlService.decideApproval(userId, req.params.id, decision) });
  } catch (error) {
    next(error);
  }
});

router.get('/meta-ads/audit', requireFirebase, async (req, res, next) => {
  try {
    const userId = (req as AuthedRequest).authUser?.uid;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    res.json({ audit: await metaAdsControlService.listAudit(userId, Number(req.query.limit ?? 50)) });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth.js';
import { metaAdsService } from '../services/metaAdsService.js';

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

export default router;

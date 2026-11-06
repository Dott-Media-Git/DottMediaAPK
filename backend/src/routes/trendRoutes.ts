import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { getNewsTrendingCandidates } from '../services/newsTrendSources';
import { getTrendingCandidates as getFootballTrendingCandidates } from '../services/footballTrendSources';
import { getUserTrendConfig, getUserTrendSources, saveUserTrendSources } from '../services/userTrendSourceService';
import { resolveBrandIdForClient } from '../services/brandKitService';
import {
  getInstagramPublicTrendConfig,
  saveInstagramPublicTrendConfig,
  scanInstagramPublicTrends,
} from '../services/instagramPublicTrendService';

const router = Router();

const scanSchema = z.object({
  maxCandidates: z.number().int().min(1).max(20).optional(),
  maxAgeHours: z.number().int().min(6).max(168).optional(),
});

const selectorsSchema = z.object({
  item: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  link: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  published: z.string().min(1).optional(),
});

const sourceSchema = z.object({
  url: z.string().url(),
  label: z.string().min(1).optional(),
  type: z.enum(['rss', 'atom', 'html']).optional(),
  selectors: selectorsSchema.optional(),
});

const sourcesSchema = z.object({
  sources: z.array(sourceSchema).max(20),
});

const instagramTrendConfigSchema = z.object({
  enabled: z.boolean().optional(),
  hashtags: z.union([z.array(z.string()), z.string()]).optional(),
});

const instagramTrendScanSchema = z.object({
  hashtags: z.union([z.array(z.string()), z.string()]).optional(),
});

const resolveScope = (email?: string | null) => {
  const normalized = email?.toLowerCase() ?? '';
  const brandId = normalized ? resolveBrandIdForClient(normalized) : null;
  return brandId === 'bwinbetug' ? 'football' : 'global';
};

router.get('/trends/sources', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const sources = await getUserTrendSources(authUser.uid);
    res.json({ sources });
  } catch (error) {
    next(error);
  }
});

router.post('/trends/sources', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const payload = sourcesSchema.parse(req.body ?? {});
    const sources = await saveUserTrendSources(authUser.uid, payload.sources);
    res.json({ sources });
  } catch (error) {
    next(error);
  }
});

router.get('/trends/instagram/config', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    res.json(await getInstagramPublicTrendConfig(authUser.uid));
  } catch (error) {
    next(error);
  }
});

router.post('/trends/instagram/config', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const payload = instagramTrendConfigSchema.parse(req.body ?? {});
    const config = await saveInstagramPublicTrendConfig(authUser.uid, payload);
    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.post('/trends/instagram/scan', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const payload = instagramTrendScanSchema.parse(req.body ?? {});
    const result = await scanInstagramPublicTrends(authUser.uid, payload.hashtags);
    res.json(result);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'INSTAGRAM_PUBLIC_TRENDS_NOT_CONNECTED') {
      return res.status(409).json({ message: (error as Error).message, code });
    }
    if (code === 'INSTAGRAM_PUBLIC_TRENDS_API_ERROR') {
      return res.status(502).json({ message: (error as Error).message, code });
    }
    next(error);
  }
});

router.post('/trends/scan', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const payload = scanSchema.parse(req.body ?? {});
    const { sources, mode } = await getUserTrendConfig(authUser.uid);
    const scope = resolveScope(authUser.email ?? null);
    const candidates =
      scope === 'football'
        ? await getFootballTrendingCandidates({ ...payload, sources })
        : await getNewsTrendingCandidates({ ...payload, sources, sourceMode: mode });
    res.json({ scope, candidates, sources, sourceMode: mode });
  } catch (error) {
    next(error);
  }
});

export default router;

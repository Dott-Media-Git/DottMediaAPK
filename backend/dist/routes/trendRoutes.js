import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { getNewsTrendingCandidates } from '../services/newsTrendSources.js';
import { getTrendingCandidates as getFootballTrendingCandidates } from '../services/footballTrendSources.js';
import { getUserTrendConfig, getUserTrendSources, saveUserTrendSources } from '../services/userTrendSourceService.js';
import { resolveBrandIdForClient } from '../services/brandKitService.js';
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
const resolveScope = (email) => {
    const normalized = email?.toLowerCase() ?? '';
    const brandId = normalized ? resolveBrandIdForClient(normalized) : null;
    return brandId === 'bwinbetug' ? 'football' : 'global';
};
router.get('/trends/sources', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const sources = await getUserTrendSources(authUser.uid);
        res.json({ sources });
    }
    catch (error) {
        next(error);
    }
});
router.post('/trends/sources', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const payload = sourcesSchema.parse(req.body ?? {});
        const sources = await saveUserTrendSources(authUser.uid, payload.sources);
        res.json({ sources });
    }
    catch (error) {
        next(error);
    }
});
router.post('/trends/scan', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const payload = scanSchema.parse(req.body ?? {});
        const { sources, mode } = await getUserTrendConfig(authUser.uid);
        const scope = resolveScope(authUser.email ?? null);
        const candidates = scope === 'football'
            ? await getFootballTrendingCandidates({ ...payload, sources })
            : await getNewsTrendingCandidates({ ...payload, sources, sourceMode: mode });
        res.json({ scope, candidates, sources, sourceMode: mode });
    }
    catch (error) {
        next(error);
    }
});
export default router;

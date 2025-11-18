import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase } from '../middleware/firebaseAuth';
import { socialSchedulingService } from '../packages/services/socialSchedulingService';
import { socialPostingService } from '../packages/services/socialPostingService';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService';
const CRON_SECRET = process.env.CRON_SECRET;
const router = Router();
const scheduleSchema = z.object({
    userId: z.string().min(1),
    platforms: z.array(z.enum(['instagram', 'facebook', 'linkedin', 'twitter', 'x', 'threads', 'tiktok'])).min(1),
    images: z.array(z.string().min(1)).min(1),
    caption: z.string().min(4),
    hashtags: z.string().optional(),
    scheduledFor: z.string(),
    timesPerDay: z.number().int().min(1).max(5),
});
router.post('/posts/schedule', requireFirebase, async (req, res, next) => {
    try {
        const payload = scheduleSchema.parse(req.body);
        const authUser = req.authUser;
        if (!authUser || authUser.uid !== payload.userId) {
            return res.status(403).json({ message: 'Cannot schedule for another user' });
        }
        const result = await socialSchedulingService.schedulePosts(payload);
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
router.get('/social/runQueue', async (req, res, next) => {
    try {
        if (CRON_SECRET && req.query.token !== CRON_SECRET) {
            return res.status(401).json({ message: 'Invalid token' });
        }
        const result = await socialPostingService.runQueue();
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
router.get('/social/history', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        const userId = req.query.userId ?? authUser?.uid;
        if (!userId || authUser?.uid !== userId) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const history = await socialPostingService.getHistory(userId);
        const daily = await socialAnalyticsService.getDailySummary(userId);
        res.json({ ...history, daily });
    }
    catch (error) {
        next(error);
    }
});
export default router;

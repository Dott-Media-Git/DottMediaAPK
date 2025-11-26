import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
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
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser || authUser.uid !== payload.userId) {
      return res.status(403).json({ message: 'Cannot schedule for another user' });
    }
    const result = await socialSchedulingService.schedulePosts(payload);
    res.json(result);
  } catch (error) {
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
  } catch (error) {
    next(error);
  }
});

router.get('/social/history', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    const userId = (req.query.userId as string) ?? authUser?.uid;
    if (!userId || authUser?.uid !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const history = await socialPostingService.getHistory(userId);
    const daily = await socialAnalyticsService.getDailySummary(userId);
    res.json({ ...history, daily });
  } catch (error) {
    next(error);
  }
});

const credentialsSchema = z.object({
  userId: z.string().min(1),
  credentials: z.object({
    facebook: z.object({ accessToken: z.string(), pageId: z.string(), pageName: z.string().optional() }).optional(),
    instagram: z.object({ accessToken: z.string(), accountId: z.string(), username: z.string().optional() }).optional(),
    linkedin: z.object({ accessToken: z.string(), urn: z.string() }).optional(),
    twitter: z.object({ accessToken: z.string(), accessSecret: z.string() }).optional(),
  }),
});

router.post('/social/credentials', requireFirebase, async (req, res, next) => {
  try {
    const payload = credentialsSchema.parse(req.body);
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser || authUser.uid !== payload.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Import firestore dynamically or from lib to avoid circular deps if any
    const { firestore } = await import('../lib/firebase');

    await firestore.collection('users').doc(payload.userId).set(
      { socialAccounts: payload.credentials },
      { merge: true }
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;

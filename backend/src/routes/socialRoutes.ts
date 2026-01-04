import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { socialSchedulingService } from '../packages/services/socialSchedulingService';
import { socialPostingService } from '../packages/services/socialPostingService';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService';
import { autoPostService } from '../services/autoPostService';
import { firestore } from '../db/firestore';
import { config } from '../config';
import { getTikTokIntegration, getYouTubeIntegration } from '../services/socialIntegrationService';

const CRON_SECRET = process.env.CRON_SECRET;

const router = Router();

const scheduleSchema = z
  .object({
    userId: z.string().min(1),
    platforms: z.array(z.enum(['instagram', 'instagram_reels', 'facebook', 'linkedin', 'twitter', 'x', 'threads', 'tiktok', 'youtube'])).min(1),
    images: z.array(z.string().min(1)).optional(),
    videoUrl: z.string().url().optional(),
    youtubeVideoUrl: z.string().url().optional(),
    tiktokVideoUrl: z.string().url().optional(),
    instagramReelsVideoUrl: z.string().url().optional(),
    videoTitle: z.string().min(1).optional(),
    caption: z.string().min(4),
    hashtags: z.string().optional(),
    scheduledFor: z.string(),
    timesPerDay: z.number().int().min(1).max(5),
  })
  .superRefine((data, ctx) => {
    const hasYoutube = data.platforms.includes('youtube');
    const hasTikTok = data.platforms.includes('tiktok');
    const hasReels = data.platforms.includes('instagram_reels');
    const videoCapable = new Set(['facebook', 'linkedin']);
    const hasImagePlatform = data.platforms.some(platform => {
      if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram_reels') return false;
      if (videoCapable.has(platform) && data.videoUrl) return false;
      return true;
    });
    if (hasImagePlatform && (!data.images || data.images.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['images'],
        message: 'Images are required for the selected platforms.',
      });
    }
    if (hasYoutube && !(data.youtubeVideoUrl || data.videoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['videoUrl'],
        message: 'YouTube video URL is required.',
      });
    }
    if (hasTikTok && !(data.tiktokVideoUrl || data.videoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['videoUrl'],
        message: 'TikTok video URL is required.',
      });
    }
    if (hasReels && !data.instagramReelsVideoUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instagramReelsVideoUrl'],
        message: 'Instagram Reels video URL is required.',
      });
    }
  });

const autoPostSchema = z
  .object({
    platforms: z
      .array(z.enum(['instagram', 'instagram_reels', 'facebook', 'linkedin', 'twitter', 'x', 'threads', 'tiktok', 'youtube']))
      .min(1)
      .optional(),
    prompt: z.string().optional(),
    businessType: z.string().optional(),
    videoUrl: z.string().url().optional(),
    videoUrls: z.array(z.string().url()).optional(),
    videoTitle: z.string().min(1).optional(),
    youtubePrivacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
    youtubeVideoUrl: z.string().url().optional(),
    youtubeVideoUrls: z.array(z.string().url()).optional(),
    youtubeShorts: z.boolean().optional(),
    tiktokVideoUrl: z.string().url().optional(),
    tiktokVideoUrls: z.array(z.string().url()).optional(),
    instagramReelsVideoUrl: z.string().url().optional(),
    instagramReelsVideoUrls: z.array(z.string().url()).optional(),
    reelsIntervalHours: z.number().positive().optional(),
  })
  .superRefine((data, ctx) => {
    const platforms = data.platforms ?? [];
    const hasYoutube = platforms.includes('youtube');
    const hasTikTok = platforms.includes('tiktok');
    const hasReels = platforms.includes('instagram_reels');
    const youtubeHasVideo = Boolean(data.youtubeVideoUrl) || Boolean(data.youtubeVideoUrls?.length) || Boolean(data.videoUrl) || Boolean(data.videoUrls?.length);
    const tiktokHasVideo = Boolean(data.tiktokVideoUrl) || Boolean(data.tiktokVideoUrls?.length) || Boolean(data.videoUrl) || Boolean(data.videoUrls?.length);
    const reelsHasVideo =
      Boolean(data.instagramReelsVideoUrl) ||
      Boolean(data.instagramReelsVideoUrls?.length) ||
      Boolean(data.videoUrl) ||
      Boolean(data.videoUrls?.length);
    if (hasYoutube && !youtubeHasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['youtubeVideoUrl'],
        message: 'YouTube video URL is required.',
      });
    }
    if (hasTikTok && !tiktokHasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tiktokVideoUrl'],
        message: 'TikTok video URL is required.',
      });
    }
    if (hasReels && !reelsHasVideo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['instagramReelsVideoUrl'],
        message: 'Instagram Reels video URL is required (instagramReelsVideoUrl or videoUrl).',
      });
    }
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

router.post('/autopost/runNow', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const payload = autoPostSchema.parse(req.body ?? {});
    const userId = authUser.uid;

    // Ensure a job exists and capture prompt/businessType updates if provided.
    const result = await autoPostService.start({
      userId,
      platforms: payload.platforms,
      prompt: payload.prompt,
      businessType: payload.businessType,
      videoUrl: payload.videoUrl,
      videoUrls: payload.videoUrls,
      videoTitle: payload.videoTitle,
      youtubePrivacyStatus: payload.youtubePrivacyStatus,
      youtubeVideoUrl: payload.youtubeVideoUrl,
      youtubeVideoUrls: payload.youtubeVideoUrls,
      youtubeShorts: payload.youtubeShorts,
      tiktokVideoUrl: payload.tiktokVideoUrl,
      tiktokVideoUrls: payload.tiktokVideoUrls,
      instagramReelsVideoUrl: payload.instagramReelsVideoUrl,
      instagramReelsVideoUrls: payload.instagramReelsVideoUrls,
      reelsIntervalHours: payload.reelsIntervalHours,
    });
    res.json({ ok: true, ...result });
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
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const userDoc = await firestore.collection('users').doc(authUser.uid).get();
    const historyUserId = (userDoc.data()?.historyUserId as string | undefined)?.trim();

    if (requestedUserId && requestedUserId !== authUser.uid && requestedUserId !== historyUserId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const userId = requestedUserId || historyUserId || authUser.uid;
    const history = await socialPostingService.getHistory(userId);
    const daily = await socialAnalyticsService.getDailySummary(userId);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.json({ ...history, daily, userId });
  } catch (error) {
    next(error);
  }
});

router.get('/social/status', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });

    const userDoc = await firestore.collection('users').doc(authUser.uid).get();
    const accounts = (userDoc.data()?.socialAccounts as Record<string, any> | undefined) ?? {};
    const youtube = await getYouTubeIntegration(authUser.uid);
    const tiktok = await getTikTokIntegration(authUser.uid);

    const status = {
      facebook:
        Boolean(accounts.facebook?.accessToken && accounts.facebook?.pageId) ||
        Boolean(config.channels.facebook.pageToken && config.channels.facebook.pageId),
      instagram:
        Boolean(accounts.instagram?.accessToken && accounts.instagram?.accountId) ||
        Boolean(config.channels.instagram.accessToken && config.channels.instagram.businessId),
      linkedin:
        Boolean(accounts.linkedin?.accessToken && accounts.linkedin?.urn) ||
        Boolean(config.linkedin.accessToken && config.linkedin.organizationId),
      twitter: Boolean(accounts.twitter?.accessToken && accounts.twitter?.accessSecret),
      youtube: Boolean(youtube?.connected),
      tiktok:
        Boolean(tiktok?.connected) ||
        Boolean(config.tiktok.accessToken && config.tiktok.openId),
    };

    res.json({ status });
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
    tiktok: z
      .object({
        accessToken: z.string(),
        openId: z.string(),
        refreshToken: z.string().optional(),
        clientKey: z.string().optional(),
        clientSecret: z.string().optional(),
      })
      .optional(),
    youtube: z
      .object({
        refreshToken: z.string(),
        accessToken: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        redirectUri: z.string().optional(),
        privacyStatus: z.enum(['private', 'public', 'unlisted']).optional(),
        channelId: z.string().optional(),
      })
      .optional(),
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
    const { firestore } = await import('../db/firestore');

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

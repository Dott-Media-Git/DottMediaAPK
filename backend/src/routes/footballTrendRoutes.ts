import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { footballTrendContentService } from '../services/footballTrendContentService';
import { getTrendingCandidates } from '../services/footballTrendSources';
import { socialSchedulingService } from '../packages/services/socialSchedulingService';

const router = Router();

const scanSchema = z.object({
  maxCandidates: z.number().int().min(1).max(20).optional(),
  maxAgeHours: z.number().int().min(6).max(168).optional(),
});

const generateSchema = z.object({
  topic: z.string().min(3),
  context: z.string().min(10),
  trendSignals: z.array(z.string().min(3)).optional(),
  brandId: z.string().min(2).optional(),
  clientId: z.string().min(2).optional(),
  brand: z
    .object({
      name: z.string().min(2),
      handle: z.string().optional(),
      tone: z.string().optional(),
      colors: z.array(z.string().min(1)).optional(),
      typography: z.string().optional(),
      logoPlacement: z.string().optional(),
      logoPath: z.string().optional(),
      templates: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  channels: z.array(z.string().min(2)).min(1),
  region: z.string().optional(),
  language: z.string().optional(),
  rightsInfo: z.string().optional(),
  includePosterImage: z.boolean().optional(),
  imageCount: z.number().int().min(1).max(1).optional(),
}).superRefine((data, ctx) => {
  if (!data.brand && !data.brandId && !data.clientId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['brand'],
      message: 'brand, brandId, or clientId is required.',
    });
  }
});

const scheduleSchema = z
  .object({
    platforms: z
      .array(
        z.enum([
          'instagram',
          'instagram_reels',
          'instagram_story',
          'facebook',
          'facebook_story',
          'linkedin',
          'twitter',
          'x',
          'threads',
          'tiktok',
          'youtube',
        ]),
      )
      .min(1),
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
    const videoCapable = new Set(['facebook', 'facebook_story', 'instagram_story', 'linkedin']);
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

router.post('/football/trends/scan', requireFirebase, async (req, res, next) => {
  try {
    const payload = scanSchema.parse(req.body ?? {});
    const candidates = await getTrendingCandidates(payload);
    res.json({ candidates });
  } catch (error) {
    next(error);
  }
});

router.post('/football/trends/generate', requireFirebase, async (req, res, next) => {
  try {
    const payload = generateSchema.parse(req.body ?? {});
    const result = await footballTrendContentService.generate(payload);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/football/trends/schedule', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const payload = scheduleSchema.parse(req.body ?? {});
    const result = await socialSchedulingService.schedulePosts({
      userId: authUser.uid,
      platforms: payload.platforms,
      images: payload.images,
      videoUrl: payload.videoUrl,
      youtubeVideoUrl: payload.youtubeVideoUrl,
      tiktokVideoUrl: payload.tiktokVideoUrl,
      instagramReelsVideoUrl: payload.instagramReelsVideoUrl,
      videoTitle: payload.videoTitle,
      caption: payload.caption,
      hashtags: payload.hashtags,
      scheduledFor: payload.scheduledFor,
      timesPerDay: payload.timesPerDay,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;

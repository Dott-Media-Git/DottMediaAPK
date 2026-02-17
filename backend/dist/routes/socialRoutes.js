import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { socialSchedulingService } from '../packages/services/socialSchedulingService.js';
import { socialPostingService } from '../packages/services/socialPostingService.js';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService.js';
import { autoPostService } from '../services/autoPostService.js';
import { firestore } from '../db/firestore.js';
import { config } from '../config.js';
import { getTikTokIntegration, getYouTubeIntegration } from '../services/socialIntegrationService.js';
import { resolveFacebookPageId, resolveInstagramAccountId } from '../services/socialAccountResolver.js';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess.js';
const CRON_SECRET = process.env.CRON_SECRET;
const router = Router();
const scheduleSchema = z
    .object({
    userId: z.string().min(1),
    platforms: z
        .array(z.enum([
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
    ]))
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
        if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram_reels')
            return false;
        if (videoCapable.has(platform) && data.videoUrl)
            return false;
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
        .array(z.enum([
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
    ]))
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
    const reelsHasVideo = Boolean(data.instagramReelsVideoUrl) ||
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
router.post('/autopost/runNow', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
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
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
        const userDoc = await firestore.collection('users').doc(authUser.uid).get();
        const historyUserId = userDoc.data()?.historyUserId?.trim();
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
    }
    catch (error) {
        next(error);
    }
});
router.get('/social/status', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const userDoc = await firestore.collection('users').doc(authUser.uid).get();
        const userData = userDoc.data();
        const accounts = userData?.socialAccounts ?? {};
        const allowDefaults = canUsePrimarySocialDefaults(userData);
        const youtube = await getYouTubeIntegration(authUser.uid);
        const tiktok = await getTikTokIntegration(authUser.uid);
        const status = {
            facebook: Boolean(accounts.facebook?.accessToken && accounts.facebook?.pageId) ||
                (allowDefaults && Boolean(config.channels.facebook.pageToken && config.channels.facebook.pageId)),
            instagram: Boolean(accounts.instagram?.accessToken && accounts.instagram?.accountId) ||
                (allowDefaults && Boolean(config.channels.instagram.accessToken && config.channels.instagram.businessId)),
            linkedin: Boolean(accounts.linkedin?.accessToken && accounts.linkedin?.urn) ||
                (allowDefaults && Boolean(config.linkedin.accessToken && config.linkedin.organizationId)),
            twitter: Boolean(accounts.twitter?.accessToken && accounts.twitter?.accessSecret),
            youtube: Boolean(youtube?.connected),
            tiktok: Boolean(tiktok?.connected) ||
                (allowDefaults && Boolean(config.tiktok.accessToken && config.tiktok.openId)),
        };
        res.json({ status });
    }
    catch (error) {
        next(error);
    }
});
const credentialsSchema = z.object({
    userId: z.string().min(1),
    credentials: z.object({
        facebook: z.object({ accessToken: z.string(), pageId: z.string().optional(), pageName: z.string().optional() }).optional(),
        instagram: z.object({ accessToken: z.string(), accountId: z.string().optional(), username: z.string().optional() }).optional(),
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
        const authUser = req.authUser;
        if (!authUser || authUser.uid !== payload.userId) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        if (payload.credentials.facebook) {
            const pageId = payload.credentials.facebook.pageId?.trim() ?? '';
            const resolved = await resolveFacebookPageId(payload.credentials.facebook.accessToken, pageId || undefined);
            if (resolved?.pageId) {
                payload.credentials.facebook.pageId = resolved.pageId;
                if (!payload.credentials.facebook.pageName && resolved.pageName) {
                    payload.credentials.facebook.pageName = resolved.pageName;
                }
                // Prefer storing the Page access token so posting doesn't break when a user token expires.
                if (resolved.pageToken) {
                    payload.credentials.facebook.accessToken = resolved.pageToken;
                }
            }
            if (!payload.credentials.facebook.pageId?.trim()) {
                return res.status(400).json({
                    message: 'Facebook pageId is required. Connect a Facebook Page or provide pageId.',
                });
            }
        }
        if (payload.credentials.instagram) {
            const accountId = payload.credentials.instagram.accountId?.trim() ?? '';
            if (!accountId) {
                const resolved = await resolveInstagramAccountId(payload.credentials.instagram.accessToken);
                if (resolved?.accountId) {
                    payload.credentials.instagram.accountId = resolved.accountId;
                    if (!payload.credentials.instagram.username && resolved.username) {
                        payload.credentials.instagram.username = resolved.username;
                    }
                }
            }
            if (!payload.credentials.instagram.accountId?.trim()) {
                return res.status(400).json({
                    message: 'Instagram accountId is required. Connect an Instagram Business account or provide accountId.',
                });
            }
        }
        await firestore.collection('users').doc(payload.userId).set({ socialAccounts: payload.credentials }, { merge: true });
        res.json({ success: true });
    }
    catch (error) {
        next(error);
    }
});
export default router;

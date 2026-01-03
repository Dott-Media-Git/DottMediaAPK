import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { firestore } from '../db/firestore.js';
import { config } from '../config.js';
import { contentGenerationService, GeneratedContent } from '../packages/services/contentGenerationService.js';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService.js';
import { SocialAccounts } from '../packages/services/socialPostingService.js';
import { publishToInstagram, publishToInstagramReel } from '../packages/services/socialPlatforms/instagramPublisher.js';
import { publishToFacebook } from '../packages/services/socialPlatforms/facebookPublisher.js';
import { publishToLinkedIn } from '../packages/services/socialPlatforms/linkedinPublisher.js';
import { publishToTwitter } from '../packages/services/socialPlatforms/twitterPublisher.js';
import { publishToYouTube } from '../packages/services/socialPlatforms/youtubePublisher.js';
import { publishToTikTok } from '../packages/services/socialPlatforms/tiktokPublisher.js';
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from './socialIntegrationService.js';

type AutoPostJob = {
  userId: string;
  platforms: string[];
  prompt?: string;
  businessType?: string;
  intervalHours?: number;
  nextRun?: admin.firestore.Timestamp;
  lastRunAt?: admin.firestore.Timestamp;
  reelsIntervalHours?: number;
  reelsNextRun?: admin.firestore.Timestamp;
  reelsLastRunAt?: admin.firestore.Timestamp;
  reelsLastResult?: PostResult[];
  active?: boolean;
  recentImageUrls?: string[];
  fallbackCaption?: string;
  fallbackHashtags?: string;
  recentCaptions?: string[];
  requireAiImages?: boolean;
  videoUrl?: string;
  videoUrls?: string[];
  videoTitle?: string;
  youtubePrivacyStatus?: 'private' | 'public' | 'unlisted';
  videoCursor?: number;
  youtubeVideoUrl?: string;
  youtubeVideoUrls?: string[];
  youtubeVideoCursor?: number;
  youtubeShorts?: boolean;
  tiktokVideoUrl?: string;
  tiktokVideoUrls?: string[];
  tiktokVideoCursor?: number;
  reelsVideoUrl?: string;
  reelsVideoUrls?: string[];
  reelsVideoCursor?: number;
};

type PostResult = { platform: string; status: 'posted' | 'failed'; remoteId?: string | null; error?: string };
type HistoryEntry = {
  platform: string;
  status: 'posted' | 'failed';
  caption: string;
  remoteId?: string | null;
  errorMessage?: string;
  videoUrl?: string;
  videoTitle?: string;
};
type VideoPlatform = 'youtube' | 'tiktok' | 'instagram_reels';
type ExecuteOptions = {
  platforms?: string[];
  intervalHours?: number;
  nextRunField?: 'nextRun' | 'reelsNextRun';
  lastRunField?: 'lastRunAt' | 'reelsLastRunAt';
  resultField?: 'lastResult' | 'reelsLastResult';
  useGenericVideoFallback?: boolean;
};

const autopostCollection = firestore.collection('autopostJobs');
const scheduledPostsCollection = firestore.collection('scheduledPosts');

const platformPublishers: Record<
  string,
  (input: {
    caption: string;
    imageUrls: string[];
    videoUrl?: string;
    videoTitle?: string;
    privacyStatus?: 'private' | 'public' | 'unlisted';
    tags?: string[];
    credentials?: SocialAccounts;
  }) => Promise<{ remoteId?: string }>
> = {
  instagram: publishToInstagram,
  instagram_reels: publishToInstagramReel,
  threads: publishToInstagram,
  tiktok: publishToTikTok,
  facebook: publishToFacebook,
  linkedin: publishToLinkedIn,
  twitter: publishToTwitter,
  youtube: publishToYouTube,
  x: publishToTwitter,
};

export class AutoPostService {
  private memoryStore = new Map<string, AutoPostJob>();
  private useMemory = config.security.allowMockAuth;
  // Post every 4 hours by default; override with AUTOPOST_INTERVAL_MINUTES for tighter testing windows.
  private defaultIntervalHours = Math.max(Number(process.env.AUTOPOST_INTERVAL_MINUTES ?? 240) / 60, 0.05);
  // Reels auto-post every 4 hours by default; override with AUTOPOST_REELS_INTERVAL_MINUTES if needed.
  private defaultReelsIntervalHours = Math.max(Number(process.env.AUTOPOST_REELS_INTERVAL_MINUTES ?? 240) / 60, 0.25);
  private fallbackImageBase =
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80';
  private defaultFallbackImagePool = [
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1485217988980-11786ced9454?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
  ];
  private getFallbackImagePool() {
    return this.loadFallbackImagePool();
  }
  private defaultFallbackCaption =
    'Meet the Dott Media AI Sales Bot helping businesses convert leads into customers. Want a quick demo? DM us to get started.';
  private defaultFallbackHashtags =
    'DottMedia, AISalesBot, SalesAutomation, LeadGeneration, BusinessGrowth, CRM, MarketingAutomation, SalesPipeline, CustomerSuccess, AI, Automation, SmallBusiness, DigitalMarketing, B2B, Productivity, AIAutomation, AIForBusiness, AIAnalytics, AIMarketing, AIStrategy, AICRM, AIProductivity, AITools, MachineLearning, GenerativeAI';
  private fallbackCaptionVariants = [
    'DM us for a quick demo.',
    'Book a 15-minute walkthrough.',
    'Want the demo link? Send a message.',
    "Ready to grow? Let's talk.",
    'Ask for a quick demo today.',
  ];

  async start(payload: {
    userId: string;
    platforms?: string[];
    prompt?: string;
    businessType?: string;
    videoUrl?: string;
    videoUrls?: string[];
    videoTitle?: string;
    youtubePrivacyStatus?: 'private' | 'public' | 'unlisted';
    youtubeVideoUrl?: string;
    youtubeVideoUrls?: string[];
    youtubeShorts?: boolean;
    tiktokVideoUrl?: string;
    tiktokVideoUrls?: string[];
    instagramReelsVideoUrl?: string;
    instagramReelsVideoUrls?: string[];
    reelsIntervalHours?: number;
  }) {
    const platforms = (payload.platforms?.length ? payload.platforms : ['instagram', 'facebook', 'linkedin']).filter(
      platform => platform !== 'instagram_reels',
    );
    const now = new Date();
    const reelsEnabled = Boolean(
      payload.instagramReelsVideoUrl ||
        (payload.instagramReelsVideoUrls && payload.instagramReelsVideoUrls.length) ||
        payload.platforms?.includes('instagram_reels'),
    );
    const reelsVideoUrl = reelsEnabled ? (payload.instagramReelsVideoUrl ?? payload.videoUrl) : undefined;
    const reelsVideoUrls = reelsEnabled
      ? payload.instagramReelsVideoUrls?.length
        ? payload.instagramReelsVideoUrls
        : payload.videoUrls
      : undefined;
    const reelsIntervalHours =
      payload.reelsIntervalHours && payload.reelsIntervalHours > 0
        ? payload.reelsIntervalHours
        : this.defaultReelsIntervalHours;
    await autopostCollection.doc(payload.userId).set(
      {
        userId: payload.userId,
        platforms,
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        ...(payload.businessType ? { businessType: payload.businessType } : {}),
        ...(payload.videoUrl ? { videoUrl: payload.videoUrl } : {}),
        ...(payload.videoUrls && payload.videoUrls.length ? { videoUrls: payload.videoUrls, videoCursor: 0 } : {}),
        ...(payload.videoTitle ? { videoTitle: payload.videoTitle } : {}),
        ...(payload.youtubePrivacyStatus ? { youtubePrivacyStatus: payload.youtubePrivacyStatus } : {}),
        ...(payload.youtubeVideoUrl ? { youtubeVideoUrl: payload.youtubeVideoUrl } : {}),
        ...(payload.youtubeVideoUrls && payload.youtubeVideoUrls.length
          ? { youtubeVideoUrls: payload.youtubeVideoUrls, youtubeVideoCursor: 0 }
          : {}),
        ...(typeof payload.youtubeShorts === 'boolean' ? { youtubeShorts: payload.youtubeShorts } : {}),
        ...(payload.tiktokVideoUrl ? { tiktokVideoUrl: payload.tiktokVideoUrl } : {}),
        ...(payload.tiktokVideoUrls && payload.tiktokVideoUrls.length
          ? { tiktokVideoUrls: payload.tiktokVideoUrls, tiktokVideoCursor: 0 }
          : {}),
        ...(reelsVideoUrl ? { reelsVideoUrl } : {}),
        ...(reelsVideoUrls && reelsVideoUrls.length ? { reelsVideoUrls, reelsVideoCursor: 0 }
          : {}),
        intervalHours: this.defaultIntervalHours,
        nextRun: admin.firestore.Timestamp.fromDate(now),
        ...(reelsEnabled
          ? {
              reelsIntervalHours,
              reelsNextRun: admin.firestore.Timestamp.fromDate(now),
            }
          : {}),
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (this.useMemory) {
      this.memoryStore.set(payload.userId, {
        userId: payload.userId,
        platforms,
        prompt: payload.prompt ?? undefined,
        businessType: payload.businessType ?? undefined,
        videoUrl: payload.videoUrl ?? undefined,
        videoUrls: payload.videoUrls ?? undefined,
        videoCursor: payload.videoUrls && payload.videoUrls.length ? 0 : undefined,
        videoTitle: payload.videoTitle ?? undefined,
        youtubePrivacyStatus: payload.youtubePrivacyStatus ?? undefined,
        youtubeVideoUrl: payload.youtubeVideoUrl ?? undefined,
        youtubeVideoUrls: payload.youtubeVideoUrls ?? undefined,
        youtubeVideoCursor: payload.youtubeVideoUrls && payload.youtubeVideoUrls.length ? 0 : undefined,
        youtubeShorts: typeof payload.youtubeShorts === 'boolean' ? payload.youtubeShorts : undefined,
        tiktokVideoUrl: payload.tiktokVideoUrl ?? undefined,
        tiktokVideoUrls: payload.tiktokVideoUrls ?? undefined,
        tiktokVideoCursor: payload.tiktokVideoUrls && payload.tiktokVideoUrls.length ? 0 : undefined,
        reelsVideoUrl: reelsVideoUrl ?? undefined,
        reelsVideoUrls: reelsVideoUrls ?? undefined,
        reelsVideoCursor:
          reelsVideoUrls && reelsVideoUrls.length ? 0 : undefined,
        intervalHours: this.defaultIntervalHours,
        nextRun: admin.firestore.Timestamp.fromDate(now),
        reelsIntervalHours: reelsEnabled ? reelsIntervalHours : undefined,
        reelsNextRun: reelsEnabled ? admin.firestore.Timestamp.fromDate(now) : undefined,
        active: true,
      });
    }
    return this.runForUser(payload.userId);
  }

  async runDueJobs() {
    const now = admin.firestore.Timestamp.now();
    if (this.useMemory) {
      const dueStandard = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.nextRun && job.nextRun.toMillis() <= now.toMillis(),
      );
      const dueReels = Array.from(this.memoryStore.entries()).filter(
        ([, job]) => job.active !== false && job.reelsNextRun && job.reelsNextRun.toMillis() <= now.toMillis(),
      );
      let processed = 0;
      const results = new Map<
        string,
        {
          userId: string;
          posted: number;
          failed: number;
          nextRun?: string | null;
          reelsPosted?: number;
          reelsFailed?: number;
          reelsNextRun?: string | null;
        }
      >();
      for (const [userId, job] of dueStandard) {
        const outcome = await this.executeJob(userId, job);
        processed += 1;
        results.set(userId, {
          userId,
          posted: outcome.posted,
          failed: outcome.failed.length,
          nextRun: outcome.nextRun,
        });
      }
      for (const [userId, job] of dueReels) {
        const outcome = await this.executeJob(userId, job, {
          platforms: ['instagram_reels'],
          intervalHours: job.reelsIntervalHours ?? this.defaultReelsIntervalHours,
          nextRunField: 'reelsNextRun',
          lastRunField: 'reelsLastRunAt',
          resultField: 'reelsLastResult',
          useGenericVideoFallback: false,
        });
        processed += 1;
        const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
        results.set(userId, {
          ...existing,
          reelsPosted: outcome.posted,
          reelsFailed: outcome.failed.length,
          reelsNextRun: outcome.nextRun,
        });
      }
      return { processed, results: Array.from(results.values()) };
    }

    // Query only by nextRun to avoid composite index requirement, then filter active in memory.
    const [standardSnap, reelsSnap] = await Promise.all([
      autopostCollection.where('nextRun', '<=', now).get(),
      autopostCollection.where('reelsNextRun', '<=', now).get(),
    ]);
    if (standardSnap.empty && reelsSnap.empty) return { processed: 0 };
    let processed = 0;
    const results = new Map<
      string,
      {
        userId: string;
        posted: number;
        failed: number;
        nextRun?: string | null;
        reelsPosted?: number;
        reelsFailed?: number;
        reelsNextRun?: string | null;
      }
    >();
    for (const doc of standardSnap.docs) {
      const data = doc.data() as AutoPostJob;
      if (data.active === false) continue;
      const outcome = await this.executeJob(doc.id, data);
      processed += 1;
      results.set(doc.id, {
        userId: doc.id,
        posted: outcome.posted,
        failed: outcome.failed.length,
        nextRun: outcome.nextRun,
      });
    }
    for (const doc of reelsSnap.docs) {
      const data = doc.data() as AutoPostJob;
      if (data.active === false) continue;
      const outcome = await this.executeJob(doc.id, data, {
        platforms: ['instagram_reels'],
        intervalHours: data.reelsIntervalHours ?? this.defaultReelsIntervalHours,
        nextRunField: 'reelsNextRun',
        lastRunField: 'reelsLastRunAt',
        resultField: 'reelsLastResult',
        useGenericVideoFallback: false,
      });
      processed += 1;
      const existing = results.get(doc.id) ?? { userId: doc.id, posted: 0, failed: 0, nextRun: null };
      results.set(doc.id, {
        ...existing,
        reelsPosted: outcome.posted,
        reelsFailed: outcome.failed.length,
        reelsNextRun: outcome.nextRun,
      });
    }
    return { processed, results: Array.from(results.values()) };
  }

  async runForUser(userId: string) {
    if (this.useMemory && this.memoryStore.has(userId)) {
      const job = this.memoryStore.get(userId)!;
      const standard = await this.executeJob(userId, job);
      if (job.reelsNextRun || job.reelsVideoUrl || (job.reelsVideoUrls && job.reelsVideoUrls.length)) {
        const reels = await this.executeJob(userId, job, {
          platforms: ['instagram_reels'],
          intervalHours: job.reelsIntervalHours ?? this.defaultReelsIntervalHours,
          nextRunField: 'reelsNextRun',
          lastRunField: 'reelsLastRunAt',
          resultField: 'reelsLastResult',
          useGenericVideoFallback: false,
        });
        return {
          ...standard,
          reelsPosted: reels.posted,
          reelsFailed: reels.failed,
          reelsNextRun: reels.nextRun,
        };
      }
      return standard;
    }
    const snap = await autopostCollection.doc(userId).get();
    if (!snap.exists) {
      return { posted: 0, failed: [{ platform: 'all', error: 'autopost_not_configured', status: 'failed' as const }], nextRun: null };
    }
    const job = snap.data() as AutoPostJob;
    const standard = await this.executeJob(userId, job);
    if (job.reelsNextRun || job.reelsVideoUrl || (job.reelsVideoUrls && job.reelsVideoUrls.length)) {
      const reels = await this.executeJob(userId, job, {
        platforms: ['instagram_reels'],
        intervalHours: job.reelsIntervalHours ?? this.defaultReelsIntervalHours,
        nextRunField: 'reelsNextRun',
        lastRunField: 'reelsLastRunAt',
        resultField: 'reelsLastResult',
        useGenericVideoFallback: false,
      });
      return {
        ...standard,
        reelsPosted: reels.posted,
        reelsFailed: reels.failed,
        reelsNextRun: reels.nextRun,
      };
    }
    return standard;
  }

  private async executeJob(userId: string, job: AutoPostJob, options: ExecuteOptions = {}) {
    const intervalHours =
      options.intervalHours ??
      (job.intervalHours && job.intervalHours > 0 ? job.intervalHours : this.defaultIntervalHours);
    const isReelsRun = (options.nextRunField ?? 'nextRun') === 'reelsNextRun';
    const effectiveIntervalHours = isReelsRun ? intervalHours : Math.max(intervalHours, this.defaultIntervalHours);
    const platforms = options.platforms ?? job.platforms ?? [];
    const nextRunField = options.nextRunField ?? 'nextRun';
    const lastRunField = options.lastRunField ?? 'lastRunAt';
    const resultField = options.resultField ?? 'lastResult';
    const useGenericVideoFallback = options.useGenericVideoFallback !== false;
    const videoPlatforms = new Set<VideoPlatform>(['youtube', 'tiktok', 'instagram_reels']);
    const enableYouTubeShorts = this.useYouTubeShorts(job);
    const basePrompt =
      job.prompt ??
      'Create a realistic, photo-style scene of the Dott Media AI Sales Bot interacting with people in an executive suite; friendly humanoid robot wearing a tie and glasses, assisting a diverse team, natural expressions, premium interior finishes, cinematic depth, subtle futuristic UI overlays, clean space reserved for a headline.';
    const styledPrompt = this.applyNeonPreference(basePrompt);
    let runPrompt = this.buildVisualPrompt(styledPrompt);
    const businessType = job.businessType ?? 'AI CRM + automation agency';
    const recentImages = this.getRecentImageHistory(job);
    const recentSet = new Set(recentImages);
    const needsImages = platforms.some(platform => !videoPlatforms.has(platform as VideoPlatform));
    const requireAiImages = needsImages ? this.requireAiImages(job) : false;
    const maxImageAttempts = Math.max(Number(process.env.AUTOPOST_IMAGE_ATTEMPTS ?? 3), 1);

    let generated: GeneratedContent | null = null;
    let generationError: Error | null = null;
    for (let attempt = 0; attempt < maxImageAttempts; attempt += 1) {
      try {
        generated = await contentGenerationService.generateContent({ prompt: runPrompt, businessType, imageCount: 1 });
        generationError = null;
      } catch (error) {
        generationError = error as Error;
        console.error('[autopost] generation failed', error);
      }
      const fresh = this.selectFreshImages(generated?.images ?? [], recentSet);
      if (fresh.length && generated) {
        generated.images = fresh;
        break;
      }
      runPrompt = this.buildVisualPrompt(basePrompt);
    }
    if (!generated) {
      if (generationError) {
        console.warn('[autopost] using fallback content after generation failures');
      }
      generated = {
        images: [],
        caption_instagram: '',
        caption_linkedin: '',
        caption_x: '',
        hashtags_instagram: '',
        hashtags_generic: '',
      };
    }

    const credentials = await this.resolveCredentials(userId);
    const results: PostResult[] = [];
    const finalGenerated = generated;
    const imageUrls = needsImages ? this.resolveImageUrls(finalGenerated.images ?? [], recentSet, requireAiImages) : [];
    const genericVideoSelection = useGenericVideoFallback ? this.selectNextGenericVideo(job) : { videoUrl: undefined, nextCursor: undefined };
    const cursorUpdates: Partial<
      Pick<AutoPostJob, 'videoCursor' | 'youtubeVideoCursor' | 'tiktokVideoCursor' | 'reelsVideoCursor'>
    > = {};
    let usedGenericVideo = false;
    const fallbackCopy = this.buildFallbackCopy(job);
    const recentCaptions = this.getRecentCaptionHistory(job);
    const captionHistory = new Set(recentCaptions);
    const usedCaptions: string[] = [];
    const historyEntries: HistoryEntry[] = [];

    if (requireAiImages && imageUrls.length === 0) {
      const nextRunDate = new Date();
      nextRunDate.setHours(nextRunDate.getHours() + effectiveIntervalHours);
      const failed = platforms.map(platform => ({
        platform,
        status: 'failed' as const,
        error: 'ai_image_generation_failed',
      }));
      await autopostCollection.doc(userId).set(
        {
          lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
          lastResult: failed,
          nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
          active: job.active !== false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return {
        posted: 0,
        failed,
        nextRun: nextRunDate.toISOString(),
      };
    }

    for (const platform of platforms) {
      const publisher = platformPublishers[platform] ?? publishToTwitter;
      const rawCaption = this.captionForPlatform(platform, finalGenerated, fallbackCopy);
      const shortsCaption =
        platform === 'youtube' && enableYouTubeShorts ? this.ensureShortsCaption(rawCaption) : rawCaption;
      const { caption, signature } = this.ensureCaptionVariety(platform, shortsCaption, captionHistory);
      const isVideoPlatform = videoPlatforms.has(platform as VideoPlatform);
      let videoUrl: string | undefined;
      let videoTitle: string | undefined;
      const privacyStatus = platform === 'youtube' ? job.youtubePrivacyStatus : undefined;
      const tags = platform === 'youtube' && enableYouTubeShorts ? ['shorts'] : undefined;

      if (isVideoPlatform) {
        const platformSelection = this.selectNextVideo(job, platform as VideoPlatform);
        if (platformSelection.videoUrl) {
          videoUrl = platformSelection.videoUrl;
          if (platform === 'youtube' && typeof platformSelection.nextCursor === 'number') {
            cursorUpdates.youtubeVideoCursor = platformSelection.nextCursor;
          }
          if (platform === 'tiktok' && typeof platformSelection.nextCursor === 'number') {
            cursorUpdates.tiktokVideoCursor = platformSelection.nextCursor;
          }
          if (platform === 'instagram_reels' && typeof platformSelection.nextCursor === 'number') {
            cursorUpdates.reelsVideoCursor = platformSelection.nextCursor;
          }
        } else if (genericVideoSelection.videoUrl && useGenericVideoFallback && platform !== 'instagram_reels') {
          videoUrl = genericVideoSelection.videoUrl;
          usedGenericVideo = true;
        }
        videoTitle = platform === 'youtube' ? job.videoTitle?.trim() : undefined;
        if (platform === 'youtube' && enableYouTubeShorts && videoTitle) {
          videoTitle = this.ensureShortsTitle(videoTitle);
        }
      }

      if (isVideoPlatform && !videoUrl) {
        const errorMessage =
          platform === 'youtube'
            ? 'Missing YouTube video URL'
            : platform === 'tiktok'
              ? 'Missing TikTok video URL'
              : 'Missing Instagram Reels video URL';
        results.push({ platform, status: 'failed', error: errorMessage });
        historyEntries.push({ platform, status: 'failed', caption, errorMessage });
        continue;
      }

      try {
        const response = await publisher({
          caption,
          imageUrls: isVideoPlatform ? [] : imageUrls,
          videoUrl,
          videoTitle,
          privacyStatus,
          tags,
          credentials,
        });
        results.push({ platform, status: 'posted', remoteId: response?.remoteId ?? null });
        usedCaptions.push(signature);
        captionHistory.add(signature);
        historyEntries.push({
          platform,
          status: 'posted',
          caption,
          remoteId: response?.remoteId ?? null,
          videoUrl,
          videoTitle,
        });
      } catch (error) {
        const errorMessage = (error as Error).message ?? 'publish_failed';
        results.push({ platform, status: 'failed', error: errorMessage });
        historyEntries.push({ platform, status: 'failed', caption, errorMessage, videoUrl, videoTitle });
      }
    }

    const nextRunDate = new Date();
    nextRunDate.setHours(nextRunDate.getHours() + effectiveIntervalHours);
    const nextRecentImages = this.mergeRecentImages(recentImages, imageUrls);
    const nextRecentCaptions = this.mergeRecentCaptions(recentCaptions, usedCaptions);

    if (usedGenericVideo && typeof genericVideoSelection.nextCursor === 'number') {
      cursorUpdates.videoCursor = genericVideoSelection.nextCursor;
    }

    const updatePayload: Record<string, unknown> = {
      [lastRunField]: admin.firestore.FieldValue.serverTimestamp(),
      [resultField]: results,
      [nextRunField]: admin.firestore.Timestamp.fromDate(nextRunDate),
      active: job.active !== false,
      recentImageUrls: nextRecentImages,
      recentCaptions: nextRecentCaptions,
      ...cursorUpdates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!isReelsRun) {
      updatePayload.intervalHours = effectiveIntervalHours;
    }
    await autopostCollection.doc(userId).set(updatePayload, { merge: true });

    await this.recordHistory(userId, historyEntries, imageUrls);

    if (this.useMemory) {
      const nextRecord: AutoPostJob = {
        ...job,
        active: job.active !== false,
        recentImageUrls: nextRecentImages,
        recentCaptions: nextRecentCaptions,
        videoCursor:
          usedGenericVideo && typeof genericVideoSelection.nextCursor === 'number'
            ? genericVideoSelection.nextCursor
            : job.videoCursor,
        youtubeVideoCursor:
          typeof cursorUpdates.youtubeVideoCursor === 'number' ? cursorUpdates.youtubeVideoCursor : job.youtubeVideoCursor,
        tiktokVideoCursor:
          typeof cursorUpdates.tiktokVideoCursor === 'number' ? cursorUpdates.tiktokVideoCursor : job.tiktokVideoCursor,
        reelsVideoCursor:
          typeof cursorUpdates.reelsVideoCursor === 'number' ? cursorUpdates.reelsVideoCursor : job.reelsVideoCursor,
      };
      if (!isReelsRun) {
        nextRecord.intervalHours = effectiveIntervalHours;
      }
      if (nextRunField === 'nextRun') {
        nextRecord.lastRunAt = admin.firestore.Timestamp.now();
        nextRecord.nextRun = admin.firestore.Timestamp.fromDate(nextRunDate);
      } else {
        nextRecord.reelsLastRunAt = admin.firestore.Timestamp.now();
        nextRecord.reelsNextRun = admin.firestore.Timestamp.fromDate(nextRunDate);
      }
      this.memoryStore.set(userId, nextRecord);
    }

    return {
      posted: results.filter(result => result.status === 'posted').length,
      failed: results.filter(result => result.status === 'failed'),
      nextRun: nextRunDate.toISOString(),
    };
  }

  private async recordHistory(userId: string, entries: HistoryEntry[], imageUrls: string[]) {
    if (!entries.length) return;
    const targetDate = new Date().toISOString().slice(0, 10);
    const scheduledFor = admin.firestore.Timestamp.now();
    try {
      const batch = firestore.batch();
      entries.forEach(entry => {
        const ref = scheduledPostsCollection.doc();
        const isVideoPlatform = entry.platform === 'youtube' || entry.platform === 'tiktok' || entry.platform === 'instagram_reels';
        const payload: Record<string, unknown> = {
          userId,
          platform: entry.platform,
          caption: entry.caption,
          hashtags: '',
          imageUrls: isVideoPlatform ? [] : imageUrls,
          scheduledFor,
          targetDate,
          status: entry.status,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          postedAt: entry.status === 'posted' ? admin.firestore.FieldValue.serverTimestamp() : null,
          errorMessage: entry.errorMessage ?? null,
          remoteId: entry.remoteId ?? null,
          source: 'autopost',
        };
        if (entry.videoUrl) {
          payload.videoUrl = entry.videoUrl;
        }
        if (entry.videoTitle) {
          payload.videoTitle = entry.videoTitle;
        }
        batch.set(ref, payload);
      });
      await batch.commit();
      await Promise.all(
        entries.map(entry =>
          socialAnalyticsService.incrementDaily({
            userId,
            platform: entry.platform,
            status: entry.status,
          }),
        ),
      );
    } catch (error) {
      console.warn('[autopost] failed to record history', error);
    }
  }

  private async resolveCredentials(userId: string): Promise<SocialAccounts> {
    const defaults = this.defaultSocialAccounts();
    const userDoc = await firestore.collection('users').doc(userId).get();
    const userAccounts = (userDoc.data()?.socialAccounts as SocialAccounts | undefined) ?? {};
    const merged: SocialAccounts = { ...defaults, ...userAccounts };
    const youtubeIntegration = await getYouTubeIntegrationSecrets(userId);
    if (youtubeIntegration) {
      merged.youtube = {
        refreshToken: youtubeIntegration.refreshToken,
        accessToken: youtubeIntegration.accessToken,
        privacyStatus: youtubeIntegration.privacyStatus,
        channelId: youtubeIntegration.channelId ?? undefined,
      };
    }
    const tiktokIntegration = await getTikTokIntegrationSecrets(userId);
    if (tiktokIntegration) {
      merged.tiktok = {
        accessToken: tiktokIntegration.accessToken,
        refreshToken: tiktokIntegration.refreshToken,
        openId: tiktokIntegration.openId ?? undefined,
      };
    }
    return merged;
  }

  private defaultSocialAccounts(): SocialAccounts {
    const defaults: SocialAccounts = {};
    if (config.channels.facebook.pageId && config.channels.facebook.pageToken) {
      defaults.facebook = { accessToken: config.channels.facebook.pageToken, pageId: config.channels.facebook.pageId };
    }
    if (config.channels.instagram.businessId && config.channels.instagram.accessToken) {
      defaults.instagram = { accessToken: config.channels.instagram.accessToken, accountId: config.channels.instagram.businessId };
    }
    if (config.linkedin.accessToken && config.linkedin.organizationId) {
      defaults.linkedin = {
        accessToken: config.linkedin.accessToken,
        urn: `urn:li:organization:${config.linkedin.organizationId}`,
      };
    }
    if (config.tiktok.accessToken && config.tiktok.openId) {
      defaults.tiktok = {
        accessToken: config.tiktok.accessToken,
        openId: config.tiktok.openId,
        clientKey: config.tiktok.clientKey || undefined,
        clientSecret: config.tiktok.clientSecret || undefined,
      };
    }
    return defaults;
  }

  private captionForPlatform(
    platform: string,
    content: GeneratedContent,
    fallbackCopy: { caption: string; hashtags: string },
  ) {
    const captions: Record<string, string> = {
      instagram: content.caption_instagram,
      instagram_reels: content.caption_instagram,
      threads: content.caption_instagram,
      tiktok: content.caption_instagram,
      facebook: content.caption_linkedin,
      linkedin: content.caption_linkedin,
      twitter: content.caption_x,
      x: content.caption_x,
      youtube: content.caption_linkedin,
    };
    const chosen = (captions[platform] ?? content.caption_linkedin ?? content.caption_instagram ?? '').trim();
    const fallbackCaption = fallbackCopy.caption.trim();
    const caption = chosen.length ? chosen : fallbackCaption;
    const hasHashtags = /#[A-Za-z0-9_]+/.test(caption);
    const sourceHashtags =
      platform === 'instagram' || platform === 'instagram_reels' || platform === 'threads' || platform === 'tiktok'
        ? content.hashtags_instagram
        : content.hashtags_generic;
    const hashtags = hasHashtags ? '' : this.formatHashtags(sourceHashtags ?? fallbackCopy.hashtags);
    if (platform === 'twitter' || platform === 'x') {
      return [caption, hashtags].filter(Boolean).join(' ');
    }
    return [caption, hashtags].filter(Boolean).join('\n\n');
  }

  private buildFallbackCopy(job: AutoPostJob) {
    const caption = job.fallbackCaption?.trim() || this.defaultFallbackCaption;
    const hashtags = job.fallbackHashtags?.trim() || this.defaultFallbackHashtags;
    return { caption, hashtags };
  }

  private formatHashtags(raw?: string) {
    if (!raw) return '';
    const tokens = raw
      .split(/[,\\n]/g)
      .map(token => token.trim())
      .filter(Boolean)
      .flatMap(token => token.split(/\\s+/).filter(Boolean))
      .map(token => token.replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, ''))
      .filter(Boolean);
    if (!tokens.length) return '';
    const seen = new Set<string>();
    const unique = tokens.filter(token => {
      const key = token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.slice(0, 25).map(token => `#${token}`).join(' ');
  }

  private useYouTubeShorts(job: AutoPostJob) {
    if (typeof job.youtubeShorts === 'boolean') return job.youtubeShorts;
    const flag = process.env.AUTOPOST_YOUTUBE_SHORTS?.toLowerCase();
    if (!flag) return false;
    return flag !== 'false';
  }

  private ensureShortsCaption(caption: string) {
    const trimmed = caption.trim();
    if (!trimmed) return '#Shorts';
    if (/#shorts\b/i.test(trimmed)) return trimmed;
    return `${trimmed}\n\n#Shorts`;
  }

  private ensureShortsTitle(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return '#Shorts';
    if (/#shorts\b/i.test(trimmed)) return trimmed;
    return `${trimmed} #Shorts`;
  }

  private parseFallbackUrls(raw?: string) {
    if (!raw) return [];
    return raw
      .split(/[\r\n,]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  private getPublicBaseUrl() {
    const raw = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? '';
    return raw.trim().replace(/\/+$/, '');
  }

  private loadFallbackImagesFromDir(dir: string) {
    const baseUrl = this.getPublicBaseUrl();
    if (!baseUrl) {
      console.warn('[autopost] AUTOPOST_FALLBACK_DIR set but BASE_URL is missing; using other fallback sources.');
      return [];
    }
    try {
      const resolved = path.resolve(dir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const images = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => /\.(png|jpe?g|webp|gif)$/i.test(name));
      if (!images.length) {
        console.warn('[autopost] No fallback images found in AUTOPOST_FALLBACK_DIR; using other fallback sources.');
        return [];
      }
      return images.map(name => `${baseUrl}/public/fallback-images/${encodeURIComponent(name)}`);
    } catch (error) {
      console.warn('[autopost] Failed to load fallback images; using other fallback sources.', error);
      return [];
    }
  }

  private loadFallbackImagePool() {
    const dir = process.env.AUTOPOST_FALLBACK_DIR?.trim();
    const dirUrls = dir ? this.loadFallbackImagesFromDir(dir) : [];
    if (dirUrls.length) return dirUrls;

    const explicitUrls = this.parseFallbackUrls(process.env.AUTOPOST_FALLBACK_URLS);
    if (explicitUrls.length) return explicitUrls;

    const urlsFile = process.env.AUTOPOST_FALLBACK_URLS_FILE?.trim();
    if (urlsFile) {
      try {
        const resolved = path.resolve(urlsFile);
        const contents = fs.readFileSync(resolved, 'utf8');
        const fileUrls = this.parseFallbackUrls(contents);
        if (fileUrls.length) return fileUrls;
        console.warn('[autopost] No URLs found in AUTOPOST_FALLBACK_URLS_FILE; using default fallback images.');
      } catch (error) {
        console.warn('[autopost] Failed to load AUTOPOST_FALLBACK_URLS_FILE; using default fallback images.', error);
      }
    }

    return this.defaultFallbackImagePool;
  }

  private withCacheBuster(url: string) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${Date.now()}`;
  }

  private fallbackImageUrl() {
    // Ensure a fresh image URL each run to avoid caching
    return this.withCacheBuster(this.fallbackImageBase);
  }

  private getRecentImageHistory(job: AutoPostJob): string[] {
    if (!Array.isArray(job.recentImageUrls)) return [];
    return job.recentImageUrls.filter(Boolean);
  }

  private getRecentCaptionHistory(job: AutoPostJob): string[] {
    if (!Array.isArray(job.recentCaptions)) return [];
    return job.recentCaptions.filter(Boolean);
  }

  private selectFreshImages(images: string[], recent: Set<string>) {
    return images.filter(url => url && !recent.has(url));
  }

  private resolveImageUrls(images: string[], recent: Set<string>, requireAiImages: boolean) {
    const fresh = this.selectFreshImages(images, recent);
    if (fresh.length) return fresh;
    if (requireAiImages) return [];
    const fallback = this.pickFallbackImage(recent);
    return fallback ? [fallback] : images;
  }

  private mergeRecentImages(existing: string[], used: string[]) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_IMAGE_HISTORY ?? 12), 3);
    const next = [...used, ...existing].filter(Boolean);
    const seen = new Set<string>();
    const unique = next.filter(url => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    return unique.slice(0, maxHistory);
  }

  private mergeRecentCaptions(existing: string[], used: string[]) {
    const maxHistory = Math.max(Number(process.env.AUTOPOST_CAPTION_HISTORY ?? 12), 3);
    const next = [...used, ...existing].filter(Boolean);
    const seen = new Set<string>();
    const unique = next.filter(value => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
    return unique.slice(0, maxHistory);
  }

  private pickFallbackImage(recent: Set<string>) {
    const poolAll = this.getFallbackImagePool();
    const pool = poolAll.filter(url => !recent.has(url));
    const pickFrom = pool.length ? pool : poolAll;
    if (!pickFrom.length) return this.fallbackImageUrl();
    const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    return this.withCacheBuster(chosen);
  }

  private buildVisualPrompt(basePrompt: string) {
    const sceneContext = this.getSceneContext();
    const style = this.getVisualStyle(basePrompt);
    const scenes = [
      'strategy session in a high-rise executive suite',
      'client consultation in a private boardroom suite',
      'robot guiding a product demo in a premium sales suite',
      'team huddle around a glass table in a skyline suite',
      'customer success check-in in a luxury meeting suite',
      'robot assisting a marketer in a modern executive suite',
      'lead pipeline review in a glass-walled suite',
      'sales standup in a refined conference suite',
    ];
    const interactions = [
      'robot pointing at a funnel chart while people discuss',
      'robot handing a tablet to a team member',
      'robot and human shaking hands in agreement',
      'robot highlighting insights on a floating UI panel',
      'robot taking notes while the team presents',
      'robot collaborating on a shared screen',
      'robot guiding a live demo with subtle gestures',
      'robot and team reviewing KPIs together',
    ];
    const settings = [
      'executive suite with city skyline windows',
      'luxury boardroom with soft daylight',
      'premium client suite with warm neutral tones',
      'glass-walled executive lounge with refined decor',
      'high-end conference suite with minimal accents',
      'private strategy suite with modern finishes',
      'suite-style meeting space with soft seating',
    ];
    const compositions = [
      'wide establishing shot',
      'eye-level candid shot',
      'over-the-shoulder view toward the screen',
      'three-quarter angle with depth of field',
      'medium shot focused on faces and gestures',
      'close-up on the robot and one collaborator',
    ];
    const lighting = [
      'morning sunlight with soft shadows',
      'golden hour glow',
      'diffused daylight, clean and natural',
      'soft studio lighting with gentle highlights',
      'cool daylight balanced with warm accents',
    ];
    const palettes = [
      'warm neutrals with teal accents',
      'soft gray with amber highlights',
      'clean white with cobalt blue accents',
      'muted charcoal with mint highlights',
      'light sand tones with subtle navy',
    ];
    const details = [
      'subtle holographic UI overlays',
      'minimalistic charts on screens',
      'clean glass surfaces with reflections',
      'calm, confident expressions',
      'tidy workspace with notebooks and coffee',
      'modern devices and a sleek tablet',
      'robot dressed with a tie and glasses',
    ];
    const neonLighting = [
      'neon glow with high-contrast shadows',
      'magenta and cyan rim lighting',
      'futuristic neon ambience with light haze',
      'vivid neon highlights with soft bloom',
    ];
    const neonPalettes = [
      'magenta and cyan neon with deep charcoal',
      'electric blue and pink neon accents',
      'neon teal and violet against dark glass',
      'high-contrast neon gradients with glossy blacks',
    ];
    const neonDetails = [
      'glowing holographic UI overlays',
      'neon edge lighting on glass surfaces',
      'reflective floors with neon streaks',
      'futuristic neon signage accents',
      'robot dressed with a tie and glasses',
    ];
    const subtleNeonLighting = [
      'soft ambient glow with minimal neon highlights',
      'gentle neon rim lighting with balanced shadows',
      'subtle neon accents with clean studio lighting',
      'light haze with restrained neon bloom',
    ];
    const subtleNeonPalettes = [
      'neutral tones with faint cyan accents',
      'soft charcoal with muted neon teal',
      'warm neutrals with minimal magenta glow',
      'clean white with subtle neon edge lighting',
    ];
    const subtleNeonDetails = [
      'light holographic UI overlays',
      'subtle neon accents on glass edges',
      'soft reflections with minimal neon streaks',
      'restrained neon signage accents',
      'robot dressed with a tie and glasses',
    ];
    const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];
    const pickLighting =
      style === 'neon'
        ? pick(neonLighting)
        : style === 'neon-subtle'
          ? pick(subtleNeonLighting)
          : pick(lighting);
    const pickPalette =
      style === 'neon'
        ? pick(neonPalettes)
        : style === 'neon-subtle'
          ? pick(subtleNeonPalettes)
          : pick(palettes);
    const pickDetail =
      style === 'neon'
        ? pick(neonDetails)
        : style === 'neon-subtle'
          ? pick(subtleNeonDetails)
          : pick(details);
    const ref = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    return `${basePrompt} Context: ${sceneContext}. Scene: ${pick(scenes)}. Interaction: ${pick(interactions)}. Setting: ${pick(settings)}. Composition: ${pick(
      compositions,
    )}. Lighting: ${pickLighting}. Palette: ${pickPalette}. Details: ${pickDetail}. Ref ${ref}.`;
  }

  private getSceneContext() {
    const raw = process.env.AUTOPOST_SCENE_CONTEXT?.trim();
    return raw && raw.length > 0 ? raw : 'executive suite';
  }

  private applyNeonPreference(basePrompt: string) {
    const forceNeon = (process.env.AUTOPOST_FORCE_NEON ?? 'true').toLowerCase() !== 'false';
    if (!forceNeon) return basePrompt;
    const lower = basePrompt.toLowerCase();
    if (lower.includes('neon') || lower.includes('cyberpunk')) {
      return basePrompt;
    }
    return `${basePrompt} Neon lighting with magenta and cyan accents, futuristic glow, glossy reflections.`;
  }

  private getVisualStyle(basePrompt: string) {
    const lower = basePrompt.toLowerCase();
    if (lower.includes('subtle neon') || lower.includes('minimal neon') || lower.includes('soft neon')) {
      return 'neon-subtle';
    }
    return lower.includes('neon') || lower.includes('cyberpunk') ? 'neon' : 'default';
  }

  private requireAiImages(job: AutoPostJob) {
    if (typeof job.requireAiImages === 'boolean') return job.requireAiImages;
    const flag = process.env.AUTOPOST_REQUIRE_AI_IMAGES?.toLowerCase();
    if (flag === 'false') return false;
    return true;
  }

  private ensureCaptionVariety(platform: string, caption: string, history: Set<string>) {
    const signature = this.buildCaptionSignature(platform, caption);
    if (!history.has(signature)) {
      return { caption, signature };
    }
    for (const variant of this.fallbackCaptionVariants) {
      const candidate = this.appendCaptionSuffix(caption, variant, platform);
      const candidateSignature = this.buildCaptionSignature(platform, candidate);
      if (!history.has(candidateSignature)) {
        return { caption: candidate, signature: candidateSignature };
      }
    }
    return { caption, signature };
  }

  private appendCaptionSuffix(caption: string, suffix: string, platform: string) {
    const joiner = platform === 'twitter' || platform === 'x' ? ' ' : '\n\n';
    const hashtagMatch = caption.match(/\s(#[A-Za-z0-9_]+)/);
    if (!hashtagMatch || hashtagMatch.index === undefined) {
      return `${caption}${joiner}${suffix}`.trim();
    }
    const idx = hashtagMatch.index;
    if (idx <= 0) {
      return `${caption}${joiner}${suffix}`.trim();
    }
    const head = caption.slice(0, idx).trim();
    const tail = caption.slice(idx).trim();
    return [head, suffix, tail].filter(Boolean).join(joiner).trim();
  }

  private buildCaptionSignature(platform: string, caption: string) {
    const normalized = caption.toLowerCase().replace(/\s+/g, ' ').trim();
    return `${platform}:${normalized}`;
  }

  private selectNextVideo(job: AutoPostJob, platform: VideoPlatform) {
    const list =
      platform === 'youtube'
        ? (job.youtubeVideoUrls ?? []).map(url => url.trim()).filter(Boolean)
        : platform === 'tiktok'
          ? (job.tiktokVideoUrls ?? []).map(url => url.trim()).filter(Boolean)
          : (job.reelsVideoUrls ?? []).map(url => url.trim()).filter(Boolean);
    const single =
      platform === 'youtube'
        ? job.youtubeVideoUrl?.trim()
        : platform === 'tiktok'
          ? job.tiktokVideoUrl?.trim()
          : job.reelsVideoUrl?.trim();
    const cursor =
      platform === 'youtube'
        ? Number.isFinite(job.youtubeVideoCursor)
          ? (job.youtubeVideoCursor as number)
          : 0
        : platform === 'tiktok'
          ? Number.isFinite(job.tiktokVideoCursor)
            ? (job.tiktokVideoCursor as number)
            : 0
          : Number.isFinite(job.reelsVideoCursor)
            ? (job.reelsVideoCursor as number)
            : 0;
    if (!list.length) {
      return { videoUrl: single, nextCursor: undefined };
    }
    const index = ((cursor % list.length) + list.length) % list.length;
    const nextCursor = (index + 1) % list.length;
    return { videoUrl: list[index], nextCursor };
  }

  private selectNextGenericVideo(job: AutoPostJob) {
    const list = (job.videoUrls ?? []).map(url => url.trim()).filter(Boolean);
    if (!list.length) {
      const single = job.videoUrl?.trim();
      return { videoUrl: single, nextCursor: undefined };
    }
    const cursor = Number.isFinite(job.videoCursor) ? (job.videoCursor as number) : 0;
    const index = ((cursor % list.length) + list.length) % list.length;
    const nextCursor = (index + 1) % list.length;
    return { videoUrl: list[index], nextCursor };
  }
}

export const autoPostService = new AutoPostService();

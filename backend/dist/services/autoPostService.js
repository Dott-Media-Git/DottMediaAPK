import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { firestore } from '../db/firestore.js';
import { config } from '../config.js';
import { contentGenerationService } from '../packages/services/contentGenerationService.js';
import { socialAnalyticsService } from '../packages/services/socialAnalyticsService.js';
import { publishToInstagram, publishToInstagramReel, publishToInstagramStory } from '../packages/services/socialPlatforms/instagramPublisher.js';
import { publishToFacebook, publishToFacebookStory } from '../packages/services/socialPlatforms/facebookPublisher.js';
import { publishToLinkedIn } from '../packages/services/socialPlatforms/linkedinPublisher.js';
import { publishToTwitter } from '../packages/services/socialPlatforms/twitterPublisher.js';
import { publishToYouTube } from '../packages/services/socialPlatforms/youtubePublisher.js';
import { publishToTikTok } from '../packages/services/socialPlatforms/tiktokPublisher.js';
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from './socialIntegrationService.js';
import { canUsePrimarySocialDefaults } from '../utils/socialAccess.js';
import { getNewsTrendingCandidates } from './newsTrendSources.js';
import { getUserTrendConfig } from './userTrendSourceService.js';
import { getTrendingCandidates as getFootballTrendingCandidates } from './footballTrendSources.js';
import { footballTrendContentService } from './footballTrendContentService.js';
import { resolveBrandIdForClient } from './brandKitService.js';
const autopostCollection = firestore.collection('autopostJobs');
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const platformPublishers = {
    instagram: publishToInstagram,
    instagram_reels: publishToInstagramReel,
    instagram_story: publishToInstagramStory,
    threads: publishToInstagram,
    tiktok: publishToTikTok,
    facebook: publishToFacebook,
    facebook_story: publishToFacebookStory,
    linkedin: publishToLinkedIn,
    twitter: publishToTwitter,
    youtube: publishToYouTube,
    x: publishToTwitter,
};
export class AutoPostService {
    constructor() {
        this.memoryStore = new Map();
        this.useMemory = config.security.allowMockAuth;
        // Post every 4 hours by default; override with AUTOPOST_INTERVAL_MINUTES for tighter testing windows.
        this.defaultIntervalHours = Math.max(Number(process.env.AUTOPOST_INTERVAL_MINUTES ?? 240) / 60, 0.05);
        // Reels auto-post every 4 hours by default; override with AUTOPOST_REELS_INTERVAL_MINUTES if needed.
        this.defaultReelsIntervalHours = Math.max(Number(process.env.AUTOPOST_REELS_INTERVAL_MINUTES ?? 240) / 60, 0.25);
        this.defaultStoryIntervalHours = Math.max(Number(process.env.AUTOPOST_STORY_INTERVAL_MINUTES ?? 120) / 60, 0.25);
        this.fallbackImageBase = 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80';
        this.defaultFallbackImagePool = [
            'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1485217988980-11786ced9454?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80',
        ];
        this.defaultFallbackCaption = "Meet Dott Media's AI Sales Bot - your always-on growth partner for CRM, social media, lead gen, and outreach automation. \u{1F680} Want a quick demo? DM us and let's build your pipeline. \u{1F916}\u2728";
        this.defaultFallbackHashtags = 'DottMedia, AISalesBot, SalesAutomation, LeadGeneration, BusinessGrowth, CRM, MarketingAutomation, SalesPipeline, CustomerSuccess, AI, Automation, SmallBusiness, DigitalMarketing, B2B, Productivity, AIAutomation, AIForBusiness, AIAnalytics, AIMarketing, AIStrategy, AICRM, AIProductivity, AITools, MachineLearning, GenerativeAI';
        this.fallbackCaptionVariants = [
            'DM us for a quick demo.',
            'Book a 15-minute walkthrough.',
            'Want the demo link? Send a message.',
            "Ready to grow? Let's talk.",
            'Ask for a quick demo today.',
        ];
    }
    getFallbackImagePool() {
        return this.loadFallbackImagePool();
    }
    getFallbackVideoPool() {
        return this.loadFallbackVideoPool();
    }
    async start(payload) {
        const basePlatforms = payload.platforms?.length
            ? payload.platforms
            : ['instagram', 'instagram_story', 'facebook', 'facebook_story', 'linkedin'];
        const withStories = new Set(basePlatforms);
        if (withStories.has('instagram') && !withStories.has('instagram_story')) {
            withStories.add('instagram_story');
        }
        if (withStories.has('facebook') && !withStories.has('facebook_story')) {
            withStories.add('facebook_story');
        }
        const platforms = Array.from(withStories).filter(platform => platform !== 'instagram_reels');
        const now = new Date();
        const reelsEnabled = Boolean(payload.instagramReelsVideoUrl ||
            (payload.instagramReelsVideoUrls && payload.instagramReelsVideoUrls.length) ||
            payload.platforms?.includes('instagram_reels'));
        const reelsVideoUrl = reelsEnabled ? (payload.instagramReelsVideoUrl ?? payload.videoUrl) : undefined;
        const reelsVideoUrls = reelsEnabled
            ? payload.instagramReelsVideoUrls?.length
                ? payload.instagramReelsVideoUrls
                : payload.videoUrls
            : undefined;
        const reelsIntervalHours = payload.reelsIntervalHours && payload.reelsIntervalHours > 0
            ? payload.reelsIntervalHours
            : this.defaultReelsIntervalHours;
        await autopostCollection.doc(payload.userId).set({
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
        }, { merge: true });
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
                reelsVideoCursor: reelsVideoUrls && reelsVideoUrls.length ? 0 : undefined,
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
            const dueStandard = Array.from(this.memoryStore.entries()).filter(([, job]) => job.active !== false && job.nextRun && job.nextRun.toMillis() <= now.toMillis());
            const dueReels = Array.from(this.memoryStore.entries()).filter(([, job]) => job.active !== false && job.reelsNextRun && job.reelsNextRun.toMillis() <= now.toMillis());
            const dueStories = Array.from(this.memoryStore.entries()).filter(([, job]) => job.active !== false &&
                job.storyTrendEnabled === true &&
                job.storyNextRun &&
                job.storyNextRun.toMillis() <= now.toMillis());
            const dueTrends = Array.from(this.memoryStore.entries()).filter(([, job]) => job.active !== false &&
                job.trendEnabled === true &&
                job.trendNextRun &&
                job.trendNextRun.toMillis() <= now.toMillis());
            let processed = 0;
            const results = new Map();
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
            for (const [userId, job] of dueStories) {
                const outcome = await this.executeTrendStories(userId, job);
                processed += 1;
                const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
                results.set(userId, {
                    ...existing,
                    storyPosted: outcome.posted,
                    storyFailed: outcome.failed.length,
                    storyNextRun: outcome.nextRun,
                });
            }
            for (const [userId, job] of dueTrends) {
                const outcome = await this.executeTrendPosts(userId, job);
                processed += 1;
                const existing = results.get(userId) ?? { userId, posted: 0, failed: 0, nextRun: null };
                results.set(userId, {
                    ...existing,
                    trendPosted: outcome.posted,
                    trendFailed: outcome.failed.length,
                    trendNextRun: outcome.nextRun,
                });
            }
            return { processed, results: Array.from(results.values()) };
        }
        // Query only by nextRun to avoid composite index requirement, then filter active in memory.
        const [standardSnap, reelsSnap, storiesSnap, trendSnap, missingReelsSnap, missingStoriesSnap] = await Promise.all([
            autopostCollection.where('nextRun', '<=', now).get(),
            autopostCollection.where('reelsNextRun', '<=', now).get(),
            autopostCollection.where('storyNextRun', '<=', now).get(),
            autopostCollection.where('trendNextRun', '<=', now).get(),
            autopostCollection.where('reelsNextRun', '==', null).get(),
            autopostCollection.where('storyNextRun', '==', null).get(),
        ]);
        if (!missingReelsSnap.empty) {
            const selfHealWrites = missingReelsSnap.docs.map(doc => {
                const data = doc.data();
                if (data.active === false)
                    return null;
                const hasReelsConfig = Boolean(data.reelsVideoUrl ||
                    (data.reelsVideoUrls && data.reelsVideoUrls.length) ||
                    data.reelsIntervalHours ||
                    data.reelsLastRunAt ||
                    data.reelsLastResult);
                if (!hasReelsConfig)
                    return null;
                const reelsIntervalHours = data.reelsIntervalHours ?? this.defaultReelsIntervalHours;
                return autopostCollection.doc(doc.id).set({
                    reelsIntervalHours,
                    reelsNextRun: now,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }).filter(Boolean);
            if (selfHealWrites.length) {
                await Promise.all(selfHealWrites);
            }
        }
        if (!missingStoriesSnap.empty) {
            const selfHealWrites = missingStoriesSnap.docs
                .map(doc => {
                const data = doc.data();
                if (data.active === false || data.storyTrendEnabled !== true)
                    return null;
                const intervalHours = data.storyIntervalHours ?? this.defaultStoryIntervalHours;
                return autopostCollection.doc(doc.id).set({
                    storyIntervalHours: intervalHours,
                    storyNextRun: now,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            })
                .filter(Boolean);
            if (selfHealWrites.length) {
                await Promise.all(selfHealWrites);
            }
        }
        if (standardSnap.empty && reelsSnap.empty && storiesSnap.empty && trendSnap.empty)
            return { processed: 0 };
        let processed = 0;
        const results = new Map();
        for (const doc of standardSnap.docs) {
            const data = doc.data();
            if (data.active === false)
                continue;
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
            const data = doc.data();
            if (data.active === false)
                continue;
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
        for (const doc of storiesSnap.docs) {
            const data = doc.data();
            if (data.active === false || data.storyTrendEnabled !== true)
                continue;
            const outcome = await this.executeTrendStories(doc.id, data);
            processed += 1;
            const existing = results.get(doc.id) ?? { userId: doc.id, posted: 0, failed: 0, nextRun: null };
            results.set(doc.id, {
                ...existing,
                storyPosted: outcome.posted,
                storyFailed: outcome.failed.length,
                storyNextRun: outcome.nextRun,
            });
        }
        for (const doc of trendSnap.docs) {
            const data = doc.data();
            if (data.active === false || data.trendEnabled !== true)
                continue;
            const outcome = await this.executeTrendPosts(doc.id, data);
            processed += 1;
            const existing = results.get(doc.id) ?? { userId: doc.id, posted: 0, failed: 0, nextRun: null };
            results.set(doc.id, {
                ...existing,
                trendPosted: outcome.posted,
                trendFailed: outcome.failed.length,
                trendNextRun: outcome.nextRun,
            });
        }
        return { processed, results: Array.from(results.values()) };
    }
    async runForUser(userId) {
        if (this.useMemory && this.memoryStore.has(userId)) {
            const job = this.memoryStore.get(userId);
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
            if (job.storyTrendEnabled && job.storyNextRun) {
                const stories = await this.executeTrendStories(userId, job);
                return {
                    ...standard,
                    storyPosted: stories.posted,
                    storyFailed: stories.failed,
                    storyNextRun: stories.nextRun,
                };
            }
            return standard;
        }
        const snap = await autopostCollection.doc(userId).get();
        if (!snap.exists) {
            return { posted: 0, failed: [{ platform: 'all', error: 'autopost_not_configured', status: 'failed' }], nextRun: null };
        }
        const job = snap.data();
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
        if (job.storyTrendEnabled && job.storyNextRun) {
            const stories = await this.executeTrendStories(userId, job);
            return {
                ...standard,
                storyPosted: stories.posted,
                storyFailed: stories.failed,
                storyNextRun: stories.nextRun,
            };
        }
        return standard;
    }
    getStoryPlatforms(job) {
        if (Array.isArray(job.storyPlatforms) && job.storyPlatforms.length) {
            return job.storyPlatforms;
        }
        const fromJob = (job.platforms ?? []).filter(platform => platform.endsWith('_story'));
        if (fromJob.length)
            return fromJob;
        return ['instagram_story', 'facebook_story'];
    }
    getTrendPlatforms(job) {
        if (Array.isArray(job.trendPlatforms) && job.trendPlatforms.length) {
            return job.trendPlatforms;
        }
        // Default to Facebook feed for trend posting when enabled.
        return ['facebook'];
    }
    getRecentStoryImageHistory(job) {
        if (!Array.isArray(job.storyRecentImageUrls))
            return [];
        return job.storyRecentImageUrls.filter(Boolean);
    }
    summarizeStory(text, maxChars = 180) {
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (!cleaned)
            return '';
        if (cleaned.length <= maxChars)
            return cleaned;
        const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
        let summary = '';
        for (const sentence of sentences) {
            const candidate = summary ? `${summary} ${sentence}` : sentence;
            if (candidate.length > maxChars)
                break;
            summary = candidate;
            if (summary.length >= maxChars * 0.75)
                break;
        }
        if (!summary) {
            const truncated = cleaned.slice(0, maxChars);
            const lastSpace = truncated.lastIndexOf(' ');
            summary = lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
        }
        const trimmed = summary.trim();
        if (!/[.!?]$/.test(trimmed))
            return `${trimmed}.`;
        return trimmed;
    }
    isMainAccountEmail(email) {
        const normalized = email?.toLowerCase().trim();
        if (!normalized)
            return false;
        return normalized === 'brasioxirin@gmail.com' || normalized === 'brasioxiri@gmail.com';
    }
    async executeTrendStories(userId, job) {
        const intervalHours = job.storyIntervalHours && job.storyIntervalHours > 0 ? job.storyIntervalHours : this.defaultStoryIntervalHours;
        const nextRunDate = new Date();
        nextRunDate.setHours(nextRunDate.getHours() + intervalHours);
        const platforms = this.getStoryPlatforms(job);
        if (!platforms.length) {
            return { posted: 0, failed: [{ platform: 'stories', error: 'no_story_platforms', status: 'failed' }], nextRun: nextRunDate.toISOString() };
        }
        const recentImages = this.getRecentStoryImageHistory(job);
        const recentSet = new Set(recentImages);
        const { sources, mode } = await getUserTrendConfig(userId);
        const candidates = await getNewsTrendingCandidates({
            sources,
            sourceMode: mode,
            maxCandidates: job.storyMaxCandidates ?? 6,
            maxAgeHours: job.storyMaxAgeHours ?? 48,
        });
        const top = candidates[0];
        const topic = top?.topic?.trim() || 'Latest AI updates';
        const topItem = top?.items?.[0];
        const summaryRaw = topItem?.summary || top?.sampleTitles?.[0] || '';
        const summary = this.summarizeStory(summaryRaw, 180);
        const sourceLabel = top?.sources?.[0] || topItem?.sourceLabel || 'AI news';
        const userDoc = await firestore.collection('users').doc(userId).get();
        const userData = userDoc.data();
        const normalizedEmail = userData?.email?.toLowerCase().trim() ?? '';
        const useRelatedNewsImage = this.isMainAccountEmail(normalizedEmail);
        const baseUrl = this.getPublicBaseUrl();
        let finalImages = [];
        if (useRelatedNewsImage) {
            const prompt = `Create a clean, modern social media image that clearly reflects this AI news topic: "${topic}". Context: "${summary || top?.sampleTitles?.[0] || 'Latest AI news update'}". Show relevant AI visuals, newsroom-style energy, and readable composition for a story post. Avoid logos and real brand marks.`;
            let generated = null;
            try {
                generated = await contentGenerationService.generateContent({ prompt, businessType: 'AI news update', imageCount: 1 });
            }
            catch (error) {
                console.warn('[autopost] trend story generation failed', error);
            }
            const imageUrls = this.resolveImageUrls(generated?.images ?? [], recentSet, false);
            finalImages = imageUrls.length ? imageUrls : [this.pickFallbackImage(recentSet)];
        }
        else if (baseUrl) {
            const draftRef = firestore.collection('storyImageDrafts').doc();
            await draftRef.set({
                headline: topic,
                summary,
                source: sourceLabel,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            finalImages = [`${baseUrl}/public/story-image/${draftRef.id}.png`];
        }
        else {
            const prompt = `Create a clean, modern social media story image representing this AI news headline: "${topic}". Use futuristic tech visuals, abstract AI motifs, and leave space for a short headline. Avoid logos and real brand marks.`;
            let generated = null;
            try {
                generated = await contentGenerationService.generateContent({ prompt, businessType: 'AI news update', imageCount: 1 });
            }
            catch (error) {
                console.warn('[autopost] trend story generation failed', error);
            }
            const imageUrls = this.resolveImageUrls(generated?.images ?? [], recentSet, false);
            finalImages = imageUrls.length ? imageUrls : [this.pickFallbackImage(recentSet)];
        }
        const credentials = await this.resolveCredentials(userId);
        const results = [];
        const historyEntries = [];
        for (const platform of platforms) {
            const publisher = platformPublishers[platform];
            if (!publisher) {
                results.push({ platform, status: 'failed', error: 'unsupported_platform' });
                historyEntries.push({ platform, status: 'failed', caption: topic, errorMessage: 'unsupported_platform' });
                continue;
            }
            try {
                const response = await publisher({ caption: topic, imageUrls: finalImages, credentials });
                results.push({ platform, status: 'posted', remoteId: response.remoteId ?? null });
                historyEntries.push({ platform, status: 'posted', caption: topic, remoteId: response.remoteId ?? null });
            }
            catch (error) {
                const message = error?.message ?? 'publish_failed';
                results.push({ platform, status: 'failed', error: message });
                historyEntries.push({ platform, status: 'failed', caption: topic, errorMessage: message });
            }
        }
        const nextRecord = {
            storyLastRunAt: admin.firestore.Timestamp.now(),
            storyNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
            storyLastResult: results,
            storyRecentImageUrls: this.mergeRecentImages(recentImages, finalImages),
        };
        await autopostCollection.doc(userId).set({
            ...nextRecord,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (this.useMemory) {
            const current = this.memoryStore.get(userId);
            if (current) {
                this.memoryStore.set(userId, { ...current, ...nextRecord });
            }
        }
        await this.recordHistory(userId, historyEntries, finalImages);
        return {
            posted: results.filter(result => result.status === 'posted').length,
            failed: results.filter(result => result.status === 'failed'),
            nextRun: nextRunDate.toISOString(),
        };
    }
    async executeTrendPosts(userId, job) {
        const intervalHours = job.trendIntervalHours && job.trendIntervalHours > 0 ? job.trendIntervalHours : 4;
        const nextRunDate = new Date();
        nextRunDate.setHours(nextRunDate.getHours() + intervalHours);
        const platforms = this.getTrendPlatforms(job);
        if (!platforms.length) {
            return {
                posted: 0,
                failed: [{ platform: 'trend', error: 'no_trend_platforms', status: 'failed' }],
                nextRun: nextRunDate.toISOString(),
            };
        }
        const credentials = await this.resolveCredentials(userId);
        const results = [];
        const historyEntries = [];
        const userDoc = await firestore.collection('users').doc(userId).get();
        const userData = userDoc.data();
        const email = userData?.email ?? null;
        const normalizedEmail = email?.toLowerCase().trim() ?? '';
        const brandId = normalizedEmail ? resolveBrandIdForClient(normalizedEmail) : null;
        const scope = brandId === 'bwinbetug' ? 'football' : 'global';
        // Currently optimized for football trend posting (bwinbetug). Other scopes fall back to a lightweight text post.
        let caption = '';
        let imageUrls = [];
        const trendCaptions = {};
        if (scope === 'football') {
            try {
                const { sources } = await getUserTrendConfig(userId);
                const candidates = await getFootballTrendingCandidates({
                    sources,
                    maxCandidates: job.trendMaxCandidates ?? 6,
                    maxAgeHours: job.trendMaxAgeHours ?? 48,
                });
                const top = candidates[0];
                if (!top) {
                    caption = 'No football trends found right now. Checking again soon.';
                }
                else {
                    const items = (top.items ?? []).slice(0, 6);
                    const contextLines = [
                        `topic: ${top.topic}`,
                        top.sources?.length ? `sources: ${top.sources.join(', ')}` : '',
                        top.publishedAt ? `published_at: ${top.publishedAt}` : '',
                        '',
                        ...items.map(item => {
                            const summary = item.summary ? ` | ${item.summary}` : '';
                            const when = item.publishedAt ? ` (${item.publishedAt})` : '';
                            return `- ${item.sourceLabel}: ${item.title}${when}${summary}`;
                        }),
                    ].filter(Boolean);
                    const context = contextLines.join('\n').trim();
                    const gen = await footballTrendContentService.generate({
                        topic: top.topic,
                        context: context.length >= 10 ? context : `topic: ${top.topic}`,
                        trendSignals: [
                            ...(top.sources?.slice(0, 3) ?? []),
                            ...(top.sampleTitles?.slice(0, 3) ?? []),
                        ],
                        ...(normalizedEmail ? { clientId: normalizedEmail } : {}),
                        channels: platforms.map(platform => platform.replace(/_story$/, '')),
                        region: job.trendRegion ?? 'Uganda',
                        language: job.trendLanguage ?? 'English',
                        rightsInfo: 'Use official/public news context only. Do not claim ownership of match footage. Avoid copyrighted clips unless licensed.',
                        includePosterImage: true,
                        imageCount: 1,
                    });
                    const tags = (gen.content.hashtags ?? [])
                        .map(tag => tag.trim())
                        .filter(Boolean)
                        .map(tag => (tag.startsWith('#') ? tag : `#${tag.replace(/^#+/, '')}`))
                        .join(' ');
                    const baseCaptionByPlatform = (platform) => {
                        if (platform === 'twitter' || platform === 'x')
                            return gen.content.captions.viral_caption;
                        if (platform === 'linkedin')
                            return gen.content.captions.instagram;
                        return gen.content.captions.instagram;
                    };
                    // Default caption for history and for platforms that don't override further down.
                    caption = [gen.content.captions.instagram, tags].filter(Boolean).join('\n\n').trim();
                    imageUrls = gen.images ?? [];
                    for (const p of platforms) {
                        const base = baseCaptionByPlatform(p);
                        const combined = [base, tags]
                            .filter(Boolean)
                            .join(p === 'twitter' || p === 'x' ? ' ' : '\n\n')
                            .trim();
                        if (combined)
                            trendCaptions[p] = combined;
                    }
                }
            }
            catch (error) {
                console.warn('[autopost] trend generation failed; using text fallback', error);
                caption = 'Trending football update coming soon. Stay tuned.';
                imageUrls = [];
            }
        }
        else {
            caption = 'Trending update coming soon.';
            imageUrls = [];
        }
        for (const platform of platforms) {
            const publisher = platformPublishers[platform];
            if (!publisher) {
                results.push({ platform, status: 'failed', error: 'unsupported_platform' });
                historyEntries.push({ platform, status: 'failed', caption, errorMessage: 'unsupported_platform' });
                continue;
            }
            if ((platform === 'facebook_story' || platform === 'instagram_story') && imageUrls.length === 0) {
                results.push({ platform, status: 'failed', error: 'missing_image_for_story' });
                historyEntries.push({ platform, status: 'failed', caption, errorMessage: 'missing_image_for_story' });
                continue;
            }
            try {
                const perPlatformCaption = trendCaptions[platform] || caption;
                const response = await publisher({ caption: perPlatformCaption, imageUrls, credentials });
                results.push({ platform, status: 'posted', remoteId: response.remoteId ?? null });
                historyEntries.push({ platform, status: 'posted', caption: perPlatformCaption, remoteId: response.remoteId ?? null });
            }
            catch (error) {
                const message = error?.message ?? 'publish_failed';
                results.push({ platform, status: 'failed', error: message });
                historyEntries.push({ platform, status: 'failed', caption, errorMessage: message });
            }
        }
        const nextRecord = {
            trendLastRunAt: admin.firestore.Timestamp.now(),
            trendNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
            trendLastResult: results,
        };
        await autopostCollection.doc(userId).set({
            ...nextRecord,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (this.useMemory) {
            const current = this.memoryStore.get(userId);
            if (current) {
                this.memoryStore.set(userId, { ...current, ...nextRecord });
            }
        }
        await this.recordHistory(userId, historyEntries, imageUrls);
        return {
            posted: results.filter(result => result.status === 'posted').length,
            failed: results.filter(result => result.status === 'failed'),
            nextRun: nextRunDate.toISOString(),
        };
    }
    async executeJob(userId, job, options = {}) {
        const intervalHours = options.intervalHours ??
            (job.intervalHours && job.intervalHours > 0 ? job.intervalHours : this.defaultIntervalHours);
        const isReelsRun = (options.nextRunField ?? 'nextRun') === 'reelsNextRun';
        const effectiveIntervalHours = isReelsRun ? intervalHours : Math.max(intervalHours, this.defaultIntervalHours);
        const platforms = options.platforms ?? job.platforms ?? [];
        const nextRunField = options.nextRunField ?? 'nextRun';
        const lastRunField = options.lastRunField ?? 'lastRunAt';
        const resultField = options.resultField ?? 'lastResult';
        const useGenericVideoFallback = options.useGenericVideoFallback !== false;
        const videoPlatforms = new Set(['youtube', 'tiktok', 'instagram_reels']);
        const optionalVideoPlatforms = new Set(['facebook', 'facebook_story', 'instagram_story', 'linkedin']);
        const enableYouTubeShorts = this.useYouTubeShorts(job);
        const basePrompt = job.prompt ??
            'Create a realistic, photo-style scene of the Dott Media AI Sales Bot interacting with people in an executive suite; friendly humanoid robot wearing a tie and glasses, assisting a diverse team, natural expressions, premium interior finishes, cinematic depth, subtle futuristic UI overlays, clean space reserved for a headline.';
        const styledPrompt = this.applyNeonPreference(basePrompt);
        let runPrompt = this.buildVisualPrompt(styledPrompt);
        const businessType = job.businessType ?? 'AI CRM + automation agency';
        const recentImages = this.getRecentImageHistory(job);
        const recentSet = new Set(recentImages);
        const fallbackVideoPool = this.getFallbackVideoPool();
        const genericVideoSelection = useGenericVideoFallback
            ? this.selectNextGenericVideo(job, fallbackVideoPool)
            : { videoUrl: undefined, nextCursor: undefined };
        const hasGenericVideo = Boolean(genericVideoSelection.videoUrl);
        const needsImages = platforms.some(platform => {
            if (videoPlatforms.has(platform))
                return false;
            if (optionalVideoPlatforms.has(platform) && hasGenericVideo)
                return false;
            return true;
        });
        const requireAiImages = needsImages ? this.requireAiImages(job) : false;
        const maxImageAttempts = Math.max(Number(process.env.AUTOPOST_IMAGE_ATTEMPTS ?? 3), 1);
        let generated = null;
        let generationError = null;
        for (let attempt = 0; attempt < maxImageAttempts; attempt += 1) {
            try {
                generated = await contentGenerationService.generateContent({ prompt: runPrompt, businessType, imageCount: 1 });
                generationError = null;
            }
            catch (error) {
                generationError = error;
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
        const results = [];
        const finalGenerated = generated;
        const imageUrls = needsImages ? this.resolveImageUrls(finalGenerated.images ?? [], recentSet, requireAiImages) : [];
        const cursorUpdates = {};
        let usedGenericVideo = false;
        const fallbackCopy = this.buildFallbackCopy(job);
        const recentCaptions = this.getRecentCaptionHistory(job);
        const captionHistory = new Set(recentCaptions);
        const usedCaptions = [];
        const historyEntries = [];
        if (requireAiImages && imageUrls.length === 0) {
            const nextRunDate = new Date();
            nextRunDate.setHours(nextRunDate.getHours() + effectiveIntervalHours);
            const failed = platforms.map(platform => ({
                platform,
                status: 'failed',
                error: 'ai_image_generation_failed',
            }));
            await autopostCollection.doc(userId).set({
                lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
                lastResult: failed,
                nextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
                active: job.active !== false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return {
                posted: 0,
                failed,
                nextRun: nextRunDate.toISOString(),
            };
        }
        for (const platform of platforms) {
            const publisher = platformPublishers[platform] ?? publishToTwitter;
            const rawCaption = this.captionForPlatform(platform, finalGenerated, fallbackCopy);
            const shortsCaption = platform === 'youtube' && enableYouTubeShorts ? this.ensureShortsCaption(rawCaption) : rawCaption;
            const { caption, signature } = this.ensureCaptionVariety(platform, shortsCaption, captionHistory);
            const isVideoPlatform = videoPlatforms.has(platform);
            const supportsVideo = isVideoPlatform || optionalVideoPlatforms.has(platform);
            let videoUrl;
            let videoTitle;
            const privacyStatus = platform === 'youtube' ? job.youtubePrivacyStatus : undefined;
            const tags = platform === 'youtube' && enableYouTubeShorts ? ['shorts'] : undefined;
            if (supportsVideo && isVideoPlatform) {
                const platformSelection = this.selectNextVideo(job, platform, fallbackVideoPool);
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
                }
                else if (genericVideoSelection.videoUrl && useGenericVideoFallback && platform !== 'instagram_reels') {
                    videoUrl = genericVideoSelection.videoUrl;
                    usedGenericVideo = true;
                }
                videoTitle = platform === 'youtube' ? job.videoTitle?.trim() : undefined;
                if (platform === 'youtube' && enableYouTubeShorts && videoTitle) {
                    videoTitle = this.ensureShortsTitle(videoTitle);
                }
            }
            else if (supportsVideo && genericVideoSelection.videoUrl) {
                videoUrl = genericVideoSelection.videoUrl;
                usedGenericVideo = true;
            }
            if (isVideoPlatform && !videoUrl) {
                const errorMessage = platform === 'youtube'
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
                    imageUrls: videoUrl ? [] : imageUrls,
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
            }
            catch (error) {
                let retryError = error;
                if (platform === 'instagram_reels') {
                    const retryCursor = typeof cursorUpdates.reelsVideoCursor === 'number'
                        ? cursorUpdates.reelsVideoCursor
                        : job.reelsVideoCursor;
                    if (typeof retryCursor === 'number') {
                        const retrySelection = this.selectNextVideo({ ...job, reelsVideoCursor: retryCursor }, 'instagram_reels', fallbackVideoPool);
                        if (retrySelection.videoUrl && retrySelection.videoUrl !== videoUrl) {
                            try {
                                const retryResponse = await publisher({
                                    caption,
                                    imageUrls: [],
                                    videoUrl: retrySelection.videoUrl,
                                    videoTitle,
                                    privacyStatus,
                                    tags,
                                    credentials,
                                });
                                if (typeof retrySelection.nextCursor === 'number') {
                                    cursorUpdates.reelsVideoCursor = retrySelection.nextCursor;
                                }
                                results.push({ platform, status: 'posted', remoteId: retryResponse?.remoteId ?? null });
                                usedCaptions.push(signature);
                                captionHistory.add(signature);
                                historyEntries.push({
                                    platform,
                                    status: 'posted',
                                    caption,
                                    remoteId: retryResponse?.remoteId ?? null,
                                    videoUrl: retrySelection.videoUrl,
                                    videoTitle,
                                });
                                continue;
                            }
                            catch (retry) {
                                retryError = retry;
                            }
                        }
                    }
                }
                const errorMessage = retryError?.message ?? 'publish_failed';
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
        const updatePayload = {
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
            const nextRecord = {
                ...job,
                active: job.active !== false,
                recentImageUrls: nextRecentImages,
                recentCaptions: nextRecentCaptions,
                videoCursor: usedGenericVideo && typeof genericVideoSelection.nextCursor === 'number'
                    ? genericVideoSelection.nextCursor
                    : job.videoCursor,
                youtubeVideoCursor: typeof cursorUpdates.youtubeVideoCursor === 'number' ? cursorUpdates.youtubeVideoCursor : job.youtubeVideoCursor,
                tiktokVideoCursor: typeof cursorUpdates.tiktokVideoCursor === 'number' ? cursorUpdates.tiktokVideoCursor : job.tiktokVideoCursor,
                reelsVideoCursor: typeof cursorUpdates.reelsVideoCursor === 'number' ? cursorUpdates.reelsVideoCursor : job.reelsVideoCursor,
            };
            if (!isReelsRun) {
                nextRecord.intervalHours = effectiveIntervalHours;
            }
            if (nextRunField === 'nextRun') {
                nextRecord.lastRunAt = admin.firestore.Timestamp.now();
                nextRecord.nextRun = admin.firestore.Timestamp.fromDate(nextRunDate);
            }
            else {
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
    async recordHistory(userId, entries, imageUrls) {
        if (!entries.length)
            return;
        const targetDate = new Date().toISOString().slice(0, 10);
        const scheduledFor = admin.firestore.Timestamp.now();
        try {
            const batch = firestore.batch();
            entries.forEach(entry => {
                const ref = scheduledPostsCollection.doc();
                const isVideoPlatform = entry.platform === 'youtube' || entry.platform === 'tiktok' || entry.platform === 'instagram_reels';
                const payload = {
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
            await Promise.all(entries.map(entry => socialAnalyticsService.incrementDaily({
                userId,
                platform: entry.platform,
                status: entry.status,
            })));
        }
        catch (error) {
            console.warn('[autopost] failed to record history', error);
        }
    }
    async resolveCredentials(userId) {
        const userDoc = await firestore.collection('users').doc(userId).get();
        const userData = userDoc.data();
        const allowDefaults = canUsePrimarySocialDefaults(userData);
        const defaults = this.defaultSocialAccounts(allowDefaults);
        const userAccounts = userData?.socialAccounts ?? {};
        const merged = { ...defaults, ...userAccounts };
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
    defaultSocialAccounts(allowDefaults) {
        const defaults = {};
        if (allowDefaults && config.channels.facebook.pageId && config.channels.facebook.pageToken) {
            defaults.facebook = { accessToken: config.channels.facebook.pageToken, pageId: config.channels.facebook.pageId };
        }
        if (allowDefaults && config.channels.instagram.businessId && config.channels.instagram.accessToken) {
            defaults.instagram = { accessToken: config.channels.instagram.accessToken, accountId: config.channels.instagram.businessId };
        }
        if (allowDefaults && config.linkedin.accessToken && config.linkedin.organizationId) {
            defaults.linkedin = {
                accessToken: config.linkedin.accessToken,
                urn: `urn:li:organization:${config.linkedin.organizationId}`,
            };
        }
        if (allowDefaults && config.tiktok.accessToken && config.tiktok.openId) {
            defaults.tiktok = {
                accessToken: config.tiktok.accessToken,
                openId: config.tiktok.openId,
                clientKey: config.tiktok.clientKey || undefined,
                clientSecret: config.tiktok.clientSecret || undefined,
            };
        }
        return defaults;
    }
    captionForPlatform(platform, content, fallbackCopy) {
        const captions = {
            instagram: content.caption_instagram,
            instagram_reels: content.caption_instagram,
            instagram_story: content.caption_instagram,
            threads: content.caption_instagram,
            tiktok: content.caption_instagram,
            facebook: content.caption_linkedin,
            facebook_story: content.caption_instagram,
            linkedin: content.caption_linkedin,
            twitter: content.caption_x,
            x: content.caption_x,
            youtube: content.caption_linkedin,
        };
        const chosen = (captions[platform] ?? content.caption_linkedin ?? content.caption_instagram ?? '').trim();
        const fallbackCaption = fallbackCopy.caption.trim();
        const caption = chosen.length ? chosen : fallbackCaption;
        const hasHashtags = /#[A-Za-z0-9_]+/.test(caption);
        const sourceHashtags = platform === 'instagram' ||
            platform === 'instagram_reels' ||
            platform === 'instagram_story' ||
            platform === 'facebook_story' ||
            platform === 'threads' ||
            platform === 'tiktok'
            ? content.hashtags_instagram
            : content.hashtags_generic;
        const formattedSourceHashtags = this.formatHashtags(sourceHashtags);
        const formattedFallbackHashtags = this.formatHashtags(fallbackCopy.hashtags);
        const hashtags = hasHashtags ? '' : (formattedSourceHashtags || formattedFallbackHashtags);
        if (platform === 'twitter' || platform === 'x') {
            return [caption, hashtags].filter(Boolean).join(' ');
        }
        return [caption, hashtags].filter(Boolean).join('\n\n');
    }
    buildFallbackCopy(job) {
        const caption = job.fallbackCaption?.trim() || this.defaultFallbackCaption;
        let hashtags = job.fallbackHashtags?.trim() || this.defaultFallbackHashtags;
        if (!this.formatHashtags(hashtags)) {
            hashtags = this.defaultFallbackHashtags;
        }
        return { caption, hashtags };
    }
    formatHashtags(raw) {
        if (!raw)
            return '';
        const tokens = raw
            .split(/[,\n]/g)
            .map(token => token.trim())
            .filter(Boolean)
            .flatMap(token => token.split(/\s+/).filter(Boolean))
            .map(token => token.replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, ''))
            .filter(Boolean);
        if (!tokens.length)
            return '';
        const seen = new Set();
        const unique = tokens.filter(token => {
            const key = token.toLowerCase();
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        return unique.slice(0, 25).map(token => `#${token}`).join(' ');
    }
    useYouTubeShorts(job) {
        if (typeof job.youtubeShorts === 'boolean')
            return job.youtubeShorts;
        const flag = process.env.AUTOPOST_YOUTUBE_SHORTS?.toLowerCase();
        if (!flag)
            return false;
        return flag !== 'false';
    }
    ensureShortsCaption(caption) {
        const trimmed = caption.trim();
        if (!trimmed)
            return '#Shorts';
        if (/#shorts\b/i.test(trimmed))
            return trimmed;
        return `${trimmed}\n\n#Shorts`;
    }
    ensureShortsTitle(title) {
        const trimmed = title.trim();
        if (!trimmed)
            return '#Shorts';
        if (/#shorts\b/i.test(trimmed))
            return trimmed;
        return `${trimmed} #Shorts`;
    }
    parseFallbackUrls(raw) {
        if (!raw)
            return [];
        return raw
            .split(/[\r\n,]+/)
            .map(item => item.trim())
            .filter(Boolean);
    }
    getPublicBaseUrl() {
        const raw = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? '';
        return raw.trim().replace(/\/+$/, '');
    }
    loadFallbackImagesFromDir(dir) {
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
        }
        catch (error) {
            console.warn('[autopost] Failed to load fallback images; using other fallback sources.', error);
            return [];
        }
    }
    loadFallbackVideosFromDir(dir) {
        const baseUrl = this.getPublicBaseUrl();
        if (!baseUrl) {
            console.warn('[autopost] AUTOPOST_FALLBACK_VIDEO_DIR set but BASE_URL is missing; using other fallback sources.');
            return [];
        }
        try {
            const resolved = path.resolve(dir);
            const entries = fs.readdirSync(resolved, { withFileTypes: true });
            const videos = entries
                .filter(entry => entry.isFile())
                .map(entry => entry.name)
                .filter(name => /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name));
            if (!videos.length) {
                console.warn('[autopost] No fallback videos found in AUTOPOST_FALLBACK_VIDEO_DIR; using other fallback sources.');
                return [];
            }
            return videos.map(name => `${baseUrl}/public/fallback-videos/${encodeURIComponent(name)}`);
        }
        catch (error) {
            console.warn('[autopost] Failed to load fallback videos; using other fallback sources.', error);
            return [];
        }
    }
    loadFallbackImagePool() {
        const dir = process.env.AUTOPOST_FALLBACK_DIR?.trim();
        const dirUrls = dir ? this.loadFallbackImagesFromDir(dir) : [];
        if (dirUrls.length)
            return dirUrls;
        const explicitUrls = this.parseFallbackUrls(process.env.AUTOPOST_FALLBACK_URLS);
        if (explicitUrls.length)
            return explicitUrls;
        const urlsFile = process.env.AUTOPOST_FALLBACK_URLS_FILE?.trim();
        if (urlsFile) {
            try {
                const resolved = path.resolve(urlsFile);
                const contents = fs.readFileSync(resolved, 'utf8');
                const fileUrls = this.parseFallbackUrls(contents);
                if (fileUrls.length)
                    return fileUrls;
                console.warn('[autopost] No URLs found in AUTOPOST_FALLBACK_URLS_FILE; using default fallback images.');
            }
            catch (error) {
                console.warn('[autopost] Failed to load AUTOPOST_FALLBACK_URLS_FILE; using default fallback images.', error);
            }
        }
        return this.defaultFallbackImagePool;
    }
    loadFallbackVideoPool() {
        const dir = process.env.AUTOPOST_FALLBACK_VIDEO_DIR?.trim() || './public/fallback-videos';
        const dirUrls = dir ? this.loadFallbackVideosFromDir(dir) : [];
        if (dirUrls.length)
            return dirUrls;
        const explicitUrls = this.parseFallbackUrls(process.env.AUTOPOST_FALLBACK_VIDEO_URLS);
        if (explicitUrls.length)
            return explicitUrls;
        const urlsFile = process.env.AUTOPOST_FALLBACK_VIDEO_URLS_FILE?.trim();
        if (urlsFile) {
            try {
                const resolved = path.resolve(urlsFile);
                const contents = fs.readFileSync(resolved, 'utf8');
                const fileUrls = this.parseFallbackUrls(contents);
                if (fileUrls.length)
                    return fileUrls;
                console.warn('[autopost] No URLs found in AUTOPOST_FALLBACK_VIDEO_URLS_FILE; using empty fallback videos.');
            }
            catch (error) {
                console.warn('[autopost] Failed to load AUTOPOST_FALLBACK_VIDEO_URLS_FILE; using empty fallback videos.', error);
            }
        }
        return [];
    }
    withCacheBuster(url) {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}t=${Date.now()}`;
    }
    fallbackImageUrl() {
        // Ensure a fresh image URL each run to avoid caching
        return this.withCacheBuster(this.fallbackImageBase);
    }
    getRecentImageHistory(job) {
        if (!Array.isArray(job.recentImageUrls))
            return [];
        return job.recentImageUrls.filter(Boolean);
    }
    getRecentCaptionHistory(job) {
        if (!Array.isArray(job.recentCaptions))
            return [];
        return job.recentCaptions.filter(Boolean);
    }
    selectFreshImages(images, recent) {
        return images.filter(url => url && !recent.has(url));
    }
    resolveImageUrls(images, recent, requireAiImages) {
        const fresh = this.selectFreshImages(images, recent);
        if (fresh.length)
            return fresh;
        if (requireAiImages)
            return [];
        const fallback = this.pickFallbackImage(recent);
        return fallback ? [fallback] : images;
    }
    mergeRecentImages(existing, used) {
        const maxHistory = Math.max(Number(process.env.AUTOPOST_IMAGE_HISTORY ?? 12), 3);
        const next = [...used, ...existing].filter(Boolean);
        const seen = new Set();
        const unique = next.filter(url => {
            if (seen.has(url))
                return false;
            seen.add(url);
            return true;
        });
        return unique.slice(0, maxHistory);
    }
    mergeRecentCaptions(existing, used) {
        const maxHistory = Math.max(Number(process.env.AUTOPOST_CAPTION_HISTORY ?? 12), 3);
        const next = [...used, ...existing].filter(Boolean);
        const seen = new Set();
        const unique = next.filter(value => {
            if (seen.has(value))
                return false;
            seen.add(value);
            return true;
        });
        return unique.slice(0, maxHistory);
    }
    pickFallbackImage(recent) {
        const poolAll = this.getFallbackImagePool();
        const pool = poolAll.filter(url => !recent.has(url));
        const pickFrom = pool.length ? pool : poolAll;
        if (!pickFrom.length)
            return this.fallbackImageUrl();
        const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
        return this.withCacheBuster(chosen);
    }
    buildVisualPrompt(basePrompt) {
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
        const pick = (items) => items[Math.floor(Math.random() * items.length)];
        const pickLighting = style === 'neon'
            ? pick(neonLighting)
            : style === 'neon-subtle'
                ? pick(subtleNeonLighting)
                : pick(lighting);
        const pickPalette = style === 'neon'
            ? pick(neonPalettes)
            : style === 'neon-subtle'
                ? pick(subtleNeonPalettes)
                : pick(palettes);
        const pickDetail = style === 'neon'
            ? pick(neonDetails)
            : style === 'neon-subtle'
                ? pick(subtleNeonDetails)
                : pick(details);
        const ref = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        return `${basePrompt} Context: ${sceneContext}. Scene: ${pick(scenes)}. Interaction: ${pick(interactions)}. Setting: ${pick(settings)}. Composition: ${pick(compositions)}. Lighting: ${pickLighting}. Palette: ${pickPalette}. Details: ${pickDetail}. Ref ${ref}.`;
    }
    getSceneContext() {
        const raw = process.env.AUTOPOST_SCENE_CONTEXT?.trim();
        return raw && raw.length > 0 ? raw : 'executive suite';
    }
    applyNeonPreference(basePrompt) {
        const forceNeon = (process.env.AUTOPOST_FORCE_NEON ?? 'true').toLowerCase() !== 'false';
        if (!forceNeon)
            return basePrompt;
        const lower = basePrompt.toLowerCase();
        if (lower.includes('neon') || lower.includes('cyberpunk')) {
            return basePrompt;
        }
        return `${basePrompt} Neon lighting with magenta and cyan accents, futuristic glow, glossy reflections.`;
    }
    getVisualStyle(basePrompt) {
        const lower = basePrompt.toLowerCase();
        if (lower.includes('subtle neon') || lower.includes('minimal neon') || lower.includes('soft neon')) {
            return 'neon-subtle';
        }
        return lower.includes('neon') || lower.includes('cyberpunk') ? 'neon' : 'default';
    }
    requireAiImages(job) {
        if (typeof job.requireAiImages === 'boolean')
            return job.requireAiImages;
        const flag = process.env.AUTOPOST_REQUIRE_AI_IMAGES?.toLowerCase();
        if (flag === 'false')
            return false;
        return true;
    }
    ensureCaptionVariety(platform, caption, history) {
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
    appendCaptionSuffix(caption, suffix, platform) {
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
    buildCaptionSignature(platform, caption) {
        const normalized = caption.toLowerCase().replace(/\s+/g, ' ').trim();
        return `${platform}:${normalized}`;
    }
    selectNextVideo(job, platform, fallbackVideos = []) {
        const list = platform === 'youtube'
            ? (job.youtubeVideoUrls ?? []).map(url => url.trim()).filter(Boolean)
            : platform === 'tiktok'
                ? (job.tiktokVideoUrls ?? []).map(url => url.trim()).filter(Boolean)
                : (job.reelsVideoUrls ?? []).map(url => url.trim()).filter(Boolean);
        const single = platform === 'youtube'
            ? job.youtubeVideoUrl?.trim()
            : platform === 'tiktok'
                ? job.tiktokVideoUrl?.trim()
                : job.reelsVideoUrl?.trim();
        const cursor = platform === 'youtube'
            ? Number.isFinite(job.youtubeVideoCursor)
                ? job.youtubeVideoCursor
                : 0
            : platform === 'tiktok'
                ? Number.isFinite(job.tiktokVideoCursor)
                    ? job.tiktokVideoCursor
                    : 0
                : Number.isFinite(job.reelsVideoCursor)
                    ? job.reelsVideoCursor
                    : 0;
        if (!list.length) {
            if (single) {
                return { videoUrl: single, nextCursor: undefined };
            }
            if (!fallbackVideos.length) {
                return { videoUrl: undefined, nextCursor: undefined };
            }
            const index = ((cursor % fallbackVideos.length) + fallbackVideos.length) % fallbackVideos.length;
            const nextCursor = (index + 1) % fallbackVideos.length;
            return { videoUrl: fallbackVideos[index], nextCursor };
        }
        const index = ((cursor % list.length) + list.length) % list.length;
        const nextCursor = (index + 1) % list.length;
        return { videoUrl: list[index], nextCursor };
    }
    selectNextGenericVideo(job, fallbackVideos = []) {
        const list = (job.videoUrls ?? []).map(url => url.trim()).filter(Boolean);
        if (!list.length) {
            const single = job.videoUrl?.trim();
            if (single) {
                return { videoUrl: single, nextCursor: undefined };
            }
            if (!fallbackVideos.length) {
                return { videoUrl: undefined, nextCursor: undefined };
            }
            const cursor = Number.isFinite(job.videoCursor) ? job.videoCursor : 0;
            const index = ((cursor % fallbackVideos.length) + fallbackVideos.length) % fallbackVideos.length;
            const nextCursor = (index + 1) % fallbackVideos.length;
            return { videoUrl: fallbackVideos[index], nextCursor };
        }
        const cursor = Number.isFinite(job.videoCursor) ? job.videoCursor : 0;
        const index = ((cursor % list.length) + list.length) % list.length;
        const nextCursor = (index + 1) % list.length;
        return { videoUrl: list[index], nextCursor };
    }
}
export const autoPostService = new AutoPostService();

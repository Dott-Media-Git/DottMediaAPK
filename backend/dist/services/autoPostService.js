import admin from 'firebase-admin';
import axios from 'axios';
import sharp from 'sharp';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { TwitterApi } from 'twitter-api-v2';
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
import { renderLeagueTableImage, renderPredictionsImage, renderTopScorersImage } from './tableImageService.js';
const TOP_FIVE_LEAGUES = [
    { id: 'eng.1', label: 'Premier League', espnId: 'eng.1' },
    { id: 'esp.1', label: 'La Liga', espnId: 'esp.1' },
    { id: 'ita.1', label: 'Serie A', espnId: 'ita.1' },
    { id: 'ger.1', label: 'Bundesliga', espnId: 'ger.1' },
    { id: 'fra.1', label: 'Ligue 1', espnId: 'fra.1' },
];
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
        this.defaultXHighlightAccounts = [
            'premierleague',
            'SkySportsNews',
            'SkySportsPL',
            'ESPNFC',
            'SerieA_EN',
            'LaLigaEN',
            'Ligue1_ENG',
            'Bundesliga_EN',
            'ChampionsLeague',
        ];
        this.defaultXWeeklyAwardKeywords = [
            'player of the week',
            'goal of the week',
            'save of the week',
            'team of the week',
            'manager of the week',
            'weekly awards',
            'totw',
            'best xi',
            'goal of the month',
            'player of the month',
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
    normalizeXCaption(caption, maxChars = 270) {
        const cleaned = String(caption || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (cleaned.length <= maxChars)
            return cleaned;
        const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean);
        const cta = lines.find(line => /bwinbetug\.info/i.test(line));
        let compactLines = lines.slice(0, 5);
        if (cta && !compactLines.includes(cta)) {
            compactLines.push(cta);
        }
        let compact = compactLines.join('\n');
        if (compact.length <= maxChars)
            return compact;
        const truncated = compact.slice(0, maxChars - 3).trimEnd();
        const lastBreak = Math.max(truncated.lastIndexOf('\n'), truncated.lastIndexOf(' '));
        const base = lastBreak > 80 ? truncated.slice(0, lastBreak) : truncated;
        return `${base.trimEnd()}...`;
    }
    buildVideoCaptionFromHighlight(rawText, username, timezone) {
        const cleaned = String(rawText || '')
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        const headlineSeed = cleaned || `Latest football clip from @${username}`;
        const headline = headlineSeed.length > 140 ? `${headlineSeed.slice(0, 137).trimEnd()}...` : headlineSeed;
        return [
            `Video: ${headline}`,
            `Update time: ${this.formatTrendClock(timezone)} EAT`,
            'More football updates: www.bwinbetug.info',
        ]
            .filter(Boolean)
            .join('\n');
    }
    getTrendRecentKeys(job) {
        if (!Array.isArray(job.trendRecentKeys))
            return [];
        return job.trendRecentKeys.filter(Boolean).map(value => String(value).toLowerCase().trim()).filter(Boolean);
    }
    mergeTrendRecentKeys(existing, used) {
        const maxHistory = Math.max(Number(process.env.AUTOPOST_TREND_KEY_HISTORY ?? 80), 20);
        const next = [...used, ...existing]
            .map(value => String(value || '').toLowerCase().trim())
            .filter(Boolean);
        const seen = new Set();
        const unique = next.filter(value => {
            if (seen.has(value))
                return false;
            seen.add(value);
            return true;
        });
        return unique.slice(0, maxHistory);
    }
    getHourForTimezone(date, timezone) {
        try {
            const formatted = new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                hour: '2-digit',
                hour12: false,
            }).format(date);
            const parsed = Number.parseInt(formatted, 10);
            if (Number.isFinite(parsed))
                return parsed;
        }
        catch (error) {
            console.warn('[autopost] invalid trend timezone, falling back to UTC', { timezone, error });
        }
        return date.getUTCHours();
    }
    getDateKeyForTimezone(date, timezone) {
        try {
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(date);
            const year = parts.find(part => part.type === 'year')?.value;
            const month = parts.find(part => part.type === 'month')?.value;
            const day = parts.find(part => part.type === 'day')?.value;
            if (year && month && day) {
                return `${year}-${month}-${day}`;
            }
        }
        catch (error) {
            console.warn('[autopost] invalid trend timezone for date key; falling back to UTC', { timezone, error });
        }
        const year = date.getUTCFullYear();
        const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
        const day = `${date.getUTCDate()}`.padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    getDailyLeagueForDate(date, timezone) {
        const dateKey = this.getDateKeyForTimezone(date, timezone);
        const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
        const year = Number.parseInt(yearRaw, 10);
        const month = Number.parseInt(monthRaw, 10);
        const day = Number.parseInt(dayRaw, 10);
        const daySerial = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
            ? Math.floor(Date.UTC(year, month - 1, day) / 86400000)
            : Math.floor(date.getTime() / 86400000);
        const idx = ((daySerial % TOP_FIVE_LEAGUES.length) + TOP_FIVE_LEAGUES.length) % TOP_FIVE_LEAGUES.length;
        return TOP_FIVE_LEAGUES[idx];
    }
    parseNumeric(value) {
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string') {
            const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
            if (Number.isFinite(parsed))
                return parsed;
        }
        return 0;
    }
    getStructuredFootballSlot(job, now) {
        const timezone = job.trendTimezone?.trim() || process.env.AUTOPOST_FOOTBALL_TZ?.trim() || 'Africa/Kampala';
        const hour = this.getHourForTimezone(now, timezone);
        const predictionHours = new Set([9, 13, 17, 21]);
        const tableHours = new Set([8]);
        const topScorerHours = new Set([20]);
        if (predictionHours.has(hour)) {
            return { contentType: 'prediction', timezone, hour };
        }
        if (tableHours.has(hour)) {
            return { contentType: 'table', timezone, hour };
        }
        if (topScorerHours.has(hour)) {
            return { contentType: 'top_scorer', timezone, hour };
        }
        const cycle = ['result', 'news', 'video'];
        const cursor = Number.isFinite(job.trendSlotCursor) ? job.trendSlotCursor : hour % cycle.length;
        const idx = ((Math.trunc(cursor) % cycle.length) + cycle.length) % cycle.length;
        return {
            contentType: cycle[idx],
            timezone,
            hour,
            nextSlotCursor: (idx + 1) % cycle.length,
        };
    }
    buildTrendContentKey(type, value) {
        const normalized = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return `${type}:${normalized}`.slice(0, 320);
    }
    buildNewsCandidateKey(candidate, item = candidate.items?.[0]) {
        const topic = candidate.topic || '';
        const headline = item?.title || candidate.sampleTitles?.[0] || topic;
        const link = item?.link || '';
        return this.buildTrendContentKey('news', `${topic}|${headline}|${link}`);
    }
    pickFreshNewsCandidate(candidates, recentSet) {
        for (const candidate of candidates) {
            const item = candidate.items?.[0];
            const key = this.buildNewsCandidateKey(candidate, item);
            if (!recentSet.has(key)) {
                return { candidate, item, key };
            }
        }
        return null;
    }
    pickFreshVideoCandidate(candidates, recentSet) {
        for (const candidate of candidates) {
            for (const item of candidate.items ?? []) {
                const videoUrl = item.videoUrl?.trim();
                if (!videoUrl)
                    continue;
                const key = this.buildTrendContentKey('video', `${item.link || videoUrl}|${item.title || ''}`);
                if (!recentSet.has(key)) {
                    return { candidate, item, key };
                }
            }
        }
        return null;
    }
    toHighResolutionImageUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value)
            return '';
        try {
            const parsed = new URL(value);
            const host = parsed.hostname.toLowerCase();
            if (host.includes('images.unsplash.com')) {
                parsed.searchParams.set('auto', 'format');
                parsed.searchParams.set('fit', 'crop');
                parsed.searchParams.set('w', '1800');
                parsed.searchParams.set('q', '90');
                return parsed.toString();
            }
            if (host.includes('i.guim.co.uk')) {
                parsed.searchParams.set('width', '2000');
                parsed.searchParams.set('quality', '90');
                parsed.searchParams.set('auto', 'format');
                parsed.searchParams.set('fit', 'max');
                return parsed.toString();
            }
            if (host.includes('bbci.co.uk') || host.includes('bbc.co.uk') || host.includes('bbc.com')) {
                parsed.searchParams.set('w', '1600');
                parsed.searchParams.set('h', '900');
                parsed.searchParams.set('quality', '90');
                return parsed.toString();
            }
            if (host.includes('espncdn.com') || host.includes('espn.com')) {
                parsed.searchParams.set('w', '1600');
                parsed.searchParams.set('h', '900');
                parsed.searchParams.set('q', '90');
                return parsed.toString();
            }
            return parsed.toString();
        }
        catch {
            return value;
        }
    }
    isLikelyLowResolutionUrl(rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            const width = Number.parseInt(parsed.searchParams.get('width') ?? parsed.searchParams.get('w') ?? '', 10);
            const height = Number.parseInt(parsed.searchParams.get('height') ?? parsed.searchParams.get('h') ?? '', 10);
            if (Number.isFinite(width) && width > 0 && width <= 500)
                return true;
            if (Number.isFinite(height) && height > 0 && height <= 350)
                return true;
            const url = rawUrl.toLowerCase();
            if (url.includes('/thumb/') || url.includes('thumbnail') || url.includes('width=140'))
                return true;
            return false;
        }
        catch {
            return false;
        }
    }
    async fetchOpenGraphImage(articleUrl) {
        try {
            const response = await axios.get(articleUrl, {
                timeout: 12000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                },
            });
            const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            const $ = cheerio.load(html);
            const ogImage = $('meta[property="og:image"]').attr('content')?.trim() ||
                $('meta[property="og:image:secure_url"]').attr('content')?.trim() ||
                $('meta[name="twitter:image"]').attr('content')?.trim() ||
                $('link[rel="image_src"]').attr('href')?.trim();
            if (!ogImage)
                return null;
            try {
                return new URL(ogImage, articleUrl).toString();
            }
            catch {
                return ogImage;
            }
        }
        catch (error) {
            console.warn('[autopost] failed to fetch article OG image', { articleUrl, error });
            return null;
        }
    }
    async resolveBestNewsImageUrl(imageUrl, articleUrl) {
        const normalized = imageUrl ? this.toHighResolutionImageUrl(imageUrl) : '';
        if (normalized && !this.isLikelyLowResolutionUrl(normalized)) {
            return normalized;
        }
        if (articleUrl) {
            const ogImage = await this.fetchOpenGraphImage(articleUrl);
            if (ogImage)
                return this.toHighResolutionImageUrl(ogImage);
        }
        return normalized;
    }
    async enhanceImageToDataUrl(url) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                },
            });
            const source = Buffer.from(response.data);
            const buffer = await sharp(source)
                .rotate()
                .resize(1600, 900, { fit: 'cover', position: 'attention' })
                .sharpen()
                .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
                .toBuffer();
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        catch (error) {
            console.warn('[autopost] image enhancement failed', { url, error });
            return null;
        }
    }
    async improveNewsImageQuality(imageUrls, platforms) {
        const normalized = imageUrls
            .map(url => this.toHighResolutionImageUrl(url))
            .filter(Boolean)
            .filter((value, index, arr) => arr.indexOf(value) === index);
        if (!normalized.length)
            return [];
        const xOnly = platforms.every(platform => platform === 'x' || platform === 'twitter');
        if (!xOnly)
            return normalized;
        const enhanced = await this.enhanceImageToDataUrl(normalized[0]);
        return enhanced ? [enhanced] : normalized;
    }
    formatTrendClock(timezone = 'Africa/Kampala') {
        try {
            return new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }).format(new Date());
        }
        catch {
            return new Date().toISOString().slice(11, 16);
        }
    }
    buildFootballFallbackCaption(topic, contentType, timezone = 'Africa/Kampala') {
        const title = topic?.trim() || `${contentType.replace(/_/g, ' ')} update`;
        const stamp = this.formatTrendClock(timezone);
        return `${title}\n\nUpdate time: ${stamp} EAT\nMore football updates: www.bwinbetug.info`;
    }
    async generateFootballCardImage(prompt, recentSet) {
        try {
            const generated = await contentGenerationService.generateContent({
                prompt,
                businessType: 'Football content card',
                imageCount: 1,
            });
            const images = this.resolveImageUrls(generated.images ?? [], recentSet, false);
            return images.slice(0, 1);
        }
        catch (error) {
            console.warn('[autopost] football card image generation failed', error);
            return [];
        }
    }
    extractResultEntries(candidates, recentSet) {
        const scorePattern = /\b\d{1,2}\s*[-:]\s*\d{1,2}\b/;
        const entries = candidates.flatMap(candidate => {
            const itemMatches = (candidate.items ?? [])
                .filter(item => scorePattern.test(item.title))
                .map(item => {
                const key = this.buildTrendContentKey('result', `${item.title}|${item.link || ''}|${item.publishedAt || ''}`);
                return { candidate, item, key };
            })
                .filter(entry => !recentSet.has(entry.key));
            return itemMatches;
        });
        return entries.slice(0, 10);
    }
    async fetchBwinPredictionPicks(job, limit = 3) {
        const configured = job.trendPredictionsUrl?.trim() || 'https://www.bwinbetug.com';
        const targets = [configured, 'https://m.bwinbetug.com'].filter((value, index, arr) => arr.indexOf(value) === index);
        const picks = [];
        const seen = new Set();
        for (const target of targets) {
            try {
                const response = await axios.get(target, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                    },
                });
                const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                const $ = cheerio.load(html);
                const candidates = [];
                const selectors = ['[class*="event"]', '[class*="match"]', '[class*="fixture"]', 'li', 'a', 'div'];
                for (const selector of selectors) {
                    $(selector)
                        .slice(0, 800)
                        .each((_, element) => {
                        const text = $(element).text().replace(/\s+/g, ' ').trim();
                        if (text.length >= 12 && text.length <= 180 && /( vs | v | - )/i.test(text)) {
                            candidates.push(text);
                        }
                    });
                    if (candidates.length >= 100)
                        break;
                }
                for (const raw of candidates) {
                    const fixtureMatch = raw.match(/([A-Za-z0-9 .'-]{2,})\s(?:vs|v|-)\s([A-Za-z0-9 .'-]{2,})/i);
                    if (!fixtureMatch)
                        continue;
                    const fixture = `${fixtureMatch[1].trim()} vs ${fixtureMatch[2].trim()}`.replace(/\s+/g, ' ');
                    const oddsMatches = raw.match(/\b\d{1,2}\.\d{1,2}\b/g) ?? [];
                    const odds = oddsMatches.slice(0, 3).join(' / ') || undefined;
                    const dedupeKey = `${fixture.toLowerCase()}|${odds || ''}`;
                    if (seen.has(dedupeKey))
                        continue;
                    seen.add(dedupeKey);
                    picks.push({ fixture, odds });
                    if (picks.length >= limit)
                        return picks;
                }
            }
            catch (error) {
                console.warn('[autopost] prediction source fetch failed', { target, error });
            }
        }
        return picks;
    }
    async fetchLeagueTableSnapshot(job, options = {}) {
        const leagues = TOP_FIVE_LEAGUES;
        const cursorRaw = Number.isFinite(job.trendTableCursor) ? job.trendTableCursor : 0;
        const start = ((Math.trunc(cursorRaw) % leagues.length) + leagues.length) % leagues.length;
        const orderedLeagues = options.preferredLeague
            ? options.strictPreferred
                ? [options.preferredLeague]
                : [
                    options.preferredLeague,
                    ...leagues.filter(league => league.id !== options.preferredLeague?.id),
                ]
            : [...leagues.slice(start), ...leagues.slice(0, start)];
        for (const league of orderedLeagues) {
            const index = leagues.findIndex(item => item.id === league.id);
            try {
                const response = await axios.get(`https://api-football-standings.azharimm.dev/leagues/${league.id}/standings`, {
                    timeout: 15000,
                });
                const standings = Array.isArray(response.data?.data?.standings) ? response.data.data.standings : [];
                const rows = standings
                    .slice(0, 8)
                    .map((entry) => {
                    const name = String(entry?.team?.displayName || entry?.team?.name || '').trim();
                    const stats = Array.isArray(entry?.stats) ? entry.stats : [];
                    const pointsStat = stats.find(stat => String(stat?.name || '').toLowerCase() === 'points' ||
                        String(stat?.displayName || '').toLowerCase() === 'points');
                    const playedStat = stats.find(stat => String(stat?.name || '').toLowerCase() === 'gamesplayed' ||
                        String(stat?.displayName || '').toLowerCase() === 'games played');
                    const goalDiffStat = stats.find(stat => String(stat?.name || '').toLowerCase() === 'pointdifferential' ||
                        String(stat?.displayName || '').toLowerCase() === 'goal difference');
                    const points = this.parseNumeric(pointsStat?.value ?? pointsStat?.displayValue ?? 0);
                    const played = this.parseNumeric(playedStat?.value ?? playedStat?.displayValue ?? 0);
                    const goalDiff = this.parseNumeric(goalDiffStat?.value ?? goalDiffStat?.displayValue ?? 0);
                    return { name, points, played, goalDiff };
                })
                    .filter((entry) => entry.name);
                if (rows.length) {
                    return {
                        leagueId: league.id,
                        league: league.label,
                        rows,
                        nextCursor: ((index >= 0 ? index : 0) + 1) % leagues.length,
                        source: 'api-football-standings',
                    };
                }
            }
            catch (error) {
                console.warn('[autopost] standings fetch failed (primary source)', { league: league.label, error });
            }
            // Fallback source used when api-football-standings is unavailable.
            try {
                const response = await axios.get(`https://site.api.espn.com/apis/v2/sports/soccer/${league.espnId}/standings`, {
                    timeout: 20000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                    },
                });
                const entries = Array.isArray(response.data?.children?.[0]?.standings?.entries)
                    ? response.data.children[0].standings.entries
                    : [];
                const rows = entries
                    .slice(0, 8)
                    .map((entry) => {
                    const name = String(entry?.team?.displayName || entry?.team?.name || '').trim();
                    const stats = Array.isArray(entry?.stats) ? entry.stats : [];
                    const getStat = (nameKey) => stats.find(stat => String(stat?.name || '').toLowerCase() === nameKey.toLowerCase());
                    const points = this.parseNumeric(getStat('points')?.value ?? getStat('points')?.displayValue ?? 0);
                    const played = this.parseNumeric(getStat('gamesPlayed')?.value ?? getStat('gamesPlayed')?.displayValue ?? 0);
                    const goalDiff = this.parseNumeric(getStat('pointDifferential')?.value ?? getStat('pointDifferential')?.displayValue ?? 0);
                    return { name, points, played, goalDiff };
                })
                    .filter((entry) => entry.name);
                if (rows.length) {
                    return {
                        leagueId: league.id,
                        league: league.label,
                        rows,
                        nextCursor: ((index >= 0 ? index : 0) + 1) % leagues.length,
                        source: 'espn',
                    };
                }
            }
            catch (error) {
                console.warn('[autopost] standings fetch failed (espn fallback)', { league: league.label, error });
            }
        }
        return null;
    }
    async fetchTopScorersSnapshot(league) {
        try {
            const response = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league.espnId}/statistics`, {
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                },
            });
            const stats = Array.isArray(response.data?.stats) ? response.data.stats : [];
            const goalsBucket = stats.find((group) => {
                const key = String(group?.name || '').toLowerCase();
                const display = String(group?.displayName || '').toLowerCase();
                return key.includes('goals') || display.includes('goal');
            });
            const leaders = Array.isArray(goalsBucket?.leaders) ? goalsBucket.leaders : [];
            const rows = leaders
                .slice(0, 10)
                .map((entry) => {
                const athlete = entry?.athlete ?? {};
                const statsList = Array.isArray(athlete?.statistics) ? athlete.statistics : [];
                const goalsStat = statsList.find((stat) => String(stat?.name || '').toLowerCase() === 'totalgoals');
                const appearanceStat = statsList.find((stat) => String(stat?.name || '').toLowerCase() === 'appearances');
                const player = String(athlete?.displayName || athlete?.shortName || '').trim();
                const team = String(athlete?.team?.displayName || athlete?.team?.name || '').trim();
                const goals = Math.trunc(this.parseNumeric(entry?.value ?? goalsStat?.value ?? goalsStat?.displayValue ?? 0));
                let appearances = this.parseNumeric(appearanceStat?.value ?? appearanceStat?.displayValue ?? 0);
                if (!appearances && typeof entry?.displayValue === 'string') {
                    const match = entry.displayValue.match(/matches:\s*(\d{1,3})/i);
                    if (match)
                        appearances = this.parseNumeric(match[1]);
                }
                return {
                    player,
                    team,
                    goals,
                    appearances: appearances > 0 ? Math.trunc(appearances) : null,
                };
            })
                .filter((row) => row.player && row.goals > 0);
            if (!rows.length)
                return null;
            return {
                leagueId: league.id,
                league: league.label,
                rows,
                source: 'espn-statistics',
            };
        }
        catch (error) {
            console.warn('[autopost] top scorers fetch failed', { league: league.label, error });
            return null;
        }
    }
    async createLeagueTableImageUrl(userId, snapshot) {
        const baseUrl = this.getPublicBaseUrl();
        if (!baseUrl)
            return null;
        try {
            const draftRef = firestore.collection('tableImageDrafts').doc();
            await draftRef.set({
                userId,
                league: snapshot.league,
                rows: snapshot.rows.slice(0, 8).map(row => ({
                    name: row.name,
                    points: row.points,
                    played: row.played,
                    goalDiff: row.goalDiff ?? null,
                })),
                source: snapshot.source,
                cta: 'www.bwinbetug.info',
                updatedAt: new Date().toISOString(),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return `${baseUrl}/public/table-image/${draftRef.id}.png`;
        }
        catch (error) {
            console.warn('[autopost] table image draft creation failed', error);
            return null;
        }
    }
    async createLeagueTableImageDataUrl(snapshot) {
        try {
            const buffer = await renderLeagueTableImage({
                league: snapshot.league,
                rows: snapshot.rows.slice(0, 8).map(row => ({
                    name: row.name,
                    points: row.points,
                    played: row.played,
                    goalDiff: row.goalDiff ?? null,
                })),
                source: snapshot.source,
                cta: 'www.bwinbetug.info',
                updatedAt: new Date().toISOString(),
            });
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        catch (error) {
            console.warn('[autopost] table image generation failed', error);
            return null;
        }
    }
    async createTopScorersImageDataUrl(snapshot) {
        try {
            const buffer = await renderTopScorersImage({
                league: snapshot.league,
                rows: snapshot.rows.slice(0, 8).map(row => ({
                    player: row.player,
                    team: row.team,
                    goals: row.goals,
                    appearances: row.appearances ?? null,
                })),
                source: snapshot.source,
                cta: 'www.bwinbetug.info',
                updatedAt: new Date().toISOString(),
            });
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        catch (error) {
            console.warn('[autopost] top scorers image generation failed', error);
            return null;
        }
    }
    async createPredictionsImageDataUrl(picks) {
        try {
            const buffer = await renderPredictionsImage({
                rows: picks.slice(0, 8).map(pick => ({
                    fixture: pick.fixture,
                    odds: pick.odds ?? null,
                })),
                source: 'Bwinbet fixture scan',
                cta: 'www.bwinbetug.info',
                updatedAt: new Date().toISOString(),
            });
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
        catch (error) {
            console.warn('[autopost] predictions image generation failed', error);
            return null;
        }
    }
    async executeTrendStories(userId, job) {
        const onNewRelease = job.storyOnNewRelease === true;
        const defaultPollMinutes = Math.max(Number(process.env.AUTOPOST_STORY_POLL_MINUTES ?? 5), 1);
        const pollMinutes = job.storyPollMinutes && job.storyPollMinutes > 0 ? job.storyPollMinutes : defaultPollMinutes;
        const intervalHours = onNewRelease
            ? Math.max(pollMinutes / 60, 1 / 60)
            : job.storyIntervalHours && job.storyIntervalHours > 0
                ? job.storyIntervalHours
                : this.defaultStoryIntervalHours;
        const nextRunDate = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
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
        const publishedKey = topItem?.publishedAt || top?.publishedAt || '';
        const linkKey = topItem?.link || '';
        const trendKey = [sourceLabel, topic, linkKey, publishedKey]
            .map(value => String(value || '').trim().toLowerCase())
            .join('||');
        if (onNewRelease && job.storyLastTrendKey && trendKey === job.storyLastTrendKey) {
            const nextRecord = {
                storyLastRunAt: admin.firestore.Timestamp.now(),
                storyNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
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
            return {
                posted: 0,
                failed: [],
                nextRun: nextRunDate.toISOString(),
            };
        }
        let relatedImageUrl = topItem?.imageUrl?.trim() || '';
        if (!relatedImageUrl) {
            const prompt = `Create a clean, modern news visual related to this AI headline: "${topic}". Context: "${summary || top?.sampleTitles?.[0] || 'AI news update'}". Keep it realistic and editorial, no logos.`;
            let generated = null;
            try {
                generated = await contentGenerationService.generateContent({ prompt, businessType: 'AI news image', imageCount: 1 });
            }
            catch (error) {
                console.warn('[autopost] related story image generation failed', error);
            }
            const generatedImages = this.resolveImageUrls(generated?.images ?? [], recentSet, false);
            if (generatedImages.length) {
                relatedImageUrl = generatedImages[0];
            }
        }
        const baseUrl = this.getPublicBaseUrl();
        let finalImages = [];
        if (baseUrl) {
            const draftRef = firestore.collection('storyImageDrafts').doc();
            await draftRef.set({
                headline: topic,
                summary,
                source: sourceLabel,
                imageUrl: relatedImageUrl || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            finalImages = [`${baseUrl}/public/story-image/${draftRef.id}.png`];
        }
        else {
            if (relatedImageUrl && !recentSet.has(relatedImageUrl)) {
                finalImages = [relatedImageUrl];
            }
            const prompt = `Create a clean, modern social media story image representing this AI news headline: "${topic}". Use futuristic tech visuals, abstract AI motifs, and leave space for a short headline. Avoid logos and real brand marks.`;
            let generated = null;
            if (!finalImages.length) {
                try {
                    generated = await contentGenerationService.generateContent({ prompt, businessType: 'AI news update', imageCount: 1 });
                }
                catch (error) {
                    console.warn('[autopost] trend story generation failed', error);
                }
                const imageUrls = this.resolveImageUrls(generated?.images ?? [], recentSet, false);
                finalImages = imageUrls.length ? imageUrls : [this.pickFallbackImage(recentSet)];
            }
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
            storyLastTrendKey: trendKey,
            storyRecentImageUrls: this.mergeRecentImages(recentImages, finalImages),
        };
        await autopostCollection.doc(userId).set({
            ...nextRecord,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (this.useMemory) {
            const current = this.memoryStore.get(userId);
            if (current) {
                this.memoryStore.set(userId, {
                    ...current,
                    ...nextRecord,
                });
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
        const nextRunDate = new Date(Date.now() + intervalHours * 60 * 60 * 1000);
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
        const now = new Date();
        const structuredScheduleEnabled = scope === 'football' && job.trendStructuredScheduleEnabled !== false;
        const structuredSlot = structuredScheduleEnabled ? this.getStructuredFootballSlot(job, now) : null;
        let selectedContentType = structuredSlot?.contentType ?? (scope === 'football' ? 'news' : 'news');
        const scheduleTimezone = (structuredSlot?.timezone ?? job.trendTimezone?.trim()) || 'Africa/Kampala';
        const trendDateKey = this.getDateKeyForTimezone(now, scheduleTimezone);
        const dailyLeague = structuredScheduleEnabled ? this.getDailyLeagueForDate(now, scheduleTimezone) : null;
        let nextTrendSlotCursor = structuredScheduleEnabled && typeof structuredSlot?.nextSlotCursor === 'number'
            ? structuredSlot.nextSlotCursor
            : null;
        const trendRecentKeys = this.getTrendRecentKeys(job);
        const trendRecentSet = new Set(trendRecentKeys);
        const usedTrendKeys = [];
        // Currently optimized for football trend posting (bwinbetug). Other scopes fall back to a lightweight text post.
        let caption = '';
        let trendTopic = '';
        let imageUrls = [];
        const sourceImageUrls = [];
        const sourceVideoUrls = [];
        const trendCaptions = {};
        let newsBaselineCaption = '';
        let newsBaselineImages = [];
        let newsBaselineCaptions = {};
        let footballCandidates = [];
        let baselineCandidate = null;
        let usedTableCursor = null;
        let trendContentKey = null;
        if (scope === 'football') {
            try {
                const { sources } = await getUserTrendConfig(userId);
                const candidates = await getFootballTrendingCandidates({
                    sources,
                    maxCandidates: job.trendMaxCandidates ?? 6,
                    maxAgeHours: job.trendMaxAgeHours ?? 48,
                });
                footballCandidates = candidates;
                const top = selectedContentType === 'video'
                    ? candidates.find(candidate => (candidate.items ?? []).some(item => Boolean(item.videoUrl?.trim()))) ?? candidates[0]
                    : this.pickFreshNewsCandidate(candidates, trendRecentSet)?.candidate ?? candidates[0];
                baselineCandidate = top ?? null;
                if (!top) {
                    caption = this.buildFootballFallbackCaption(undefined, 'news', scheduleTimezone);
                }
                else {
                    trendTopic = top.topic;
                    const items = (top.items ?? []).slice(0, 6);
                    const topItemImages = [];
                    for (const item of items.slice(0, 4)) {
                        const resolved = await this.resolveBestNewsImageUrl(item.imageUrl?.trim(), item.link?.trim());
                        if (resolved)
                            topItemImages.push(resolved);
                    }
                    const videoPool = selectedContentType === 'video' ? footballCandidates.flatMap(item => item.items ?? []) : items;
                    const topItemVideos = Array.from(new Set(videoPool
                        .map(item => item.videoUrl?.trim())
                        .filter((url) => Boolean(url))));
                    sourceImageUrls.push(...topItemImages);
                    sourceVideoUrls.push(...topItemVideos.slice(0, 10));
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
                    const mergedImages = [...sourceImageUrls, ...(gen.images ?? [])].filter(Boolean);
                    imageUrls = Array.from(new Set(mergedImages)).slice(0, 4);
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
                caption = this.buildFootballFallbackCaption(trendTopic, 'news', scheduleTimezone);
                imageUrls = Array.from(new Set(sourceImageUrls)).slice(0, 4);
            }
        }
        else {
            caption = 'Trending update coming soon.';
            imageUrls = [];
        }
        if (scope === 'football' && imageUrls.length === 0 && trendTopic) {
            try {
                const generatedImage = await contentGenerationService.generateContent({
                    prompt: `Create a realistic football news image for this trend: "${trendTopic}". Dynamic stadium energy, editorial sports style, no logos.`,
                    businessType: 'Football trend news visual',
                    imageCount: 1,
                });
                const resolvedImages = this.resolveImageUrls(generatedImage.images ?? [], new Set(), false);
                if (resolvedImages.length) {
                    imageUrls = resolvedImages.slice(0, 1);
                }
            }
            catch (error) {
                console.warn('[autopost] trend image fallback generation failed', error);
            }
        }
        if (scope === 'football') {
            newsBaselineCaption = caption.trim();
            newsBaselineImages = [...imageUrls];
            newsBaselineCaptions = { ...trendCaptions };
        }
        if (structuredScheduleEnabled && scope === 'football') {
            const topCandidate = baselineCandidate ?? footballCandidates[0];
            const topItem = topCandidate?.items?.[0];
            const setUnifiedCaption = () => {
                for (const platform of platforms) {
                    trendCaptions[platform] = caption;
                }
            };
            const restoreNewsBaseline = () => {
                caption = newsBaselineCaption || this.buildFootballFallbackCaption(trendTopic, 'news', scheduleTimezone);
                imageUrls = newsBaselineImages.length ? [...newsBaselineImages] : Array.from(new Set(sourceImageUrls)).slice(0, 4);
                for (const platform of platforms) {
                    delete trendCaptions[platform];
                    const baselineCaption = newsBaselineCaptions[platform]?.trim();
                    if (baselineCaption) {
                        trendCaptions[platform] = baselineCaption;
                    }
                }
            };
            if (selectedContentType === 'prediction') {
                const picks = await this.fetchBwinPredictionPicks(job, 3);
                if (picks.length) {
                    const updatedStamp = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                        timeZone: scheduleTimezone,
                    });
                    const picksLine = picks
                        .map((pick, idx) => `${idx + 1}. ${pick.fixture}${pick.odds ? ` (${pick.odds})` : ''}`)
                        .join('\n');
                    caption = [
                        'Football predictions update',
                        `Updated: ${updatedStamp} (${scheduleTimezone})`,
                        picksLine,
                        'For full markets and live odds: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    const key = this.buildTrendContentKey('prediction', `${job.trendPredictionsUrl || 'https://www.bwinbetug.com'}|${picks.map(pick => `${pick.fixture}|${pick.odds || ''}`).join('|')}`);
                    if (trendRecentSet.has(key)) {
                        selectedContentType = 'news';
                        restoreNewsBaseline();
                    }
                    else {
                        trendContentKey = key;
                        usedTrendKeys.push(key);
                        setUnifiedCaption();
                        const predictionsImageDataUrl = await this.createPredictionsImageDataUrl(picks);
                        if (predictionsImageDataUrl) {
                            imageUrls = [predictionsImageDataUrl];
                        }
                        else {
                            imageUrls = await this.generateFootballCardImage(`Create a clean football prediction card with readable fixture list and odds style layout. Highlight: "${picks[0]?.fixture || 'Top fixtures'}". No sportsbook logos.`, new Set(this.getRecentImageHistory(job)));
                        }
                    }
                }
                else {
                    selectedContentType = 'news';
                }
            }
            if (selectedContentType === 'table') {
                const snapshot = await this.fetchLeagueTableSnapshot(job, dailyLeague ? { preferredLeague: dailyLeague, strictPreferred: true } : {});
                if (snapshot?.rows?.length) {
                    const updatedStamp = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                        timeZone: scheduleTimezone,
                    });
                    const rows = snapshot.rows
                        .slice(0, 6)
                        .map((row, idx) => `${idx + 1}. ${row.name} - ${Math.trunc(row.points)} pts${row.played ? ` (${Math.trunc(row.played)}P)` : ''}`);
                    caption = [
                        `${snapshot.league} live table update`,
                        `Updated: ${updatedStamp} (${scheduleTimezone})`,
                        ...rows,
                        'For full tables and fixtures: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    const key = this.buildTrendContentKey('table', `${trendDateKey}|${snapshot.league}|${snapshot.rows
                        .map((row) => `${row.name}:${row.points}:${row.played}`)
                        .join('|')}`);
                    if (!dailyLeague) {
                        usedTableCursor = snapshot.nextCursor;
                    }
                    if (trendRecentSet.has(key)) {
                        selectedContentType = 'news';
                        restoreNewsBaseline();
                    }
                    else {
                        trendContentKey = key;
                        usedTrendKeys.push(key);
                        setUnifiedCaption();
                        const tableImageUrl = await this.createLeagueTableImageUrl(userId, snapshot);
                        if (tableImageUrl) {
                            imageUrls = [tableImageUrl];
                        }
                        else {
                            const tableImageDataUrl = await this.createLeagueTableImageDataUrl(snapshot);
                            if (tableImageDataUrl) {
                                imageUrls = [tableImageDataUrl];
                            }
                            else {
                                imageUrls = await this.generateFootballCardImage(`Design a modern football league table card for ${snapshot.league}. Show top teams and points with strong readability.`, new Set(this.getRecentImageHistory(job)));
                            }
                        }
                    }
                }
                else {
                    selectedContentType = 'news';
                }
            }
            if (selectedContentType === 'top_scorer') {
                const scorerLeague = dailyLeague ?? TOP_FIVE_LEAGUES[0];
                const snapshot = await this.fetchTopScorersSnapshot(scorerLeague);
                if (snapshot?.rows?.length) {
                    const updatedStamp = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                        timeZone: scheduleTimezone,
                    });
                    const rows = snapshot.rows
                        .slice(0, 6)
                        .map((row, idx) => `${idx + 1}. ${row.player} (${row.team}) - ${Math.trunc(row.goals)} goals${row.appearances ? ` in ${Math.trunc(row.appearances)} apps` : ''}`);
                    caption = [
                        `${snapshot.league} top scorers update`,
                        `Updated: ${updatedStamp} (${scheduleTimezone})`,
                        ...rows,
                        'For full tables and fixtures: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    const key = this.buildTrendContentKey('top_scorer', `${trendDateKey}|${snapshot.league}|${snapshot.rows
                        .map((row) => `${row.player}:${row.goals}:${row.appearances ?? '-'}`)
                        .join('|')}`);
                    if (trendRecentSet.has(key)) {
                        selectedContentType = 'news';
                        restoreNewsBaseline();
                    }
                    else {
                        trendContentKey = key;
                        usedTrendKeys.push(key);
                        setUnifiedCaption();
                        const topScorersImageDataUrl = await this.createTopScorersImageDataUrl(snapshot);
                        if (topScorersImageDataUrl) {
                            imageUrls = [topScorersImageDataUrl];
                        }
                        else {
                            imageUrls = await this.generateFootballCardImage(`Design a modern ${snapshot.league} top scorers card with player names, clubs, and goals.`, new Set(this.getRecentImageHistory(job)));
                        }
                    }
                }
                else {
                    selectedContentType = 'news';
                }
            }
            if (selectedContentType === 'video') {
                const videoSelection = this.pickFreshVideoCandidate(footballCandidates, trendRecentSet);
                if (videoSelection) {
                    const updatedStamp = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                        timeZone: scheduleTimezone,
                    });
                    const source = videoSelection.item.sourceLabel || videoSelection.candidate.sources?.[0] || 'Football source';
                    const title = videoSelection.item.title || videoSelection.candidate.topic || 'Football highlight';
                    caption = [
                        'Football video highlight',
                        title,
                        `Source: ${source}`,
                        `Updated: ${updatedStamp} (${scheduleTimezone})`,
                        'More football updates: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    setUnifiedCaption();
                    trendContentKey = videoSelection.key;
                    usedTrendKeys.push(videoSelection.key);
                    const pickedVideoUrl = videoSelection.item.videoUrl?.trim();
                    if (pickedVideoUrl) {
                        const nextVideoPool = [pickedVideoUrl, ...sourceVideoUrls].filter(Boolean);
                        sourceVideoUrls.length = 0;
                        sourceVideoUrls.push(...Array.from(new Set(nextVideoPool)).slice(0, 10));
                    }
                    const resolvedImage = await this.resolveBestNewsImageUrl(videoSelection.item.imageUrl?.trim(), videoSelection.item.link?.trim());
                    if (resolvedImage) {
                        imageUrls = [resolvedImage];
                    }
                    else if (!imageUrls.length) {
                        imageUrls = await this.generateFootballCardImage(`Create a football highlight poster image for "${title}". High-energy action style with clean headline space.`, new Set(this.getRecentImageHistory(job)));
                    }
                }
                else {
                    const updatedStamp = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                        timeZone: scheduleTimezone,
                    });
                    caption = [
                        'Football video highlight',
                        'Top clip from trusted football sources',
                        `Updated: ${updatedStamp} (${scheduleTimezone})`,
                        'More football updates: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    setUnifiedCaption();
                }
            }
            if (selectedContentType === 'result') {
                const resultEntries = this.extractResultEntries(footballCandidates, trendRecentSet);
                const selectedResult = resultEntries[0];
                if (selectedResult) {
                    const updatedStamp = new Date().toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                        timeZone: scheduleTimezone,
                    });
                    const source = selectedResult.item.sourceLabel || selectedResult.candidate.sources?.[0] || 'Football source';
                    caption = [
                        'Latest result update',
                        `Updated: ${updatedStamp} (${scheduleTimezone})`,
                        selectedResult.item.title,
                        `Source: ${source}`,
                        'More fixtures and updates: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    trendContentKey = selectedResult.key;
                    usedTrendKeys.push(selectedResult.key);
                    setUnifiedCaption();
                    if (selectedResult.item.imageUrl?.trim()) {
                        imageUrls = [selectedResult.item.imageUrl.trim()];
                    }
                    else {
                        imageUrls = await this.generateFootballCardImage(`Create a football scorecard image for this result: "${selectedResult.item.title}". Editorial sports style, clear score emphasis.`, new Set(this.getRecentImageHistory(job)));
                    }
                }
                else {
                    selectedContentType = 'news';
                }
            }
            if (selectedContentType === 'news') {
                const staleStructuredCaption = /(live table update|top scorers update|football predictions update|latest result update)/i.test(caption);
                if (staleStructuredCaption) {
                    restoreNewsBaseline();
                }
                const currentNewsKey = topCandidate ? this.buildNewsCandidateKey(topCandidate, topItem) : '';
                const currentNewsFresh = Boolean(currentNewsKey) && !trendRecentSet.has(currentNewsKey);
                const freshNews = this.pickFreshNewsCandidate(footballCandidates, trendRecentSet);
                const effectiveNewsCandidate = currentNewsFresh ? topCandidate : freshNews?.candidate;
                const effectiveNewsItem = currentNewsFresh ? topItem : freshNews?.item;
                const effectiveNewsKey = currentNewsFresh ? currentNewsKey : freshNews?.key;
                if (effectiveNewsCandidate && (!caption || !currentNewsFresh || staleStructuredCaption)) {
                    const source = effectiveNewsItem?.sourceLabel || effectiveNewsCandidate.sources?.[0] || 'Football source';
                    const headline = effectiveNewsItem?.title || effectiveNewsCandidate.topic;
                    trendTopic = effectiveNewsCandidate.topic || trendTopic;
                    caption = [
                        headline,
                        `Source: ${source}`,
                        `Update time: ${this.formatTrendClock(scheduleTimezone)} EAT`,
                        'More football updates: www.bwinbetug.info',
                    ]
                        .filter(Boolean)
                        .join('\n');
                    setUnifiedCaption();
                    const resolvedImage = await this.resolveBestNewsImageUrl(effectiveNewsItem?.imageUrl?.trim(), effectiveNewsItem?.link?.trim());
                    if (resolvedImage) {
                        imageUrls = [resolvedImage];
                    }
                }
                if (!caption) {
                    caption = topCandidate?.topic
                        ? `${topCandidate.topic}\n\nMore football updates: www.bwinbetug.info`
                        : this.buildFootballFallbackCaption(undefined, selectedContentType, scheduleTimezone);
                    setUnifiedCaption();
                }
                if (effectiveNewsKey && !trendRecentSet.has(effectiveNewsKey)) {
                    trendContentKey = effectiveNewsKey;
                    usedTrendKeys.push(effectiveNewsKey);
                }
                if (!imageUrls.length && trendTopic) {
                    imageUrls = await this.generateFootballCardImage(`Create a football breaking-news poster image for "${trendTopic}". Clean typography space, dynamic stadium atmosphere.`, new Set(this.getRecentImageHistory(job)));
                }
            }
        }
        if (scope === 'football' && selectedContentType === 'news' && imageUrls.length) {
            imageUrls = await this.improveNewsImageQuality(imageUrls, platforms);
        }
        // Football trend videos must come from approved source feeds/highlight tweets only.
        // No local/static fallback videos are allowed in this path.
        const genericVideoSelection = this.selectNextGenericVideo(job, []);
        const trendVideoUrl = sourceVideoUrls[0] || (scope === 'football' ? undefined : genericVideoSelection.videoUrl);
        const videoCapablePlatforms = new Set(['twitter', 'x', 'facebook', 'facebook_story', 'linkedin']);
        const hasXPlatform = platforms.some(platform => platform === 'x' || platform === 'twitter');
        const shouldUseVideoMode = scope === 'football' && selectedContentType === 'video';
        const weeklyAwardsEnabled = scope === 'football' && job.xWeeklyAwardsEnabled === true;
        const weeklyAwardsOnly = weeklyAwardsEnabled && job.xWeeklyAwardsOnly === true;
        let xHighlight = null;
        if (shouldUseVideoMode && hasXPlatform) {
            try {
                xHighlight = await this.pickFootballHighlightForX(job, credentials, {
                    preferWeeklyAwards: weeklyAwardsEnabled,
                    weeklyAwardsOnly,
                    rotateAccounts: true,
                });
            }
            catch (error) {
                console.warn('[autopost] x highlight lookup failed; continuing with direct video fallback', error instanceof Error ? error.message : error);
            }
        }
        let usedXHighlightTweetId = null;
        let usedXHighlightUsername = null;
        let usedXHighlightAccountCursor = null;
        let usedXWeeklyAwardTweetId = null;
        const nextRecord = {
            trendLastRunAt: admin.firestore.Timestamp.now(),
            trendNextRun: admin.firestore.Timestamp.fromDate(nextRunDate),
            trendLastResult: results,
            ...(!sourceVideoUrls[0] && trendVideoUrl && typeof genericVideoSelection.nextCursor === 'number'
                ? { videoCursor: genericVideoSelection.nextCursor }
                : {}),
        };
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
                const rawPerPlatformCaption = trendCaptions[platform] || caption;
                const perPlatformCaption = platform === 'x' || platform === 'twitter'
                    ? this.normalizeXCaption(rawPerPlatformCaption)
                    : rawPerPlatformCaption;
                if (shouldUseVideoMode && (platform === 'x' || platform === 'twitter') && xHighlight?.tweetId) {
                    const relatedCaption = this.normalizeXCaption(xHighlight.isWeeklyAward
                        ? `${this.buildVideoCaptionFromHighlight(xHighlight.text || '', xHighlight.username, scheduleTimezone)}\nWeekly award clip`
                        : this.buildVideoCaptionFromHighlight(xHighlight.text || '', xHighlight.username, scheduleTimezone));
                    const quoteCaption = relatedCaption;
                    let response = null;
                    let finalCaption = quoteCaption;
                    try {
                        response = await publisher({
                            caption: quoteCaption,
                            imageUrls: [],
                            quoteTweetId: xHighlight.tweetId,
                            credentials,
                        });
                    }
                    catch (quoteError) {
                        const forbidden = Number(quoteError?.code ?? quoteError?.status) === 403;
                        if (!forbidden)
                            throw quoteError;
                        const sourceVideoUrl = await this.resolveVideoUrlFromTweet(xHighlight.tweetId, credentials);
                        if (!sourceVideoUrl)
                            throw quoteError;
                        finalCaption = this.normalizeXCaption(this.buildVideoCaptionFromHighlight(xHighlight.text || '', xHighlight.username, scheduleTimezone));
                        response = await publisher({
                            caption: finalCaption,
                            imageUrls: [],
                            videoUrl: sourceVideoUrl,
                            credentials,
                        });
                    }
                    results.push({ platform, status: 'posted', remoteId: response.remoteId ?? null });
                    historyEntries.push({
                        platform,
                        status: 'posted',
                        caption: finalCaption,
                        remoteId: response.remoteId ?? null,
                    });
                    usedXHighlightTweetId = xHighlight.tweetId;
                    usedXHighlightUsername = xHighlight.username;
                    if (typeof xHighlight.nextCursor === 'number') {
                        usedXHighlightAccountCursor = xHighlight.nextCursor;
                    }
                    if (xHighlight.isWeeklyAward) {
                        usedXWeeklyAwardTweetId = xHighlight.tweetId;
                    }
                    if (!trendContentKey) {
                        trendContentKey = this.buildTrendContentKey('video', `${xHighlight.username}|${xHighlight.tweetId}`);
                        usedTrendKeys.push(trendContentKey);
                    }
                    continue;
                }
                const useVideo = shouldUseVideoMode &&
                    Boolean(trendVideoUrl) &&
                    videoCapablePlatforms.has(platform);
                const response = await publisher({
                    caption: perPlatformCaption,
                    imageUrls: useVideo ? [] : imageUrls,
                    videoUrl: useVideo ? trendVideoUrl : undefined,
                    credentials,
                });
                results.push({ platform, status: 'posted', remoteId: response.remoteId ?? null });
                historyEntries.push({
                    platform,
                    status: 'posted',
                    caption: perPlatformCaption,
                    remoteId: response.remoteId ?? null,
                    videoUrl: useVideo ? trendVideoUrl : undefined,
                });
            }
            catch (error) {
                const message = error?.message ?? 'publish_failed';
                results.push({ platform, status: 'failed', error: message });
                historyEntries.push({ platform, status: 'failed', caption, errorMessage: message });
            }
        }
        const nextRecentTrendKeys = usedTrendKeys.length
            ? this.mergeTrendRecentKeys(trendRecentKeys, usedTrendKeys)
            : trendRecentKeys;
        await autopostCollection.doc(userId).set({
            ...nextRecord,
            trendLastContentType: selectedContentType,
            ...(trendContentKey ? { trendLastContentKey: trendContentKey } : {}),
            ...(nextRecentTrendKeys.length ? { trendRecentKeys: nextRecentTrendKeys } : {}),
            ...(typeof nextTrendSlotCursor === 'number' ? { trendSlotCursor: nextTrendSlotCursor } : {}),
            ...(typeof usedTableCursor === 'number' ? { trendTableCursor: usedTableCursor } : {}),
            ...(usedXHighlightTweetId ? { xLastHighlightTweetId: usedXHighlightTweetId } : {}),
            ...(usedXHighlightUsername ? { xLastHighlightUsername: usedXHighlightUsername } : {}),
            ...(typeof usedXHighlightAccountCursor === 'number'
                ? { xHighlightAccountCursor: usedXHighlightAccountCursor }
                : {}),
            ...(usedXWeeklyAwardTweetId ? { xLastWeeklyAwardTweetId: usedXWeeklyAwardTweetId } : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (this.useMemory) {
            const current = this.memoryStore.get(userId);
            if (current) {
                this.memoryStore.set(userId, {
                    ...current,
                    ...nextRecord,
                    trendLastContentType: selectedContentType,
                    ...(trendContentKey ? { trendLastContentKey: trendContentKey } : {}),
                    ...(nextRecentTrendKeys.length ? { trendRecentKeys: nextRecentTrendKeys } : {}),
                    ...(typeof nextTrendSlotCursor === 'number' ? { trendSlotCursor: nextTrendSlotCursor } : {}),
                    ...(typeof usedTableCursor === 'number' ? { trendTableCursor: usedTableCursor } : {}),
                    ...(usedXHighlightTweetId ? { xLastHighlightTweetId: usedXHighlightTweetId } : {}),
                    ...(usedXHighlightUsername ? { xLastHighlightUsername: usedXHighlightUsername } : {}),
                    ...(typeof usedXHighlightAccountCursor === 'number'
                        ? { xHighlightAccountCursor: usedXHighlightAccountCursor }
                        : {}),
                    ...(usedXWeeklyAwardTweetId ? { xLastWeeklyAwardTweetId: usedXWeeklyAwardTweetId } : {}),
                });
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
            const nextRunDate = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1000);
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
        const nextRunDate = new Date(Date.now() + effectiveIntervalHours * 60 * 60 * 1000);
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
    getXHighlightAccounts(job) {
        if (Array.isArray(job.xHighlightAccounts) && job.xHighlightAccounts.length) {
            const provided = job.xHighlightAccounts
                .map(value => String(value || '').replace(/^@/, '').trim())
                .filter(Boolean);
            if (provided.length)
                return provided.slice(0, 15);
        }
        return this.defaultXHighlightAccounts;
    }
    getXWeeklyAwardKeywords(job) {
        if (Array.isArray(job.xWeeklyAwardKeywords) && job.xWeeklyAwardKeywords.length) {
            const provided = job.xWeeklyAwardKeywords
                .map(value => String(value || '').toLowerCase().trim())
                .filter(Boolean);
            if (provided.length)
                return provided.slice(0, 30);
        }
        return this.defaultXWeeklyAwardKeywords;
    }
    isWeeklyAwardHighlight(text, keywords) {
        const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!normalized)
            return false;
        return keywords.some(keyword => normalized.includes(keyword));
    }
    buildTwitterClient(credentials) {
        const accessToken = credentials?.twitter?.accessToken;
        const accessSecret = credentials?.twitter?.accessSecret;
        const appKey = credentials?.twitter?.appKey ??
            credentials?.twitter?.consumerKey ??
            process.env.TWITTER_API_KEY ??
            process.env.TWITTER_CONSUMER_KEY;
        const appSecret = credentials?.twitter?.appSecret ??
            credentials?.twitter?.consumerSecret ??
            process.env.TWITTER_API_SECRET ??
            process.env.TWITTER_CONSUMER_SECRET;
        if (!accessToken || !accessSecret || !appKey || !appSecret)
            return null;
        return new TwitterApi({
            appKey,
            appSecret,
            accessToken,
            accessSecret,
        });
    }
    async resolveVideoUrlFromTweet(tweetId, credentials) {
        const client = this.buildTwitterClient(credentials);
        if (!client)
            return null;
        try {
            const detail = await client.readOnly.v2.singleTweet(tweetId, {
                expansions: ['attachments.media_keys'],
                'tweet.fields': ['attachments'],
                'media.fields': ['type', 'variants', 'url', 'preview_image_url'],
            });
            const mediaItems = Array.isArray(detail?.includes?.media) ? detail.includes.media : [];
            for (const media of mediaItems) {
                const type = String(media?.type || '').toLowerCase();
                if (type !== 'video' && type !== 'animated_gif')
                    continue;
                const variants = Array.isArray(media?.variants) ? media.variants : [];
                const mp4Variants = variants
                    .filter((variant) => String(variant?.content_type || '').toLowerCase() === 'video/mp4' && variant?.url)
                    .sort((a, b) => Number(b?.bit_rate || 0) - Number(a?.bit_rate || 0));
                if (mp4Variants.length) {
                    return String(mp4Variants[0].url).trim();
                }
            }
        }
        catch (error) {
            console.warn('[autopost] failed to resolve source video URL from tweet', { tweetId, error });
        }
        return null;
    }
    async pickFootballHighlightForX(job, credentials, options) {
        const client = this.buildTwitterClient(credentials);
        if (!client)
            return null;
        const readOnly = client.readOnly;
        const accounts = this.getXHighlightAccounts(job);
        const maxAgeHours = Math.max(job.xHighlightMaxAgeHours ?? 72, 6);
        const minCreatedAt = Date.now() - maxAgeHours * 60 * 60 * 1000;
        const lastTweetId = (job.xLastHighlightTweetId || '').trim();
        const lastWeeklyAwardTweetId = (job.xLastWeeklyAwardTweetId || '').trim();
        const weeklyAwardKeywords = this.getXWeeklyAwardKeywords(job);
        const preferWeeklyAwards = options?.preferWeeklyAwards === true;
        const weeklyAwardsOnly = options?.weeklyAwardsOnly === true;
        const rotateAccounts = options?.rotateAccounts !== false;
        const cursorRaw = Number.isFinite(job.xHighlightAccountCursor) ? job.xHighlightAccountCursor : 0;
        const startCursor = accounts.length
            ? ((Math.trunc(cursorRaw) % accounts.length) + accounts.length) % accounts.length
            : 0;
        const candidates = [];
        for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
            const username = accounts[accountIndex];
            try {
                const userLookup = await readOnly.v2.userByUsername(username);
                const authorId = userLookup?.data?.id;
                if (!authorId)
                    continue;
                const timeline = await readOnly.v2.userTimeline(authorId, {
                    max_results: 30,
                    exclude: ['replies'],
                    expansions: ['attachments.media_keys'],
                    'tweet.fields': ['created_at', 'public_metrics', 'attachments'],
                    'media.fields': ['type'],
                });
                const realData = timeline?._realData ?? {};
                const tweets = Array.isArray(realData?.data) ? realData.data : [];
                const mediaItems = Array.isArray(realData?.includes?.media) ? realData.includes.media : [];
                const mediaByKey = new Map(mediaItems
                    .filter(item => item?.media_key)
                    .map(item => [String(item.media_key), item]));
                for (const tweet of tweets) {
                    const tweetId = String(tweet?.id || '').trim();
                    if (!tweetId || (lastTweetId && tweetId === lastTweetId))
                        continue;
                    if (lastWeeklyAwardTweetId && tweetId === lastWeeklyAwardTweetId)
                        continue;
                    const createdAtMs = Date.parse(String(tweet?.created_at || ''));
                    if (Number.isFinite(createdAtMs) && createdAtMs < minCreatedAt)
                        continue;
                    const text = String(tweet?.text || '').trim();
                    const isWeeklyAward = this.isWeeklyAwardHighlight(text, weeklyAwardKeywords);
                    if (weeklyAwardsOnly && !isWeeklyAward)
                        continue;
                    const mediaKeys = Array.isArray(tweet?.attachments?.media_keys) ? tweet.attachments.media_keys : [];
                    const hasVideo = mediaKeys.some((key) => {
                        const media = mediaByKey.get(String(key));
                        const type = String(media?.type || '').toLowerCase();
                        return type === 'video' || type === 'animated_gif';
                    });
                    if (!hasVideo)
                        continue;
                    const metrics = tweet?.public_metrics ?? {};
                    const score = Number(metrics?.retweet_count ?? 0) * 1.2 +
                        Number(metrics?.like_count ?? 0) * 0.7 +
                        Number(metrics?.reply_count ?? 0) * 0.5 +
                        Number(metrics?.quote_count ?? 0) * 1.0 +
                        (preferWeeklyAwards && isWeeklyAward ? 100000 : 0);
                    candidates.push({
                        tweetId,
                        username,
                        usernameKey: username.toLowerCase(),
                        score,
                        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
                        tweetUrl: `https://x.com/${username}/status/${tweetId}`,
                        isWeeklyAward,
                        text,
                        accountIndex,
                        nextCursor: accounts.length ? ((accountIndex + 1) % accounts.length) : 0,
                    });
                }
            }
            catch (error) {
                console.warn('[autopost] x highlight lookup failed', { username, error });
            }
        }
        if (!candidates.length)
            return null;
        candidates.sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return b.createdAtMs - a.createdAtMs;
        });
        if (!rotateAccounts || !accounts.length) {
            return candidates[0];
        }
        const byAccount = new Map();
        for (const candidate of candidates) {
            const list = byAccount.get(candidate.usernameKey) ?? [];
            list.push(candidate);
            byAccount.set(candidate.usernameKey, list);
        }
        for (let offset = 0; offset < accounts.length; offset += 1) {
            const idx = (startCursor + offset) % accounts.length;
            const account = accounts[idx];
            const accountCandidates = byAccount.get(account.toLowerCase());
            if (accountCandidates?.length) {
                return accountCandidates[0];
            }
        }
        return candidates[0];
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

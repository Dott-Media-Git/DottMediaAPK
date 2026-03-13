import admin from 'firebase-admin';
import { firestore } from '../../db/firestore.js';
import { config } from '../../config.js';
import { publishToInstagram, publishToInstagramReel, publishToInstagramStory } from './socialPlatforms/instagramPublisher.js';
import { publishToFacebook, publishToFacebookStory } from './socialPlatforms/facebookPublisher.js';
import { publishToLinkedIn } from './socialPlatforms/linkedinPublisher.js';
import { publishToTwitter } from './socialPlatforms/twitterPublisher.js';
import { publishToThreads } from './socialPlatforms/threadsPublisher.js';
import { publishToTikTok } from './socialPlatforms/tiktokPublisher.js';
import { publishToYouTube } from './socialPlatforms/youtubePublisher.js';
import { socialAnalyticsService } from './socialAnalyticsService.js';
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from '../../services/socialIntegrationService.js';
import { canUsePrimarySocialDefaults } from '../../utils/socialAccess.js';
import { supabaseFallbackService } from '../../services/supabaseFallbackService.js';
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
const socialLogsCollection = firestore.collection('socialLogs');
const MAX_PER_DAY = 5;
const platformPublishers = {
    instagram: publishToInstagram,
    instagram_reels: publishToInstagramReel,
    instagram_story: publishToInstagramStory,
    facebook: publishToFacebook,
    facebook_story: publishToFacebookStory,
    linkedin: publishToLinkedIn,
    twitter: publishToTwitter,
    youtube: publishToYouTube,
    x: publishToTwitter,
    threads: publishToThreads,
    tiktok: publishToTikTok,
};
export class SocialPostingService {
    isMissingIndexError(error) {
        const err = error;
        const message = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
        return err?.code === 9 && message.includes('index');
    }
    normalizePostedPlatform(platform) {
        const raw = (platform ?? '').toLowerCase().trim();
        if (raw === 'instagram_story' || raw === 'instagram_reels')
            return 'instagram';
        if (raw === 'facebook_story')
            return 'facebook';
        if (raw === 'twitter')
            return 'x';
        return raw;
    }
    isVideoLikePost(post) {
        const platform = this.normalizePostedPlatform(String(post.platform ?? ''));
        if (post.videoUrl)
            return true;
        if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram') {
            const rawPlatform = String(post.platform ?? '').toLowerCase().trim();
            if (rawPlatform === 'instagram_reels')
                return true;
        }
        if (platform === 'x') {
            const caption = String(post.caption ?? '');
            return /(^|\n)\s*video[:\s]|video highlight|highlight clip|\bclip\b/i.test(caption);
        }
        return false;
    }
    toSeconds(value) {
        if (!value)
            return 0;
        if (typeof value.seconds === 'number')
            return value.seconds;
        if (typeof value._seconds === 'number')
            return value._seconds;
        if (typeof value.toDate === 'function')
            return Math.floor(value.toDate().getTime() / 1000);
        return 0;
    }
    async runQueue(limit = 25) {
        const now = admin.firestore.Timestamp.now();
        const pendingById = new Map();
        try {
            const pendingSnap = await scheduledPostsCollection
                .where('status', '==', 'pending')
                .where('scheduledFor', '<=', now)
                .orderBy('scheduledFor', 'asc')
                .limit(limit)
                .get();
            pendingSnap.docs.forEach(doc => {
                const data = doc.data();
                pendingById.set(doc.id, {
                    id: doc.id,
                    userId: data.userId,
                    platform: data.platform,
                    caption: data.caption,
                    hashtags: data.hashtags ?? '',
                    imageUrls: data.imageUrls ?? [],
                    videoUrl: data.videoUrl ?? undefined,
                    videoTitle: data.videoTitle ?? undefined,
                    targetDate: data.targetDate ?? new Date().toISOString().slice(0, 10),
                });
            });
        }
        catch (error) {
            console.warn('[social-posting] firestore pending queue fetch failed', error);
        }
        try {
            const fallbackPosts = await supabaseFallbackService.getPendingScheduledPosts(new Date(now.toMillis()), limit);
            fallbackPosts.forEach((post) => {
                pendingById.set(post.id, {
                    id: post.id,
                    userId: post.userId,
                    platform: post.platform,
                    caption: post.caption ?? '',
                    hashtags: post.hashtags ?? '',
                    imageUrls: post.imageUrls ?? [],
                    videoUrl: post.videoUrl ?? undefined,
                    videoTitle: post.videoTitle ?? undefined,
                    targetDate: post.targetDate ?? new Date().toISOString().slice(0, 10),
                });
            });
        }
        catch (error) {
            console.warn('[social-posting] supabase pending queue fetch failed', error);
        }
        const posts = Array.from(pendingById.values()).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
        if (!posts.length)
            return { processed: 0 };
        const counts = await this.buildCounts(posts.map(post => ({ userId: post.userId, targetDate: post.targetDate })));
        let processed = 0;
        for (const post of posts) {
            const key = `${post.userId}_${post.targetDate}`;
            const currentCount = counts.get(key) ?? 0;
            if (currentCount >= MAX_PER_DAY) {
                try {
                    await scheduledPostsCollection.doc(post.id).update({
                        status: 'skipped_limit',
                        errorMessage: 'Daily post limit reached',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                catch (error) {
                    console.warn('[social-posting] firestore skipped-limit update failed', error);
                }
                await supabaseFallbackService.updateScheduledPost(post.id, {
                    status: 'skipped_limit',
                    errorMessage: 'Daily post limit reached',
                    updatedAt: new Date(),
                });
                await this.log(post, 'skipped_limit');
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'skipped_limit' });
                continue;
            }
            try {
                // Fetch user credentials
                const userDoc = await firestore.collection('users').doc(post.userId).get();
                const userData = userDoc.data();
                const allowDefaults = canUsePrimarySocialDefaults(userData);
                const socialAccounts = this.mergeWithDefaults(userData?.socialAccounts, allowDefaults);
                if (post.platform === 'youtube') {
                    const youtubeIntegration = await getYouTubeIntegrationSecrets(post.userId);
                    if (youtubeIntegration) {
                        socialAccounts.youtube = {
                            refreshToken: youtubeIntegration.refreshToken,
                            accessToken: youtubeIntegration.accessToken,
                            privacyStatus: youtubeIntegration.privacyStatus,
                            channelId: youtubeIntegration.channelId ?? undefined,
                        };
                    }
                }
                if (post.platform === 'tiktok') {
                    const tiktokIntegration = await getTikTokIntegrationSecrets(post.userId);
                    if (tiktokIntegration) {
                        socialAccounts.tiktok = {
                            accessToken: tiktokIntegration.accessToken,
                            refreshToken: tiktokIntegration.refreshToken,
                            openId: tiktokIntegration.openId ?? undefined,
                        };
                    }
                }
                if ((post.platform === 'youtube' || post.platform === 'tiktok' || post.platform === 'instagram_reels') && !post.videoUrl) {
                    await scheduledPostsCollection.doc(post.id).update({
                        status: 'failed',
                        errorMessage: post.platform === 'youtube'
                            ? 'Missing YouTube video URL'
                            : post.platform === 'tiktok'
                                ? 'Missing TikTok video URL'
                                : 'Missing Instagram Reels video URL',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    await this.log(post, 'failed', undefined, post.platform === 'youtube'
                        ? 'Missing YouTube video URL'
                        : post.platform === 'tiktok'
                            ? 'Missing TikTok video URL'
                            : 'Missing Instagram Reels video URL');
                    await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
                    continue;
                }
                const publisher = platformPublishers[post.platform] ?? publishToTwitter;
                const payload = {
                    caption: [post.caption, post.hashtags].filter(Boolean).join('\n\n'),
                    imageUrls: post.imageUrls,
                    videoUrl: post.videoUrl,
                    videoTitle: post.videoTitle,
                    credentials: socialAccounts,
                };
                const response = await this.publishWithRetry(publisher, payload);
                try {
                    await scheduledPostsCollection.doc(post.id).update({
                        status: 'posted',
                        postedAt: admin.firestore.FieldValue.serverTimestamp(),
                        remoteId: response.remoteId ?? null,
                    });
                }
                catch (error) {
                    console.warn('[social-posting] firestore posted update failed', error);
                }
                await supabaseFallbackService.updateScheduledPost(post.id, {
                    status: 'posted',
                    postedAt: new Date(),
                    remoteId: response.remoteId ?? null,
                    updatedAt: new Date(),
                });
                counts.set(key, currentCount + 1);
                try {
                    await socialLimitsCollection.doc(key).set({
                        userId: post.userId,
                        date: post.targetDate,
                        postedCount: admin.firestore.FieldValue.increment(1),
                    }, { merge: true });
                }
                catch (error) {
                    console.warn('[social-posting] firestore social limit increment failed', error);
                }
                await supabaseFallbackService.incrementSocialLimit({
                    key,
                    userId: post.userId,
                    date: post.targetDate,
                    postedCount: 1,
                });
                await this.log(post, 'posted', response.remoteId);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'posted' });
                processed += 1;
            }
            catch (error) {
                const message = error.message ?? 'publish_failed';
                try {
                    await scheduledPostsCollection.doc(post.id).update({
                        status: 'failed',
                        errorMessage: message,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                catch (firestoreError) {
                    console.warn('[social-posting] firestore failed update failed', firestoreError);
                }
                await supabaseFallbackService.updateScheduledPost(post.id, {
                    status: 'failed',
                    errorMessage: message,
                    updatedAt: new Date(),
                });
                await this.log(post, 'failed', undefined, message);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
            }
        }
        return { processed };
    }
    async getHistory(userId, limit = 400) {
        const mergedById = new Map();
        const fallbackLimit = Math.min(Math.max(limit * 5, limit), 2500);
        try {
            let snap;
            try {
                snap = await scheduledPostsCollection
                    .where('userId', '==', userId)
                    .orderBy('createdAt', 'desc')
                    .limit(limit)
                    .get();
            }
            catch (error) {
                if (!this.isMissingIndexError(error))
                    throw error;
                snap = await scheduledPostsCollection
                    .where('userId', '==', userId)
                    .limit(fallbackLimit)
                    .get();
            }
            snap.docs.forEach(doc => {
                mergedById.set(doc.id, { id: doc.id, ...doc.data() });
            });
        }
        catch (error) {
            console.warn('[social-history] firestore history fetch failed', error);
        }
        try {
            const fallbackPosts = await supabaseFallbackService.getPostsByUser(userId, fallbackLimit);
            fallbackPosts.forEach((post) => {
                mergedById.set(post.id, post);
            });
        }
        catch (error) {
            console.warn('[social-history] supabase history fetch failed', error);
        }
        const posts = Array.from(mergedById.values());
        posts.sort((a, b) => {
            const aScore = this.toSeconds(a.createdAt) || this.toSeconds(a.postedAt) || this.toSeconds(a.scheduledFor);
            const bScore = this.toSeconds(b.createdAt) || this.toSeconds(b.postedAt) || this.toSeconds(b.scheduledFor);
            return bScore - aScore;
        });
        const trimmed = posts.slice(0, limit);
        const summary = trimmed.reduce((acc, post) => {
            acc.perPlatform[post.platform] = (acc.perPlatform[post.platform] ?? 0) + 1;
            acc.byStatus[post.status] = (acc.byStatus[post.status] ?? 0) + 1;
            return acc;
        }, { perPlatform: {}, byStatus: {} });
        const todayDate = new Date().toISOString().slice(0, 10);
        const todayPostsById = new Map();
        try {
            const todaySnap = await scheduledPostsCollection
                .where('userId', '==', userId)
                .where('targetDate', '==', todayDate)
                .where('status', '==', 'posted')
                .limit(2500)
                .get();
            todaySnap.docs.forEach(doc => {
                todayPostsById.set(doc.id, { id: doc.id, ...doc.data() });
            });
        }
        catch (error) {
            if (!this.isMissingIndexError(error)) {
                console.warn('[social-history] failed to fetch full today posts', error);
            }
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todaySeconds = Math.floor(todayStart.getTime() / 1000);
            trimmed.forEach(post => {
                if (post.status !== 'posted')
                    return false;
                const seconds = this.toSeconds(post.postedAt) ||
                    this.toSeconds(post.createdAt) ||
                    this.toSeconds(post.scheduledFor);
                if (seconds >= todaySeconds) {
                    todayPostsById.set(String(post.id ?? ''), post);
                }
            });
        }
        try {
            const fallbackToday = await supabaseFallbackService.getPostedPostsByDate(userId, todayDate, 2500);
            fallbackToday.forEach((post) => {
                todayPostsById.set(post.id, post);
            });
        }
        catch (error) {
            console.warn('[social-history] supabase today posts fetch failed', error);
        }
        const todayPosts = Array.from(todayPostsById.values()).sort((a, b) => {
            const aScore = this.toSeconds(a.postedAt) || this.toSeconds(a.createdAt) || this.toSeconds(a.scheduledFor);
            const bScore = this.toSeconds(b.postedAt) || this.toSeconds(b.createdAt) || this.toSeconds(b.scheduledFor);
            return bScore - aScore;
        });
        const todaySummary = todayPosts.reduce((acc, post) => {
            acc.totalPosted += 1;
            const platform = this.normalizePostedPlatform(String(post.platform ?? ''));
            if (platform) {
                acc.perPlatform[platform] = (acc.perPlatform[platform] ?? 0) + 1;
            }
            if (this.isVideoLikePost(post)) {
                acc.videoPosts += 1;
            }
            return acc;
        }, { date: todayDate, totalPosted: 0, videoPosts: 0, perPlatform: {} });
        return { posts: trimmed, summary, todayPosts, todaySummary };
    }
    async buildCounts(entries) {
        const set = new Map();
        const uniqueKeys = Array.from(new Set(entries.map(entry => `${entry.userId}_${entry.targetDate}`)));
        if (!uniqueKeys.length)
            return set;
        try {
            const snaps = await Promise.all(uniqueKeys.map(key => socialLimitsCollection.doc(key).get()));
            snaps.forEach((doc, index) => {
                const key = uniqueKeys[index];
                const postedCount = doc.data()?.postedCount ?? 0;
                set.set(key, postedCount);
            });
        }
        catch (error) {
            console.warn('[social-posting] firestore social limits fetch failed', error);
        }
        for (const key of uniqueKeys) {
            try {
                const fallback = await supabaseFallbackService.getSocialLimit(key);
                if (fallback) {
                    set.set(key, Math.max(set.get(key) ?? 0, fallback.postedCount ?? 0));
                }
            }
            catch (error) {
                console.warn('[social-posting] supabase social limit fetch failed', error);
            }
        }
        return set;
    }
    async log(post, status, responseId, error) {
        try {
            await socialLogsCollection.add({
                userId: post.userId,
                platform: post.platform,
                scheduledPostId: post.id,
                status,
                responseId: responseId ?? null,
                error: error ?? null,
                postedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        catch (firestoreError) {
            console.warn('[social-posting] firestore log write failed', firestoreError);
        }
        try {
            await supabaseFallbackService.addSocialLog({
                userId: post.userId,
                platform: post.platform,
                scheduledPostId: post.id,
                status,
                responseId,
                error,
            });
        }
        catch (supabaseError) {
            console.warn('[social-posting] supabase log write failed', supabaseError);
        }
    }
    async publishWithRetry(publisher, payload) {
        const attempts = 2;
        let lastError = null;
        for (let i = 0; i < attempts; i += 1) {
            try {
                return await publisher(payload);
            }
            catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        throw lastError ?? new Error('publish_failed');
    }
    mergeWithDefaults(userAccounts, allowDefaults = false) {
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
        return { ...defaults, ...(userAccounts ?? {}) };
    }
}
export const socialPostingService = new SocialPostingService();

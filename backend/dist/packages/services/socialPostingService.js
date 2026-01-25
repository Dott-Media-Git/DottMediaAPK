import admin from 'firebase-admin';
import { firestore } from '../../db/firestore.js';
import { config } from '../../config.js';
import { publishToInstagram, publishToInstagramReel, publishToInstagramStory } from './socialPlatforms/instagramPublisher.js';
import { publishToFacebook, publishToFacebookStory } from './socialPlatforms/facebookPublisher.js';
import { publishToLinkedIn } from './socialPlatforms/linkedinPublisher.js';
import { publishToTwitter } from './socialPlatforms/twitterPublisher.js';
import { publishToTikTok } from './socialPlatforms/tiktokPublisher.js';
import { publishToYouTube } from './socialPlatforms/youtubePublisher.js';
import { socialAnalyticsService } from './socialAnalyticsService.js';
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from '../../services/socialIntegrationService.js';
import { canUsePrimarySocialDefaults } from '../../utils/socialAccess.js';
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
    threads: publishToInstagram,
    tiktok: publishToTikTok,
};
export class SocialPostingService {
    isMissingIndexError(error) {
        const err = error;
        const message = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
        return err?.code === 9 && message.includes('index');
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
        const pendingSnap = await scheduledPostsCollection
            .where('status', '==', 'pending')
            .where('scheduledFor', '<=', now)
            .orderBy('scheduledFor', 'asc')
            .limit(limit)
            .get();
        const posts = pendingSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                userId: data.userId,
                platform: data.platform,
                caption: data.caption,
                hashtags: data.hashtags ?? '',
                imageUrls: data.imageUrls ?? [],
                videoUrl: data.videoUrl ?? undefined,
                videoTitle: data.videoTitle ?? undefined,
                targetDate: data.targetDate ?? new Date().toISOString().slice(0, 10),
            };
        });
        if (!posts.length)
            return { processed: 0 };
        const counts = await this.buildCounts(posts.map(post => ({ userId: post.userId, targetDate: post.targetDate })));
        let processed = 0;
        for (const post of posts) {
            const key = `${post.userId}_${post.targetDate}`;
            const currentCount = counts.get(key) ?? 0;
            if (currentCount >= MAX_PER_DAY) {
                await scheduledPostsCollection.doc(post.id).update({
                    status: 'skipped_limit',
                    errorMessage: 'Daily post limit reached',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
                await scheduledPostsCollection.doc(post.id).update({
                    status: 'posted',
                    postedAt: admin.firestore.FieldValue.serverTimestamp(),
                    remoteId: response.remoteId ?? null,
                });
                counts.set(key, currentCount + 1);
                await socialLimitsCollection.doc(key).set({
                    userId: post.userId,
                    date: post.targetDate,
                    postedCount: admin.firestore.FieldValue.increment(1),
                }, { merge: true });
                await this.log(post, 'posted', response.remoteId);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'posted' });
                processed += 1;
            }
            catch (error) {
                const message = error.message ?? 'publish_failed';
                await scheduledPostsCollection.doc(post.id).update({
                    status: 'failed',
                    errorMessage: message,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                await this.log(post, 'failed', undefined, message);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
            }
        }
        return { processed };
    }
    async getHistory(userId, limit = 100) {
        let snap;
        const fallbackLimit = Math.min(Math.max(limit * 5, limit), 500);
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
        const posts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
        return { posts: trimmed, summary };
    }
    async buildCounts(entries) {
        const set = new Map();
        const uniqueKeys = Array.from(new Set(entries.map(entry => `${entry.userId}_${entry.targetDate}`)));
        if (!uniqueKeys.length)
            return set;
        const snaps = await Promise.all(uniqueKeys.map(key => socialLimitsCollection.doc(key).get()));
        snaps.forEach((doc, index) => {
            const key = uniqueKeys[index];
            const postedCount = doc.data()?.postedCount ?? 0;
            set.set(key, postedCount);
        });
        return set;
    }
    async log(post, status, responseId, error) {
        await socialLogsCollection.add({
            userId: post.userId,
            platform: post.platform,
            scheduledPostId: post.id,
            status,
            responseId: responseId ?? null,
            error,
            postedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
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

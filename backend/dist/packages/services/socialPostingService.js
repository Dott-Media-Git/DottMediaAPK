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
import { resolveFacebookPageId } from '../../services/socialAccountResolver.js';
import { isBwinScopeUser, validateBwinSportsContent } from '../../services/bwinContentGuard.js';
import { getBwinAccountClosureMessage, getBwinAccountClosureState, isBwinAccountClosureActive, } from '../../services/bwinAccountClosureService.js';
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
const socialLogsCollection = firestore.collection('socialLogs');
const CLIENT_META_FALLBACKS = {
    acmVetCcOiTHeGk5D7eDYieamDF3: {
        pageId: '1033657279841186',
        instagramAccountId: '17841414110816982',
        instagramUsername: 'carmarketplace999',
    },
    D1iNgjLKNRaQhH35M0NmGfw1LVD2: {
        pageId: '1191303874068642',
        instagramAccountId: '17841448080672466',
        instagramUsername: 'staysphere93',
    },
    vzdH1DnfFLVjlY8bBgC26WACmmw2: {
        pageId: '1121885391014110',
        instagramAccountId: '17841412643148539',
        instagramUsername: 'gamers44life',
    },
};
const MAX_PER_DAY = 5;
const DEPRECATED_CLIENT_CAMPAIGN_USER_IDS = new Set([
    'acmVetCcOiTHeGk5D7eDYieamDF3',
    'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    'vzdH1DnfFLVjlY8bBgC26WACmmw2',
]);
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
    isBwinScopeUser(userId) {
        return isBwinScopeUser(userId);
    }
    async getRuntimeFallbackAccounts(userId) {
        const fallback = {};
        if (!this.isBwinScopeUser(userId)) {
            const clientFallback = CLIENT_META_FALLBACKS[userId];
            const token = (process.env.CLIENT_META_USER_TOKEN ?? process.env.FACEBOOK_PAGE_TOKEN ?? process.env.META_GRAPH_TOKEN ?? '').trim();
            if (!clientFallback || !token)
                return fallback;
            try {
                const resolved = await resolveFacebookPageId(token, clientFallback.pageId);
                const pageToken = resolved?.pageToken?.trim() || token;
                const pageId = resolved?.pageId?.trim() || clientFallback.pageId;
                return {
                    facebook: {
                        accessToken: pageToken,
                        pageId,
                        ...(resolved?.pageName ? { pageName: resolved.pageName } : {}),
                    },
                    instagram: {
                        accessToken: pageToken,
                        accountId: clientFallback.instagramAccountId,
                        username: clientFallback.instagramUsername,
                    },
                };
            }
            catch (error) {
                console.warn('[social-posting] client runtime credential fallback failed', {
                    userId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return fallback;
            }
        }
        const facebookToken = (process.env.BWIN_FACEBOOK_PAGE_TOKEN ?? '').trim();
        const facebookPageId = (process.env.BWIN_FACEBOOK_PAGE_ID ?? '').trim();
        if (facebookToken && facebookPageId) {
            let accessToken = facebookToken;
            let pageId = facebookPageId;
            try {
                const resolved = await resolveFacebookPageId(facebookToken, facebookPageId);
                accessToken = resolved?.pageToken?.trim() || accessToken;
                pageId = resolved?.pageId?.trim() || pageId;
            }
            catch (error) {
                console.warn('[social-posting] failed to resolve Bwin page token from fallback token', {
                    userId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            fallback.facebook = { accessToken, pageId };
        }
        const instagramToken = (process.env.BWIN_INSTAGRAM_ACCESS_TOKEN ?? '').trim();
        const instagramAccountId = (process.env.BWIN_INSTAGRAM_ACCOUNT_ID ?? '').trim();
        if (instagramToken && instagramAccountId) {
            fallback.instagram = {
                accessToken: instagramToken,
                accountId: instagramAccountId,
                username: process.env.BWIN_INSTAGRAM_USERNAME ?? undefined,
            };
        }
        const accessToken = (process.env.BWIN_X_ACCESS_TOKEN ?? '').trim();
        const accessSecret = (process.env.BWIN_X_ACCESS_SECRET ?? '').trim();
        const appKey = (process.env.BWIN_X_APP_KEY ?? '').trim();
        const appSecret = (process.env.BWIN_X_APP_SECRET ?? '').trim();
        if (accessToken && accessSecret && appKey && appSecret) {
            fallback.twitter = { accessToken, accessSecret, appKey, appSecret };
        }
        return fallback;
    }
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
    isLimitExempt(post) {
        return post.source === 'matchday_table';
    }
    isDeprecatedClientCampaignPost(post) {
        return post.source === 'client_two_hour_campaign' && DEPRECATED_CLIENT_CAMPAIGN_USER_IDS.has(post.userId);
    }
    async skipDeprecatedClientCampaignPost(post) {
        const message = 'Deprecated generated client campaign skipped; source-driven autopost is active.';
        try {
            await scheduledPostsCollection.doc(post.id).update({
                status: 'skipped_deprecated',
                errorMessage: message,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        catch (error) {
            console.warn('[social-posting] firestore deprecated campaign update failed', error);
        }
        await supabaseFallbackService.updateScheduledPost(post.id, {
            status: 'skipped_deprecated',
            errorMessage: message,
            updatedAt: new Date(),
        });
        await this.log(post, 'skipped_deprecated', undefined, message);
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
                    scheduledFor: data.scheduledFor?.toDate?.() ?? undefined,
                    source: data.source ?? undefined,
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
                    scheduledFor: post.scheduledFor ? new Date(post.scheduledFor) : undefined,
                    source: post.source ?? undefined,
                });
            });
        }
        catch (error) {
            console.warn('[social-posting] supabase pending queue fetch failed', error);
        }
        const posts = Array.from(pendingById.values()).sort((a, b) => {
            const aTime = a.scheduledFor?.getTime() ?? 0;
            const bTime = b.scheduledFor?.getTime() ?? 0;
            if (aTime !== bTime)
                return aTime - bTime;
            return a.targetDate.localeCompare(b.targetDate);
        });
        if (!posts.length)
            return { processed: 0 };
        const limitedPosts = posts.filter(post => !this.isLimitExempt(post));
        const counts = await this.buildCounts(limitedPosts.map(post => ({ userId: post.userId, targetDate: post.targetDate })));
        let processed = 0;
        for (const post of posts) {
            const key = `${post.userId}_${post.targetDate}`;
            const currentCount = counts.get(key) ?? 0;
            if (this.isDeprecatedClientCampaignPost(post)) {
                await this.skipDeprecatedClientCampaignPost(post);
                continue;
            }
            const closureState = await getBwinAccountClosureState(post.userId);
            if (closureState?.enabled && (await isBwinAccountClosureActive(post.userId))) {
                const message = getBwinAccountClosureMessage(closureState);
                try {
                    await scheduledPostsCollection.doc(post.id).update({
                        status: 'failed',
                        errorMessage: message,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                catch (error) {
                    console.warn('[social-posting] firestore bwin closure update failed', error);
                }
                await supabaseFallbackService.updateScheduledPost(post.id, {
                    status: 'failed',
                    errorMessage: message,
                    updatedAt: new Date(),
                });
                await this.log(post, 'failed', undefined, message);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
                continue;
            }
            const bwinValidation = validateBwinSportsContent({
                userId: post.userId,
                platform: post.platform,
                caption: post.caption,
                hashtags: post.hashtags,
                videoTitle: post.videoTitle,
                imageUrls: post.imageUrls,
                videoUrl: post.videoUrl,
            });
            if (!bwinValidation.ok) {
                const message = bwinValidation.reason ?? 'Bwinbet scheduled posts must stay sports-only.';
                try {
                    await scheduledPostsCollection.doc(post.id).update({
                        status: 'failed',
                        errorMessage: message,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                catch (error) {
                    console.warn('[social-posting] firestore bwin content-guard update failed', error);
                }
                await supabaseFallbackService.updateScheduledPost(post.id, {
                    status: 'failed',
                    errorMessage: message,
                    updatedAt: new Date(),
                });
                await this.log(post, 'failed', undefined, message);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
                continue;
            }
            if (!this.isLimitExempt(post) && currentCount >= MAX_PER_DAY) {
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
                let userData;
                try {
                    const userDoc = await firestore.collection('users').doc(post.userId).get();
                    userData = userDoc.data();
                    if (userData?.socialAccounts) {
                        void supabaseFallbackService.upsertSocialAccounts(post.userId, {
                            email: userData.email ?? null,
                            socialAccounts: userData.socialAccounts,
                        }).catch(error => console.warn('[social-posting] supabase social account mirror failed', error));
                    }
                }
                catch (error) {
                    console.warn('[social-posting] user lookup failed; using runtime fallback credentials', {
                        userId: post.userId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    try {
                        const fallback = await supabaseFallbackService.getSocialAccounts(post.userId);
                        if (fallback) {
                            userData = fallback;
                        }
                    }
                    catch (fallbackError) {
                        console.warn('[social-posting] supabase social account lookup failed', fallbackError);
                    }
                }
                const allowDefaults = canUsePrimarySocialDefaults(userData, post.userId);
                const socialAccounts = this.mergeWithDefaults({
                    ...(await this.getRuntimeFallbackAccounts(post.userId)),
                    ...(userData?.socialAccounts ?? {}),
                }, allowDefaults);
                if (allowDefaults && !socialAccounts.facebook && config.channels.facebook.pageToken) {
                    try {
                        const resolved = await resolveFacebookPageId(config.channels.facebook.pageToken, config.channels.facebook.pageId || undefined);
                        if (resolved?.pageId) {
                            socialAccounts.facebook = {
                                accessToken: resolved.pageToken?.trim() || config.channels.facebook.pageToken,
                                pageId: resolved.pageId,
                                ...(resolved.pageName ? { pageName: resolved.pageName } : {}),
                            };
                        }
                    }
                    catch (error) {
                        console.warn('[social-posting] failed to resolve primary facebook page from fallback token', {
                            userId: post.userId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                if (post.platform === 'youtube') {
                    try {
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
                    catch (error) {
                        console.warn('[social-posting] youtube integration lookup failed', {
                            userId: post.userId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                if (post.platform === 'tiktok') {
                    try {
                        const tiktokIntegration = await getTikTokIntegrationSecrets(post.userId);
                        if (tiktokIntegration) {
                            socialAccounts.tiktok = {
                                accessToken: tiktokIntegration.accessToken,
                                refreshToken: tiktokIntegration.refreshToken,
                                openId: tiktokIntegration.openId ?? undefined,
                            };
                        }
                    }
                    catch (error) {
                        console.warn('[social-posting] tiktok integration lookup failed', {
                            userId: post.userId,
                            error: error instanceof Error ? error.message : String(error),
                        });
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
                if (!this.isLimitExempt(post)) {
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
                }
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

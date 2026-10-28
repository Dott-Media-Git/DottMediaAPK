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
import { publishToWhatsApp, publishToWhatsAppStatus } from './socialPlatforms/whatsappPublisher.js';
import { socialAnalyticsService } from './socialAnalyticsService.js';
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from '../../services/socialIntegrationService.js';
import { canUsePrimarySocialDefaults } from '../../utils/socialAccess.js';
import { supabaseFallbackService } from '../../services/supabaseFallbackService.js';
import { resolveFacebookPageId } from '../../services/socialAccountResolver.js';
import { metaAdsService } from '../../services/metaAdsService.js';
import { isBwinScopeUser, validateBwinSportsContent } from '../../services/bwinContentGuard.js';
import { getBwinAccountClosureMessage, getBwinAccountClosureState, isBwinAccountClosureActive, } from '../../services/bwinAccountClosureService.js';
import { consumeUsageForUserId } from '../../services/billing/billingService.js';
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
const withFirestoreDeadline = (promise, label, timeoutMs = 8000) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
]);
const socialLogsCollection = firestore.collection('socialLogs');
const supabasePrimary = (process.env.PRIMARY_DATA_STORE ?? 'supabase').toLowerCase() === 'supabase';
const CLIENT_META_FALLBACKS = {
    cMPZQccGggbhZe9dbvtxFmBehP02: {
        pageId: '1371096759416007',
        instagramAccountId: '17841420336656466',
        instagramUsername: 'aux_wellness_hub',
    },
    acmVetCcOiTHeGk5D7eDYieamDF3: {
        pageId: '1191892417341226',
        instagramAccountId: '17841414110816982',
        instagramUsername: 'carmarketplace999',
    },
    D1iNgjLKNRaQhH35M0NmGfw1LVD2: {
        pageId: '1254924081027995',
        instagramAccountId: '17841448080672466',
        instagramUsername: 'staysphere93',
    },
    vzdH1DnfFLVjlY8bBgC26WACmmw2: {
        pageId: '1121885391014110',
        instagramAccountId: '17841412643148539',
        instagramUsername: 'gamers44life',
    },
    LVR7p3WzdFM51ds92Kacf6S40og2: {
        pageId: '1165009866702868',
        instagramAccountId: '',
        instagramUsername: '',
    },
};
const CLIENT_ENV_PREFIXES = {
    cMPZQccGggbhZe9dbvtxFmBehP02: 'AUXWELLNESS',
    acmVetCcOiTHeGk5D7eDYieamDF3: 'CARMARKETPLACE',
    D1iNgjLKNRaQhH35M0NmGfw1LVD2: 'STAYSPHERE',
    vzdH1DnfFLVjlY8bBgC26WACmmw2: 'GAMERS44LIFE',
    LVR7p3WzdFM51ds92Kacf6S40og2: 'DOTTENERGY',
};
const AUX_WELLNESS_USER_ID = 'cMPZQccGggbhZe9dbvtxFmBehP02';
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
    whatsapp: publishToWhatsApp,
    whatsapp_status: publishToWhatsAppStatus,
};
export class SocialPostingService {
    isBwinScopeUser(userId) {
        return isBwinScopeUser(userId);
    }
    async getRuntimeFallbackAccounts(userId) {
        const fallback = {};
        if (!this.isBwinScopeUser(userId)) {
            const clientFallback = CLIENT_META_FALLBACKS[userId];
            const prefix = CLIENT_ENV_PREFIXES[userId];
            if (clientFallback && prefix) {
                const value = (name) => (process.env[`${prefix}_${name}`] ?? '').trim();
                const facebookToken = value('FACEBOOK_PAGE_TOKEN') || value('FACEBOOK_ACCESS_TOKEN');
                const instagramToken = value('INSTAGRAM_ACCESS_TOKEN') || facebookToken;
                const instagramAccountId = value('INSTAGRAM_ACCOUNT_ID') || clientFallback.instagramAccountId;
                if (facebookToken) {
                    fallback.facebook = {
                        accessToken: facebookToken,
                        pageId: value('FACEBOOK_PAGE_ID') || clientFallback.pageId,
                    };
                }
                if (instagramToken && instagramAccountId) {
                    fallback.instagram = {
                        accessToken: instagramToken,
                        accountId: instagramAccountId,
                        username: value('INSTAGRAM_USERNAME') || clientFallback.instagramUsername,
                    };
                }
                if (fallback.facebook || fallback.instagram)
                    return fallback;
            }
            const token = ((userId === AUX_WELLNESS_USER_ID ? process.env.AUXWELLNESS_META_USER_TOKEN : '') ||
                process.env.CLIENT_META_USER_TOKEN || process.env.FACEBOOK_PAGE_TOKEN || process.env.META_GRAPH_TOKEN || '').trim();
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
    async runQueue(limit = 25, onlyUserId) {
        const now = admin.firestore.Timestamp.now();
        const pendingById = new Map();
        let supabaseQueueAvailable = true;
        try {
            const primaryPosts = await supabaseFallbackService.getPendingScheduledPosts(new Date(now.toMillis()), limit);
            primaryPosts.forEach((post) => {
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
                    billingUsageConsumed: Boolean(post.billingUsageConsumed),
                });
            });
        }
        catch (error) {
            supabaseQueueAvailable = false;
            console.warn('[social-posting] Supabase primary queue fetch failed; using Firebase fallback', error);
        }
        if (!supabaseQueueAvailable || pendingById.size === 0)
            try {
                const pendingSnap = await withFirestoreDeadline(onlyUserId
                    ? scheduledPostsCollection.where('userId', '==', onlyUserId).where('status', '==', 'pending').limit(limit).get()
                    : scheduledPostsCollection.where('status', '==', 'pending').where('scheduledFor', '<=', now).orderBy('scheduledFor', 'asc').limit(limit).get(), 'Firestore pending queue lookup');
                pendingSnap.docs.forEach(doc => {
                    const data = doc.data();
                    const scheduledFor = data.scheduledFor?.toDate?.();
                    if (scheduledFor && scheduledFor.getTime() > now.toMillis())
                        return;
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
                        scheduledFor,
                        source: data.source ?? undefined,
                        billingUsageConsumed: Boolean(data.billingUsageConsumed),
                    });
                });
            }
            catch (error) {
                console.warn('[social-posting] Firebase fallback queue fetch failed', error);
            }
        const posts = Array.from(pendingById.values()).filter(post => !onlyUserId || post.userId === onlyUserId).sort((a, b) => {
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
        const processPost = async (post) => {
            const key = `${post.userId}_${post.targetDate}`;
            const currentCount = counts.get(key) ?? 0;
            if (this.isDeprecatedClientCampaignPost(post)) {
                await this.skipDeprecatedClientCampaignPost(post);
                return;
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
                return;
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
                return;
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
                return;
            }
            try {
                // Fetch user credentials
                let userData;
                try {
                    const primary = await supabaseFallbackService.getSocialAccounts(post.userId);
                    if (primary)
                        userData = primary;
                }
                catch (error) {
                    console.warn('[social-posting] Supabase primary account lookup failed', {
                        userId: post.userId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                if (!userData?.socialAccounts) {
                    try {
                        const userDoc = await withFirestoreDeadline(firestore.collection('users').doc(post.userId).get(), 'Firebase social account fallback lookup');
                        userData = userDoc.data();
                    }
                    catch (fallbackError) {
                        console.warn('[social-posting] Firebase social account fallback failed', fallbackError);
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
                    return;
                }
                const publisher = platformPublishers[post.platform] ?? publishToTwitter;
                const payload = {
                    caption: [post.caption, post.hashtags].filter(Boolean).join('\n\n'),
                    imageUrls: post.imageUrls,
                    videoUrl: post.videoUrl,
                    videoTitle: post.videoTitle,
                    credentials: socialAccounts,
                };
                if (!post.billingUsageConsumed) {
                    if (!supabasePrimary)
                        await consumeUsageForUserId(post.userId, 'scheduledPosts', 1);
                    post.billingUsageConsumed = true;
                    try {
                        await supabaseFallbackService.updateScheduledPost(post.id, {
                            billingUsageConsumed: true,
                            updatedAt: new Date(),
                        });
                    }
                    catch (error) {
                        console.warn('[social-posting] Supabase billing marker failed; using Firebase fallback', error);
                        await withFirestoreDeadline(scheduledPostsCollection.doc(post.id).set({ billingUsageConsumed: true, billingUsageConsumedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }), 'Firebase billing marker fallback');
                    }
                }
                const response = await this.publishWithRetry(publisher, payload);
                try {
                    await supabaseFallbackService.updateScheduledPost(post.id, {
                        status: 'posted',
                        postedAt: new Date(),
                        remoteId: response.remoteId ?? null,
                        updatedAt: new Date(),
                    });
                }
                catch (error) {
                    console.warn('[social-posting] Supabase posted update failed; using Firebase fallback', error);
                    await withFirestoreDeadline(scheduledPostsCollection.doc(post.id).update({
                        status: 'posted',
                        postedAt: admin.firestore.FieldValue.serverTimestamp(),
                        remoteId: response.remoteId ?? null,
                    }), 'Firebase posted update fallback');
                }
                if (!this.isLimitExempt(post)) {
                    counts.set(key, currentCount + 1);
                    try {
                        await supabaseFallbackService.incrementSocialLimit({
                            key,
                            userId: post.userId,
                            date: post.targetDate,
                            postedCount: 1,
                        });
                    }
                    catch (error) {
                        console.warn('[social-posting] Supabase limit increment failed; using Firebase fallback', error);
                        await withFirestoreDeadline(socialLimitsCollection.doc(key).set({ userId: post.userId, date: post.targetDate, postedCount: admin.firestore.FieldValue.increment(1) }, { merge: true }), 'Firebase social limit fallback');
                    }
                }
                if (['facebook', 'instagram', 'facebook_story', 'instagram_story'].includes(post.platform) &&
                    response.remoteId) {
                    await metaAdsService.autoBoostAfterPost({
                        userId: post.userId,
                        platform: post.platform,
                        postId: response.remoteId,
                        caption: payload.caption,
                        imageUrl: post.imageUrls[0] ?? null,
                    });
                }
                await this.log(post, 'posted', response.remoteId);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'posted' });
                processed += 1;
            }
            catch (error) {
                const message = error.message ?? 'publish_failed';
                try {
                    await supabaseFallbackService.updateScheduledPost(post.id, {
                        status: 'failed',
                        errorMessage: message,
                        updatedAt: new Date(),
                    });
                }
                catch (supabaseError) {
                    console.warn('[social-posting] Supabase failed update failed; using Firebase fallback', supabaseError);
                    await withFirestoreDeadline(scheduledPostsCollection.doc(post.id).update({
                        status: 'failed',
                        errorMessage: message,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }), 'Firebase failed update fallback');
                }
                await this.log(post, 'failed', undefined, message);
                await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
            }
        };
        if (onlyUserId) {
            await Promise.all(posts.map(post => processPost(post)));
        }
        else {
            for (const post of posts)
                await processPost(post);
        }
        return { processed };
    }
    async getHistory(userId, limit = 400) {
        const mergedById = new Map();
        const fallbackLimit = Math.min(Math.max(limit * 5, limit), 2500);
        let supabaseHistoryAvailable = true;
        try {
            const primaryPosts = await supabaseFallbackService.getPostsByUser(userId, fallbackLimit);
            primaryPosts.forEach((post) => mergedById.set(post.id, post));
        }
        catch (error) {
            supabaseHistoryAvailable = false;
            console.warn('[social-history] Supabase primary history fetch failed; using Firebase fallback', error);
        }
        if (!supabaseHistoryAvailable || mergedById.size === 0)
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
                console.warn('[social-history] Firebase fallback history fetch failed', error);
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
        for (const key of uniqueKeys) {
            try {
                const primary = await supabaseFallbackService.getSocialLimit(key);
                if (primary)
                    set.set(key, primary.postedCount ?? 0);
            }
            catch (error) {
                console.warn('[social-posting] Supabase primary social limit fetch failed; using Firebase fallback', error);
                try {
                    const doc = await withFirestoreDeadline(socialLimitsCollection.doc(key).get(), 'Firebase social limit fallback');
                    set.set(key, doc.data()?.postedCount ?? 0);
                }
                catch (fallbackError) {
                    console.warn('[social-posting] Firebase social limit fallback failed', fallbackError);
                }
            }
        }
        return set;
    }
    async log(post, status, responseId, error) {
        try {
            await supabaseFallbackService.addSocialLog({
                userId: post.userId,
                platform: post.platform,
                scheduledPostId: post.id,
                status,
                responseId,
                error: error ?? undefined,
            });
        }
        catch (supabaseError) {
            console.warn('[social-posting] Supabase log failed; using Firebase fallback', supabaseError);
            await withFirestoreDeadline(socialLogsCollection.add({
                userId: post.userId,
                platform: post.platform,
                scheduledPostId: post.id,
                status,
                responseId: responseId ?? null,
                error: error ?? null,
                postedAt: admin.firestore.FieldValue.serverTimestamp(),
            }), 'Firebase social log fallback');
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
        if (allowDefaults && config.whatsapp.token && config.whatsapp.phoneNumberId) {
            defaults.whatsapp = {
                accessToken: config.whatsapp.token,
                phoneNumberId: config.whatsapp.phoneNumberId,
                recipientPhoneNumbers: process.env.WHATSAPP_RECIPIENT_PHONE_NUMBERS ?? '',
            };
        }
        return { ...defaults, ...(userAccounts ?? {}) };
    }
}
export const socialPostingService = new SocialPostingService();

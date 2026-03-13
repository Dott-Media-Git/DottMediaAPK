import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';
import { config } from '../../config';
import { publishToInstagram, publishToInstagramReel, publishToInstagramStory } from './socialPlatforms/instagramPublisher';
import { publishToFacebook, publishToFacebookStory } from './socialPlatforms/facebookPublisher';
import { publishToLinkedIn } from './socialPlatforms/linkedinPublisher';
import { publishToTwitter } from './socialPlatforms/twitterPublisher';
import { publishToThreads } from './socialPlatforms/threadsPublisher';
import { publishToTikTok } from './socialPlatforms/tiktokPublisher';
import { publishToYouTube } from './socialPlatforms/youtubePublisher';
import { socialAnalyticsService } from './socialAnalyticsService';
import { getTikTokIntegrationSecrets, getYouTubeIntegrationSecrets } from '../../services/socialIntegrationService';
import { canUsePrimarySocialDefaults } from '../../utils/socialAccess';
import { supabaseFallbackService } from '../../services/supabaseFallbackService';

const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
const socialLogsCollection = firestore.collection('socialLogs');

const MAX_PER_DAY = 5;

type ScheduledPost = {
  id: string;
  userId: string;
  platform: string;
  caption: string;
  hashtags?: string;
  imageUrls: string[];
  videoUrl?: string;
  videoTitle?: string;
  targetDate: string;
};

export interface SocialAccounts {
  facebook?: { accessToken: string; userAccessToken?: string; pageId: string; pageName?: string };
  instagram?: { accessToken: string; accountId: string; username?: string };
  threads?: { accessToken: string; accountId: string; username?: string };
  linkedin?: { accessToken: string; urn: string };
  twitter?: {
    accessToken: string;
    accessSecret: string;
    // Optional per-user X app credentials. When provided, they override the server-wide TWITTER_API_KEY/SECRET.
    appKey?: string;
    appSecret?: string;
    consumerKey?: string;
    consumerSecret?: string;
  };
  tiktok?: {
    accessToken: string;
    openId?: string;
    refreshToken?: string;
    clientKey?: string;
    clientSecret?: string;
  };
  youtube?: {
    refreshToken: string;
    accessToken?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    privacyStatus?: 'private' | 'public' | 'unlisted';
    channelId?: string;
  };
  [key: string]: any;
}

type PublishPayload = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  videoTitle?: string;
  privacyStatus?: 'private' | 'public' | 'unlisted';
  credentials?: SocialAccounts;
};
type PlatformPublisher = (input: PublishPayload) => Promise<{ remoteId?: string }>;

const platformPublishers: Record<string, PlatformPublisher> = {
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
  private getBwinScopeId() {
    return (process.env.BWIN_SCOPE_ID ?? process.env.BWIN_TRACK_OWNER_ID ?? '').trim();
  }

  private isBwinScopeUser(userId: string) {
    const bwinScopeId = this.getBwinScopeId();
    return Boolean(bwinScopeId) && userId.trim() === bwinScopeId;
  }

  private getRuntimeFallbackAccounts(userId: string): SocialAccounts {
    const fallback: SocialAccounts = {};
    if (!this.isBwinScopeUser(userId)) return fallback;

    const facebookToken = (process.env.BWIN_FACEBOOK_PAGE_TOKEN ?? '').trim();
    const facebookPageId = (process.env.BWIN_FACEBOOK_PAGE_ID ?? '').trim();
    if (facebookToken && facebookPageId) {
      fallback.facebook = { accessToken: facebookToken, pageId: facebookPageId };
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

  private isMissingIndexError(error: unknown) {
    const err = error as { code?: number; message?: string; details?: string };
    const message = `${err?.message ?? ''} ${err?.details ?? ''}`.toLowerCase();
    return err?.code === 9 && message.includes('index');
  }

  private normalizePostedPlatform(platform?: string) {
    const raw = (platform ?? '').toLowerCase().trim();
    if (raw === 'instagram_story' || raw === 'instagram_reels') return 'instagram';
    if (raw === 'facebook_story') return 'facebook';
    if (raw === 'twitter') return 'x';
    return raw;
  }

  private isVideoLikePost(post: Record<string, unknown>) {
    const platform = this.normalizePostedPlatform(String(post.platform ?? ''));
    if (post.videoUrl) return true;
    if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram') {
      const rawPlatform = String(post.platform ?? '').toLowerCase().trim();
      if (rawPlatform === 'instagram_reels') return true;
    }
    if (platform === 'x') {
      const caption = String(post.caption ?? '');
      return /(^|\n)\s*video[:\s]|video highlight|highlight clip|\bclip\b/i.test(caption);
    }
    return false;
  }

  private toSeconds(value: any) {
    if (!value) return 0;
    if (typeof value.seconds === 'number') return value.seconds;
    if (typeof value._seconds === 'number') return value._seconds;
    if (typeof value.toDate === 'function') return Math.floor(value.toDate().getTime() / 1000);
    return 0;
  }

  async runQueue(limit = 25) {
    const now = admin.firestore.Timestamp.now();
    const pendingById = new Map<string, ScheduledPost>();
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
          userId: data.userId as string,
          platform: data.platform as string,
          caption: data.caption as string,
          hashtags: (data.hashtags as string) ?? '',
          imageUrls: (data.imageUrls as string[]) ?? [],
          videoUrl: (data.videoUrl as string | undefined) ?? undefined,
          videoTitle: (data.videoTitle as string | undefined) ?? undefined,
          targetDate: (data.targetDate as string) ?? new Date().toISOString().slice(0, 10),
        });
      });
    } catch (error) {
      console.warn('[social-posting] firestore pending queue fetch failed', error);
    }
    try {
      const fallbackPosts = await supabaseFallbackService.getPendingScheduledPosts(new Date(now.toMillis()), limit);
      fallbackPosts.forEach((post: any) => {
        pendingById.set(post.id as string, {
          id: post.id as string,
          userId: post.userId as string,
          platform: post.platform as string,
          caption: (post.caption as string) ?? '',
          hashtags: (post.hashtags as string) ?? '',
          imageUrls: (post.imageUrls as string[]) ?? [],
          videoUrl: (post.videoUrl as string | undefined) ?? undefined,
          videoTitle: (post.videoTitle as string | undefined) ?? undefined,
          targetDate: (post.targetDate as string) ?? new Date().toISOString().slice(0, 10),
        });
      });
    } catch (error) {
      console.warn('[social-posting] supabase pending queue fetch failed', error);
    }
    const posts = Array.from(pendingById.values()).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    if (!posts.length) return { processed: 0 };

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
        } catch (error) {
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
        let userData: { email?: string | null; socialAccounts?: SocialAccounts } | undefined;
        try {
          const userDoc = await firestore.collection('users').doc(post.userId).get();
          userData = userDoc.data() as { email?: string | null; socialAccounts?: SocialAccounts } | undefined;
        } catch (error) {
          console.warn('[social-posting] user lookup failed; using runtime fallback credentials', {
            userId: post.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const allowDefaults = canUsePrimarySocialDefaults(userData, post.userId);
        const socialAccounts = this.mergeWithDefaults(
          {
            ...this.getRuntimeFallbackAccounts(post.userId),
            ...((userData?.socialAccounts as SocialAccounts | undefined) ?? {}),
          },
          allowDefaults,
        );
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
          } catch (error) {
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
          } catch (error) {
            console.warn('[social-posting] tiktok integration lookup failed', {
              userId: post.userId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if ((post.platform === 'youtube' || post.platform === 'tiktok' || post.platform === 'instagram_reels') && !post.videoUrl) {
          await scheduledPostsCollection.doc(post.id).update({
            status: 'failed',
            errorMessage:
              post.platform === 'youtube'
                ? 'Missing YouTube video URL'
                : post.platform === 'tiktok'
                  ? 'Missing TikTok video URL'
                  : 'Missing Instagram Reels video URL',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await this.log(
            post,
            'failed',
            undefined,
            post.platform === 'youtube'
              ? 'Missing YouTube video URL'
              : post.platform === 'tiktok'
                ? 'Missing TikTok video URL'
                : 'Missing Instagram Reels video URL',
          );
          await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'failed' });
          continue;
        }

        const publisher = platformPublishers[post.platform] ?? publishToTwitter;
        const payload: PublishPayload = {
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
        } catch (error) {
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
          await socialLimitsCollection.doc(key).set(
            {
              userId: post.userId,
              date: post.targetDate,
              postedCount: admin.firestore.FieldValue.increment(1),
            },
            { merge: true },
          );
        } catch (error) {
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
      } catch (error) {
        const message = (error as Error).message ?? 'publish_failed';
        try {
          await scheduledPostsCollection.doc(post.id).update({
            status: 'failed',
            errorMessage: message,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (firestoreError) {
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

  async getHistory(userId: string, limit = 400) {
    const mergedById = new Map<string, Record<string, unknown>>();
    const fallbackLimit = Math.min(Math.max(limit * 5, limit), 2500);
    try {
      let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
      try {
        snap = await scheduledPostsCollection
          .where('userId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();
      } catch (error) {
        if (!this.isMissingIndexError(error)) throw error;
        snap = await scheduledPostsCollection
          .where('userId', '==', userId)
          .limit(fallbackLimit)
          .get();
      }
      snap.docs.forEach(doc => {
        mergedById.set(doc.id, { id: doc.id, ...(doc.data() as Record<string, unknown>) });
      });
    } catch (error) {
      console.warn('[social-history] firestore history fetch failed', error);
    }
    try {
      const fallbackPosts = await supabaseFallbackService.getPostsByUser(userId, fallbackLimit);
      fallbackPosts.forEach((post: any) => {
        mergedById.set(post.id as string, post as Record<string, unknown>);
      });
    } catch (error) {
      console.warn('[social-history] supabase history fetch failed', error);
    }
    const posts = Array.from(mergedById.values());
    posts.sort((a: any, b: any) => {
      const aScore = this.toSeconds(a.createdAt) || this.toSeconds(a.postedAt) || this.toSeconds(a.scheduledFor);
      const bScore = this.toSeconds(b.createdAt) || this.toSeconds(b.postedAt) || this.toSeconds(b.scheduledFor);
      return bScore - aScore;
    });
    const trimmed = posts.slice(0, limit);
    const summary = trimmed.reduce<{
      perPlatform: Record<string, number>;
      byStatus: Record<string, number>;
    }>(
      (acc, post: any) => {
        acc.perPlatform[post.platform] = (acc.perPlatform[post.platform] ?? 0) + 1;
        acc.byStatus[post.status] = (acc.byStatus[post.status] ?? 0) + 1;
        return acc;
      },
      { perPlatform: {} as Record<string, number>, byStatus: {} as Record<string, number> },
    );

    const todayDate = new Date().toISOString().slice(0, 10);
    const todayPostsById = new Map<string, Record<string, unknown>>();
    try {
      const todaySnap = await scheduledPostsCollection
        .where('userId', '==', userId)
        .where('targetDate', '==', todayDate)
        .where('status', '==', 'posted')
        .limit(2500)
        .get();
      todaySnap.docs.forEach(doc => {
        todayPostsById.set(doc.id, { id: doc.id, ...(doc.data() as Record<string, unknown>) });
      });
    } catch (error) {
      if (!this.isMissingIndexError(error)) {
        console.warn('[social-history] failed to fetch full today posts', error);
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todaySeconds = Math.floor(todayStart.getTime() / 1000);
      trimmed.forEach(post => {
        if ((post as any).status !== 'posted') return false;
        const seconds =
          this.toSeconds((post as any).postedAt) ||
          this.toSeconds((post as any).createdAt) ||
          this.toSeconds((post as any).scheduledFor);
        if (seconds >= todaySeconds) {
          todayPostsById.set(String((post as any).id ?? ''), post as Record<string, unknown>);
        }
      });
    }
    try {
      const fallbackToday = await supabaseFallbackService.getPostedPostsByDate(userId, todayDate, 2500);
      fallbackToday.forEach((post: any) => {
        todayPostsById.set(post.id as string, post as Record<string, unknown>);
      });
    } catch (error) {
      console.warn('[social-history] supabase today posts fetch failed', error);
    }
    const todayPosts = Array.from(todayPostsById.values()).sort((a, b) => {
      const aScore = this.toSeconds((a as any).postedAt) || this.toSeconds((a as any).createdAt) || this.toSeconds((a as any).scheduledFor);
      const bScore = this.toSeconds((b as any).postedAt) || this.toSeconds((b as any).createdAt) || this.toSeconds((b as any).scheduledFor);
      return bScore - aScore;
    });

    const todaySummary = todayPosts.reduce<{
      date: string;
      totalPosted: number;
      videoPosts: number;
      perPlatform: Record<string, number>;
    }>(
      (acc, post) => {
        acc.totalPosted += 1;
        const platform = this.normalizePostedPlatform(String(post.platform ?? ''));
        if (platform) {
          acc.perPlatform[platform] = (acc.perPlatform[platform] ?? 0) + 1;
        }
        if (this.isVideoLikePost(post)) {
          acc.videoPosts += 1;
        }
        return acc;
      },
      { date: todayDate, totalPosted: 0, videoPosts: 0, perPlatform: {} as Record<string, number> },
    );

    return { posts: trimmed, summary, todayPosts, todaySummary };
  }

  private async buildCounts(entries: Array<{ userId: string; targetDate: string }>) {
    const set = new Map<string, number>();
    const uniqueKeys = Array.from(new Set(entries.map(entry => `${entry.userId}_${entry.targetDate}`)));
    if (!uniqueKeys.length) return set;
    try {
      const snaps = await Promise.all(uniqueKeys.map(key => socialLimitsCollection.doc(key).get()));
      snaps.forEach((doc, index) => {
        const key = uniqueKeys[index];
        const postedCount = (doc.data()?.postedCount as number) ?? 0;
        set.set(key, postedCount);
      });
    } catch (error) {
      console.warn('[social-posting] firestore social limits fetch failed', error);
    }
    for (const key of uniqueKeys) {
      try {
        const fallback = await supabaseFallbackService.getSocialLimit(key);
        if (fallback) {
          set.set(key, Math.max(set.get(key) ?? 0, fallback.postedCount ?? 0));
        }
      } catch (error) {
        console.warn('[social-posting] supabase social limit fetch failed', error);
      }
    }
    return set;
  }

  private async log(post: ScheduledPost, status: string, responseId?: string, error?: string) {
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
    } catch (firestoreError) {
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
    } catch (supabaseError) {
      console.warn('[social-posting] supabase log write failed', supabaseError);
    }
  }

  private async publishWithRetry(publisher: PlatformPublisher, payload: PublishPayload) {
    const attempts = 2;
    let lastError: Error | null = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await publisher(payload);
      } catch (error) {
        lastError = error as Error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    throw lastError ?? new Error('publish_failed');
  }

  private mergeWithDefaults(userAccounts?: SocialAccounts, allowDefaults = false): SocialAccounts {
    const defaults: SocialAccounts = {};
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

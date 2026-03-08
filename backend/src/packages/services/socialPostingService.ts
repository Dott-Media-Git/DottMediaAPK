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
    const pendingSnap = await scheduledPostsCollection
      .where('status', '==', 'pending')
      .where('scheduledFor', '<=', now)
      .orderBy('scheduledFor', 'asc')
      .limit(limit)
      .get();

    const posts: ScheduledPost[] = pendingSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId as string,
        platform: data.platform as string,
        caption: data.caption as string,
        hashtags: (data.hashtags as string) ?? '',
        imageUrls: (data.imageUrls as string[]) ?? [],
        videoUrl: (data.videoUrl as string | undefined) ?? undefined,
        videoTitle: (data.videoTitle as string | undefined) ?? undefined,
        targetDate: (data.targetDate as string) ?? new Date().toISOString().slice(0, 10),
      };
    });
    if (!posts.length) return { processed: 0 };

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
        const allowDefaults = canUsePrimarySocialDefaults(userData as { email?: string | null } | undefined);
        const socialAccounts = this.mergeWithDefaults(
          userData?.socialAccounts as SocialAccounts | undefined,
          allowDefaults,
        );
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
        await scheduledPostsCollection.doc(post.id).update({
          status: 'posted',
          postedAt: admin.firestore.FieldValue.serverTimestamp(),
          remoteId: response.remoteId ?? null,
        });
        counts.set(key, currentCount + 1);
        await socialLimitsCollection.doc(key).set(
          {
            userId: post.userId,
            date: post.targetDate,
            postedCount: admin.firestore.FieldValue.increment(1),
          },
          { merge: true },
        );
        await this.log(post, 'posted', response.remoteId);
        await socialAnalyticsService.incrementDaily({ userId: post.userId, platform: post.platform, status: 'posted' });
        processed += 1;
      } catch (error) {
        const message = (error as Error).message ?? 'publish_failed';
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

  async getHistory(userId: string, limit = 400) {
    let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    const fallbackLimit = Math.min(Math.max(limit * 5, limit), 2500);
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
    const posts = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
    posts.sort((a: any, b: any) => {
      const aScore = this.toSeconds(a.createdAt) || this.toSeconds(a.postedAt) || this.toSeconds(a.scheduledFor);
      const bScore = this.toSeconds(b.createdAt) || this.toSeconds(b.postedAt) || this.toSeconds(b.scheduledFor);
      return bScore - aScore;
    });
    const trimmed = posts.slice(0, limit);
    const summary = trimmed.reduce(
      (acc, post: any) => {
        acc.perPlatform[post.platform] = (acc.perPlatform[post.platform] ?? 0) + 1;
        acc.byStatus[post.status] = (acc.byStatus[post.status] ?? 0) + 1;
        return acc;
      },
      { perPlatform: {} as Record<string, number>, byStatus: {} as Record<string, number> },
    );

    const todayDate = new Date().toISOString().slice(0, 10);
    let todayPosts: Array<Record<string, unknown>> = [];
    try {
      const todaySnap = await scheduledPostsCollection
        .where('userId', '==', userId)
        .where('targetDate', '==', todayDate)
        .where('status', '==', 'posted')
        .limit(2500)
        .get();
      todayPosts = todaySnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
      todayPosts.sort((a, b) => {
        const aScore = this.toSeconds(a.postedAt) || this.toSeconds(a.createdAt) || this.toSeconds(a.scheduledFor);
        const bScore = this.toSeconds(b.postedAt) || this.toSeconds(b.createdAt) || this.toSeconds(b.scheduledFor);
        return bScore - aScore;
      });
    } catch (error) {
      if (!this.isMissingIndexError(error)) {
        console.warn('[social-history] failed to fetch full today posts', error);
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todaySeconds = Math.floor(todayStart.getTime() / 1000);
      todayPosts = trimmed.filter(post => {
        if ((post as any).status !== 'posted') return false;
        const seconds =
          this.toSeconds((post as any).postedAt) ||
          this.toSeconds((post as any).createdAt) ||
          this.toSeconds((post as any).scheduledFor);
        return seconds >= todaySeconds;
      });
    }

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
    const snaps = await Promise.all(uniqueKeys.map(key => socialLimitsCollection.doc(key).get()));
    snaps.forEach((doc, index) => {
      const key = uniqueKeys[index];
      const postedCount = (doc.data()?.postedCount as number) ?? 0;
      set.set(key, postedCount);
    });
    return set;
  }

  private async log(post: ScheduledPost, status: string, responseId?: string, error?: string) {
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

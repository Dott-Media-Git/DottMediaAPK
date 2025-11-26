import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';
import { publishToInstagram } from './socialPlatforms/instagramPublisher';
import { publishToFacebook } from './socialPlatforms/facebookPublisher';
import { publishToLinkedIn } from './socialPlatforms/linkedinPublisher';
import { publishToTwitter } from './socialPlatforms/twitterPublisher';
import { socialAnalyticsService } from './socialAnalyticsService';

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
  targetDate: string;
};

export interface SocialAccounts {
  facebook?: { accessToken: string; pageId: string; pageName?: string };
  instagram?: { accessToken: string; accountId: string; username?: string };
  linkedin?: { accessToken: string; urn: string };
  twitter?: { accessToken: string; accessSecret: string };
  [key: string]: any;
}

type PlatformPublisher = (input: { caption: string; imageUrls: string[]; credentials?: SocialAccounts }) => Promise<{ remoteId?: string }>;

const platformPublishers: Record<string, PlatformPublisher> = {
  instagram: publishToInstagram,
  facebook: publishToFacebook,
  linkedin: publishToLinkedIn,
  twitter: publishToTwitter,
  x: publishToTwitter,
  threads: publishToInstagram,
  tiktok: publishToInstagram,
};

export class SocialPostingService {
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

      const publisher = platformPublishers[post.platform] ?? publishToTwitter;
      try {
        // Fetch user credentials
        const userDoc = await firestore.collection('users').doc(post.userId).get();
        const userData = userDoc.data();
        const socialAccounts = userData?.socialAccounts as SocialAccounts | undefined;

        const response = await this.publishWithRetry(publisher, {
          caption: [post.caption, post.hashtags].filter(Boolean).join('\n\n'),
          imageUrls: post.imageUrls,
          credentials: socialAccounts,
        });
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

  async getHistory(userId: string, limit = 100) {
    const snap = await scheduledPostsCollection
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    const posts = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }));
    const summary = posts.reduce(
      (acc, post: any) => {
        acc.perPlatform[post.platform] = (acc.perPlatform[post.platform] ?? 0) + 1;
        acc.byStatus[post.status] = (acc.byStatus[post.status] ?? 0) + 1;
        return acc;
      },
      { perPlatform: {} as Record<string, number>, byStatus: {} as Record<string, number> },
    );
    return { posts, summary };
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
      error,
      postedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  private async publishWithRetry(publisher: PlatformPublisher, payload: { caption: string; imageUrls: string[] }) {
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
}

export const socialPostingService = new SocialPostingService();

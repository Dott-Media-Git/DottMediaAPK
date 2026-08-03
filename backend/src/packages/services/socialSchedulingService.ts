import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';
import { supabaseFallbackService } from '../../services/supabaseFallbackService';
import { validateBwinSportsContent } from '../../services/bwinContentGuard';
import {
  getBwinAccountClosureMessage,
  getBwinAccountClosureState,
  isBwinAccountClosureActive,
} from '../../services/bwinAccountClosureService';

const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
const withFirestoreDeadline = <T>(promise: Promise<T>, label: string, timeoutMs = 8000) =>
  Promise.race<T>([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
  ]);

export type SchedulePayload = {
  userId: string;
  platforms: Array<
    | 'instagram'
    | 'instagram_reels'
    | 'instagram_story'
    | 'facebook'
    | 'facebook_story'
    | 'linkedin'
    | 'twitter'
    | 'x'
    | 'threads'
    | 'tiktok'
    | 'youtube'
    | 'whatsapp'
  >;
  images?: string[];
  videoUrl?: string;
  youtubeVideoUrl?: string;
  tiktokVideoUrl?: string;
  instagramReelsVideoUrl?: string;
  videoTitle?: string;
  caption: string;
  hashtags?: string;
  scheduledFor: string;
  timesPerDay: number;
  billingUsageConsumed?: boolean;
};

export class SocialSchedulingService {
  async schedulePosts(payload: SchedulePayload) {
    if (!payload.platforms.length) throw new Error('At least one platform is required');
    const closureState = await getBwinAccountClosureState(payload.userId);
    if (closureState?.enabled) {
      const shutdownAt = new Date(closureState.shutdownAt);
      const scheduledAt = new Date(payload.scheduledFor);
      if (await isBwinAccountClosureActive(payload.userId)) {
        throw new Error(getBwinAccountClosureMessage(closureState));
      }
      if (Number.isFinite(scheduledAt.getTime()) && scheduledAt.getTime() >= shutdownAt.getTime()) {
        throw new Error(
          `Bwin scheduled posts must stay before ${shutdownAt.toISOString()} because the account is set to close then.`,
        );
      }
    }
    const bwinValidation = validateBwinSportsContent({
      userId: payload.userId,
      platforms: payload.platforms,
      caption: payload.caption,
      hashtags: payload.hashtags,
      videoTitle: payload.videoTitle,
      imageUrls: payload.images,
      videoUrl: payload.videoUrl ?? payload.youtubeVideoUrl ?? payload.tiktokVideoUrl ?? payload.instagramReelsVideoUrl,
    });
    if (!bwinValidation.ok) {
      throw new Error(bwinValidation.reason ?? 'Bwinbet scheduled posts must stay sports-only.');
    }
    const hasYoutube = payload.platforms.includes('youtube');
    const hasTikTok = payload.platforms.includes('tiktok');
    const hasReels = payload.platforms.includes('instagram_reels');
    const videoCapable = new Set(['facebook', 'facebook_story', 'instagram_story', 'linkedin']);
    const hasImagePlatform = payload.platforms.some(platform => {
      if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram_reels') return false;
      if (platform === 'whatsapp') return false;
      if (videoCapable.has(platform) && payload.videoUrl) return false;
      return true;
    });
    const youtubeUrl = payload.youtubeVideoUrl ?? payload.videoUrl;
    const tiktokUrl = payload.tiktokVideoUrl ?? payload.videoUrl;
    const reelsUrl = payload.instagramReelsVideoUrl ?? null;
    if (hasYoutube && !youtubeUrl) {
      throw new Error('YouTube requires a videoUrl');
    }
    if (hasTikTok && !tiktokUrl) {
      throw new Error('TikTok requires a videoUrl');
    }
    if (hasReels && !reelsUrl) {
      throw new Error('Instagram Reels requires a videoUrl');
    }
    if (hasImagePlatform && (!payload.images || payload.images.length === 0)) {
      throw new Error('Images are required for the selected platforms');
    }
    const timesPerDay = Math.min(Math.max(payload.timesPerDay, 1), 5);
    const scheduledDate = new Date(payload.scheduledFor);
    if (Number.isNaN(scheduledDate.getTime())) throw new Error('Invalid scheduledFor date');
    const targetDate = scheduledDate.toISOString().slice(0, 10);

    const limitKey = `${payload.userId}_${targetDate}`;
    let existingCount: number;
    let postedCount: number;
    try {
      const [posts, limit] = await Promise.all([
        supabaseFallbackService.getPostsByUser(payload.userId, 500),
        supabaseFallbackService.getSocialLimit(limitKey),
      ]);
      existingCount = posts.filter(post => post.targetDate === targetDate && String(post.status ?? 'pending') === 'pending').length;
      postedCount = limit?.postedCount ?? 0;
    } catch (error) {
      console.warn('[social-schedule] Supabase primary lookup failed; using Firebase fallback', error);
      const [existingSnap, limitDoc] = await withFirestoreDeadline(Promise.all([
        scheduledPostsCollection
          .where('userId', '==', payload.userId)
          .where('targetDate', '==', targetDate)
          .get(),
        socialLimitsCollection.doc(limitKey).get(),
      ]), 'Firebase schedule fallback lookup');
      existingCount = existingSnap.docs.filter(doc => String(doc.data()?.status ?? 'pending') === 'pending').length;
      postedCount = (limitDoc.data()?.postedCount as number) ?? 0;
    }
    const maxPerDay = 5;
    if (existingCount >= maxPerDay) {
      return { scheduled: [], postIds: [], trimmed: true, reason: 'limit_reached' };
    }

    const requestedTotal = payload.platforms.length * timesPerDay;
    const remaining = Math.max(0, maxPerDay - existingCount - postedCount);
    const totalToSchedule = Math.min(requestedTotal, remaining);
    if (totalToSchedule <= 0) {
      return { scheduled: [], postIds: [], trimmed: true, reason: 'limit_reached', remaining };
    }

    const slotCount = Math.max(1, Math.ceil(totalToSchedule / payload.platforms.length));
    const timeSlots = buildTimeSlots(scheduledDate, slotCount);

    const docsToCreate: Array<{ id: string; platform: string; scheduledFor: Date }> = [];
    outer: for (const slot of timeSlots) {
      for (const platform of payload.platforms) {
        if (docsToCreate.length >= totalToSchedule) break outer;
        docsToCreate.push({ id: scheduledPostsCollection.doc().id, platform, scheduledFor: slot });
      }
    }

    const batch = firestore.batch();
    const createdAt = new Date();
    const fallbackRows = docsToCreate.map(doc => {
      const isVideoPlatform =
        doc.platform === 'youtube' ||
        doc.platform === 'tiktok' ||
        doc.platform === 'instagram_reels' ||
        ((doc.platform === 'facebook' ||
          doc.platform === 'facebook_story' ||
          doc.platform === 'instagram_story' ||
          doc.platform === 'linkedin') &&
          Boolean(payload.videoUrl));
      const videoUrl =
        doc.platform === 'youtube'
          ? payload.youtubeVideoUrl ?? payload.videoUrl ?? null
          : doc.platform === 'tiktok'
            ? payload.tiktokVideoUrl ?? payload.videoUrl ?? null
            : doc.platform === 'instagram_reels'
              ? payload.instagramReelsVideoUrl ?? null
              : (doc.platform === 'facebook' ||
                  doc.platform === 'facebook_story' ||
                  doc.platform === 'instagram_story' ||
                  doc.platform === 'linkedin')
                ? payload.videoUrl ?? null
                : null;
      return {
        id: doc.id,
        userId: payload.userId,
        platform: doc.platform,
        imageUrls: isVideoPlatform ? [] : payload.images ?? [],
        videoUrl: videoUrl ?? undefined,
        videoTitle: payload.videoTitle ?? undefined,
        caption: payload.caption,
        hashtags: payload.hashtags ?? '',
        scheduledFor: doc.scheduledFor,
        targetDate,
        status: 'pending',
        createdAt,
        postedAt: null,
        errorMessage: undefined,
        billingUsageConsumed: Boolean(payload.billingUsageConsumed),
      };
    });
    docsToCreate.forEach(doc => {
      const isVideoPlatform =
        doc.platform === 'youtube' ||
        doc.platform === 'tiktok' ||
        doc.platform === 'instagram_reels' ||
        ((doc.platform === 'facebook' ||
          doc.platform === 'facebook_story' ||
          doc.platform === 'instagram_story' ||
          doc.platform === 'linkedin') &&
          Boolean(payload.videoUrl));
      const videoUrl =
        doc.platform === 'youtube'
          ? payload.youtubeVideoUrl ?? payload.videoUrl ?? null
          : doc.platform === 'tiktok'
            ? payload.tiktokVideoUrl ?? payload.videoUrl ?? null
            : doc.platform === 'instagram_reels'
              ? payload.instagramReelsVideoUrl ?? null
              : (doc.platform === 'facebook' ||
                  doc.platform === 'facebook_story' ||
                  doc.platform === 'instagram_story' ||
                  doc.platform === 'linkedin')
                ? payload.videoUrl ?? null
                : null;
      batch.set(scheduledPostsCollection.doc(doc.id), {
        userId: payload.userId,
        platform: doc.platform,
        imageUrls: isVideoPlatform ? [] : payload.images ?? [],
        videoUrl,
        videoTitle: payload.videoTitle ?? null,
        caption: payload.caption,
        hashtags: payload.hashtags ?? '',
        scheduledFor: admin.firestore.Timestamp.fromDate(doc.scheduledFor),
        targetDate,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        postedAt: null,
        errorMessage: null,
        billingUsageConsumed: Boolean(payload.billingUsageConsumed),
      });
    });

    batch.set(
      socialLimitsCollection.doc(limitKey),
      {
        userId: payload.userId,
        date: targetDate,
        scheduledCount: admin.firestore.FieldValue.increment(docsToCreate.length),
      },
      { merge: true },
    );

    try {
      await supabaseFallbackService.upsertScheduledPosts(fallbackRows);
      await supabaseFallbackService.incrementSocialLimit({
        key: limitKey,
        userId: payload.userId,
        date: targetDate,
        scheduledCount: docsToCreate.length,
      });
    } catch (error) {
      console.warn('[social-schedule] Supabase primary write failed; using Firebase fallback', error);
      await withFirestoreDeadline(batch.commit(), 'Firebase schedule fallback write');
    }

    return { scheduled: docsToCreate.length, postIds: docsToCreate.map(doc => doc.id), trimmed: docsToCreate.length < requestedTotal, remaining: remaining - docsToCreate.length };
  }
}

export const socialSchedulingService = new SocialSchedulingService();

function buildTimeSlots(base: Date, count: number) {
  const slots: Date[] = [];
  const start = new Date(base);
  const dayEnd = new Date(base);
  dayEnd.setHours(23, 59, 0, 0);
  if (count === 1) {
    slots.push(start);
    return slots;
  }
  const availableMinutes = Math.max(
    60,
    Math.floor((dayEnd.getTime() - start.getTime()) / 60000) - 30 /* buffer */,
  );
  const interval = Math.max(60, Math.floor(availableMinutes / (count - 1)));
  for (let i = 0; i < count; i += 1) {
    const slot = new Date(start.getTime() + i * interval * 60000);
    if (slot > dayEnd) {
      slots.push(new Date(dayEnd));
      break;
    }
    slots.push(slot);
  }
  return slots;
}

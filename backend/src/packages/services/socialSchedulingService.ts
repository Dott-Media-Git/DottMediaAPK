import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';

const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');

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
};

export class SocialSchedulingService {
  async schedulePosts(payload: SchedulePayload) {
    if (!payload.platforms.length) throw new Error('At least one platform is required');
    const hasYoutube = payload.platforms.includes('youtube');
    const hasTikTok = payload.platforms.includes('tiktok');
    const hasReels = payload.platforms.includes('instagram_reels');
    const videoCapable = new Set(['facebook', 'facebook_story', 'instagram_story', 'linkedin']);
    const hasImagePlatform = payload.platforms.some(platform => {
      if (platform === 'youtube' || platform === 'tiktok' || platform === 'instagram_reels') return false;
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

    const existingSnap = await scheduledPostsCollection
      .where('userId', '==', payload.userId)
      .where('targetDate', '==', targetDate)
      .get();

    const existingCount = existingSnap.size;
    const limitDoc = await socialLimitsCollection.doc(`${payload.userId}_${targetDate}`).get();
    const postedCount = (limitDoc.data()?.postedCount as number) ?? 0;
    const maxPerDay = 5;
    if (existingCount >= maxPerDay) {
      return { scheduled: [], trimmed: true, reason: 'limit_reached' };
    }

    const requestedTotal = payload.platforms.length * timesPerDay;
    const remaining = Math.max(0, maxPerDay - existingCount - postedCount);
    const totalToSchedule = Math.min(requestedTotal, remaining);
    if (totalToSchedule <= 0) {
      return { scheduled: [], trimmed: true, reason: 'limit_reached', remaining };
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
      });
    });

    batch.set(
      socialLimitsCollection.doc(`${payload.userId}_${targetDate}`),
      {
        userId: payload.userId,
        date: targetDate,
        scheduledCount: admin.firestore.FieldValue.increment(docsToCreate.length),
      },
      { merge: true },
    );

    await batch.commit();
    return { scheduled: docsToCreate.length, trimmed: docsToCreate.length < requestedTotal, remaining: remaining - docsToCreate.length };
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

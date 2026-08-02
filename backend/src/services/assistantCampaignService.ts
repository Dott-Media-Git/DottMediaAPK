import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { supabaseFallbackService } from './supabaseFallbackService';

const autopostCollection = firestore.collection('autopostJobs');

const SUPPORTED_PLATFORMS = new Set([
  'instagram',
  'instagram_story',
  'instagram_reels',
  'facebook',
  'facebook_story',
  'linkedin',
  'threads',
  'x',
  'twitter',
  'tiktok',
  'youtube',
]);

export type CampaignControlAction = 'configure' | 'pause' | 'resume';

export type CampaignControlInput = {
  action: CampaignControlAction;
  campaignName?: string;
  platforms?: string[];
  postsPerWeek?: number;
  contentBrief?: string;
  businessType?: string;
  firstRunAt?: string;
};

const normalizePlatforms = (platforms?: string[]) =>
  Array.from(
    new Set(
      (platforms ?? [])
        .map(platform => platform.trim().toLowerCase())
        .map(platform => (platform === 'twitter' ? 'x' : platform))
        .filter(platform => SUPPORTED_PLATFORMS.has(platform)),
    ),
  );

const parseFirstRun = (value: string | undefined, fallback: Date) => {
  if (!value?.trim()) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('The first posting time is invalid. Please include a date, time, and timezone.');
  }
  if (parsed.getTime() < Date.now() - 60_000) {
    throw new Error('The first posting time must be in the future.');
  }
  return parsed;
};

export class AssistantCampaignService {
  async configure(userId: string, input: CampaignControlInput) {
    if (!userId) throw new Error('An authenticated account is required.');

    const fallbackJob = await supabaseFallbackService.getAutopostJob(userId).catch(() => null);
    const firestoreSnap = fallbackJob ? null : await autopostCollection.doc(userId).get().catch(() => null);
    const existing = (fallbackJob ?? firestoreSnap?.data() ?? {}) as Record<string, any>;

    if (input.action === 'pause') {
      const patch = {
        active: false,
        nextRun: null,
        reelsNextRun: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await autopostCollection.doc(userId).set(patch, { merge: true }).catch(error => {
        console.warn('[assistant-campaign] Firebase pause mirror failed', error);
      });
      await supabaseFallbackService.upsertAutopostJob(userId, {
        ...existing,
        active: false,
        nextRun: null,
        reelsNextRun: null,
      });
      return {
        message: `Campaign paused for this account. No new automatic posts will run until it is resumed.`,
      };
    }

    const requestedPlatforms = normalizePlatforms(input.platforms);
    const platforms = requestedPlatforms.length
      ? requestedPlatforms
      : normalizePlatforms(Array.isArray(existing.platforms) ? existing.platforms : []);
    if (!platforms.length) {
      throw new Error('Choose at least one connected posting platform.');
    }

    const currentPostsPerWeek = existing.intervalHours
      ? Math.max(1, Math.round(168 / Number(existing.intervalHours)))
      : 3;
    const postsPerWeek = Math.min(35, Math.max(1, Math.round(Number(input.postsPerWeek ?? currentPostsPerWeek))));
    const intervalHours = Number((168 / postsPerWeek).toFixed(2));
    const defaultFirstRun = new Date(Date.now() + Math.min(intervalHours, 24) * 60 * 60 * 1000);
    const firstRun = parseFirstRun(input.firstRunAt, defaultFirstRun);
    const isActive = input.action === 'resume' || input.action === 'configure';

    const patch = {
      active: isActive,
      platforms,
      intervalHours,
      nextRun: admin.firestore.Timestamp.fromDate(firstRun),
      ...(input.campaignName?.trim() ? { campaignName: input.campaignName.trim() } : {}),
      ...(input.contentBrief?.trim() ? { prompt: input.contentBrief.trim() } : {}),
      ...(input.businessType?.trim() ? { businessType: input.businessType.trim() } : {}),
      campaignSource: 'dotti',
      campaignUpdatedAt: new Date().toISOString(),
    };

    await autopostCollection.doc(userId).set(
      {
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    ).catch(error => {
      console.warn('[assistant-campaign] Firebase campaign mirror failed', error);
    });
    await supabaseFallbackService.upsertAutopostJob(userId, { ...existing, ...patch });

    return {
      message: [
        `${input.action === 'resume' ? 'Campaign resumed' : 'Campaign configured'} for this account.`,
        `Platforms: ${platforms.join(', ')}.`,
        `Frequency: ${postsPerWeek} post${postsPerWeek === 1 ? '' : 's'} per week (about every ${intervalHours} hours).`,
        `First run: ${firstRun.toISOString()}.`,
        input.contentBrief?.trim() ? 'The new content brief will be used for upcoming generated posts.' : '',
      ].filter(Boolean).join(' '),
    };
  }
}

export const assistantCampaignService = new AssistantCampaignService();

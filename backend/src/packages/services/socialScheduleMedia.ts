export type ScheduledPlatform =
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
  | 'whatsapp';

export type VideoSchedulePayload = {
  platforms: ScheduledPlatform[];
  images?: string[];
  videoUrl?: string;
  youtubeVideoUrl?: string;
  tiktokVideoUrl?: string;
  instagramReelsVideoUrl?: string;
};

export const genericVideoPlatforms = new Set<ScheduledPlatform>([
  'facebook',
  'facebook_story',
  'instagram_story',
  'linkedin',
  'twitter',
  'x',
  'threads',
  'whatsapp',
]);

export const normalizeVideoSchedulePayload = <T extends VideoSchedulePayload>(payload: T): T => {
  const hasImages = Boolean(payload.images?.length);
  const instagramVideoUrl = payload.instagramReelsVideoUrl ?? payload.videoUrl;
  if (hasImages || !instagramVideoUrl || !payload.platforms.includes('instagram')) return payload;

  return {
    ...payload,
    platforms: Array.from(new Set(payload.platforms.map(platform =>
      platform === 'instagram' ? 'instagram_reels' : platform,
    ))),
    instagramReelsVideoUrl: instagramVideoUrl,
  };
};

export const resolvePlatformVideoUrl = (
  platform: ScheduledPlatform,
  payload: VideoSchedulePayload,
) => {
  if (platform === 'youtube') return payload.youtubeVideoUrl ?? payload.videoUrl ?? null;
  if (platform === 'tiktok') return payload.tiktokVideoUrl ?? payload.videoUrl ?? null;
  if (platform === 'instagram_reels') return payload.instagramReelsVideoUrl ?? payload.videoUrl ?? null;
  if (genericVideoPlatforms.has(platform)) return payload.videoUrl ?? null;
  return null;
};

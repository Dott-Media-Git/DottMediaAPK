export const GENERIC_VIDEO_PLATFORMS = new Set([
  'facebook',
  'facebook_story',
  'instagram_story',
  'linkedin',
  'threads',
  'twitter',
  'whatsapp',
]);

export const resolveSelectedPostPlatforms = (
  platforms: string[],
  imageCount: number,
  hasVideo: boolean,
) => {
  const isVideoOnlyPost = imageCount === 0 && hasVideo;
  const normalized = platforms.map(platform =>
    isVideoOnlyPost && platform === 'instagram' ? 'instagram_reels' : platform,
  );
  return Array.from(new Set(normalized));
};

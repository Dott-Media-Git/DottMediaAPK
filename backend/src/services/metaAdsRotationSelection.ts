import type { RotationPost } from './metaAdsRotationPlan.js';

/** Select a fresh pair only after both platform lists have eligible posts. */
export function selectNextRotationPosts(input: {
  facebookPosts: RotationPost[];
  instagramPosts: RotationPost[];
  previousFacebookId?: string;
  previousInstagramId?: string;
  usedFacebookIds?: string[];
  usedInstagramIds?: string[];
}): { facebookPost: RotationPost; instagramPost: RotationPost } {
  const select = (posts: RotationPost[], platform: RotationPost['platform'], previous?: string, used: string[] = []) => {
    const eligible = posts.filter(post => post.platform === platform && post.id.trim());
    if (!eligible.length) throw new Error(`No eligible ${platform} posts available.`);
    const fresh = eligible.find(post => post.id !== previous && !used.includes(post.id));
    if (!fresh) throw new Error(`No new ${platform} post is available for the next rotation.`);
    return fresh;
  };
  return {
    facebookPost: select(input.facebookPosts, 'facebook', input.previousFacebookId, input.usedFacebookIds),
    instagramPost: select(input.instagramPosts, 'instagram', input.previousInstagramId, input.usedInstagramIds),
  };
}

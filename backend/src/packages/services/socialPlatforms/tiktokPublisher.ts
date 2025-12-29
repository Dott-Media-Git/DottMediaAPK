import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  credentials?: SocialAccounts;
};

export async function publishToTikTok(input: PublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  const account = credentials?.tiktok;
  if (!account?.accessToken || !account?.openId) {
    throw new Error('Missing TikTok credentials');
  }
  if (!input.videoUrl) {
    throw new Error('TikTok requires a video URL');
  }

  // TODO: replace with TikTok Content Posting API integration.
  console.info('[tiktok] queued video', input.videoUrl, input.caption.slice(0, 60));
  await new Promise(resolve => setTimeout(resolve, 50));
  return { remoteId: `tt_${Date.now()}` };
}

import axios from 'axios';

type PublishInput = {
  caption: string;
  imageUrls: string[];
};

export async function publishToInstagram(input: PublishInput): Promise<{ remoteId?: string }> {
  // TODO: integrate Meta Graph API publish flow once tokens are stored.
  console.info('[instagram] posting', input.caption.slice(0, 40));
  await axios.request({ method: 'GET', url: 'https://graph.facebook.com/health_check' }).catch(() => ({}));
  return { remoteId: `ig_${Date.now()}` };
}

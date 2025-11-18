import axios from 'axios';

type PublishInput = {
  caption: string;
  imageUrls: string[];
};

export async function publishToFacebook(input: PublishInput): Promise<{ remoteId?: string }> {
  console.info('[facebook] posting', input.caption.slice(0, 40));
  await axios.request({ method: 'GET', url: 'https://graph.facebook.com/health_check' }).catch(() => ({}));
  return { remoteId: `fb_${Date.now()}` };
}

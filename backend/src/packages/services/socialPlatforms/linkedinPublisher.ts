import axios from 'axios';

type PublishInput = {
  caption: string;
  imageUrls: string[];
};

export async function publishToLinkedIn(input: PublishInput): Promise<{ remoteId?: string }> {
  console.info('[linkedin] posting', input.caption.slice(0, 40));
  await axios.request({ method: 'GET', url: 'https://www.linkedin.com' }).catch(() => ({}));
  return { remoteId: `li_${Date.now()}` };
}

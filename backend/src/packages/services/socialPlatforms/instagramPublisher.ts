import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  credentials?: SocialAccounts;
};

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const READY_ATTEMPTS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_ATTEMPTS ?? 15), 3);
const READY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_DELAY_MS ?? 2000), 1000);
const PUBLISH_RETRIES = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRIES ?? 2), 1);
const PUBLISH_RETRY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRY_DELAY_MS ?? 3000), 1000);

export async function publishToInstagram(input: PublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  if (!credentials?.instagram) {
    throw new Error('Missing Instagram credentials');
  }

  const { accessToken, accountId } = credentials.instagram;
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;

  if (!input.imageUrls || input.imageUrls.length === 0) {
    throw new Error('Instagram requires an image');
  }

  try {
    // Step 1: Create Media Container
    const createMediaResponse = await axios.post(`${baseUrl}/media`, {
      image_url: input.imageUrls[0],
      caption: input.caption,
      access_token: accessToken,
    });

    const creationId = createMediaResponse.data.id;
    if (!creationId) {
      throw new Error('Failed to create Instagram media container');
    }

    // Wait for the media container to finish processing before publishing.
    const isReady = await waitForMediaReady(creationId, accessToken, READY_ATTEMPTS, READY_DELAY_MS);
    if (!isReady) {
      throw new Error('Media container not ready for publishing');
    }

    // Step 2: Publish Media (retry if the container is still settling)
    const publishedId = await publishWithRetry({
      baseUrl,
      creationId,
      accessToken,
      retries: PUBLISH_RETRIES,
      retryDelayMs: PUBLISH_RETRY_DELAY_MS,
    });

    if (publishedId) {
      return { remoteId: publishedId };
    }
    throw new Error('No ID returned from Instagram publish');
  } catch (error: any) {
    console.error('Instagram publish error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Instagram publish failed');
  }
}

async function waitForMediaReady(
  creationId: string,
  accessToken: string,
  maxAttempts = 5,
  delayMs = 2000,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusResp = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`, {
      params: { fields: 'status_code', access_token: accessToken },
    });
    const status = statusResp.data?.status_code;
    if (status === 'FINISHED') return true;
    if (status === 'ERROR') return false;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function publishWithRetry({
  baseUrl,
  creationId,
  accessToken,
  retries,
  retryDelayMs,
}: {
  baseUrl: string;
  creationId: string;
  accessToken: string;
  retries: number;
  retryDelayMs: number;
}) {
  let lastError: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const publishResponse = await axios.post(`${baseUrl}/media_publish`, {
        creation_id: creationId,
        access_token: accessToken,
      });
      if (publishResponse.data && publishResponse.data.id) {
        return publishResponse.data.id as string;
      }
      throw new Error('No ID returned from Instagram publish');
    } catch (error: any) {
      lastError = error;
      const message = error.response?.data?.error?.message ?? error.message ?? '';
      if (message.toLowerCase().includes('media id is not available') && attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return null;
}

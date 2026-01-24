import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  credentials?: SocialAccounts;
};

type ReelPublishInput = {
  caption: string;
  videoUrl?: string;
  credentials?: SocialAccounts;
};

type StoryPublishInput = {
  caption?: string;
  imageUrls: string[];
  videoUrl?: string;
  credentials?: SocialAccounts;
};

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const READY_ATTEMPTS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_ATTEMPTS ?? 15), 3);
const READY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_DELAY_MS ?? 2000), 1000);
const PUBLISH_RETRIES = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRIES ?? 2), 1);
const PUBLISH_RETRY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRY_DELAY_MS ?? 3000), 1000);

type InstagramApiError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
};

function formatInstagramError(error: any, fallback: string) {
  const apiError = error?.response?.data?.error as InstagramApiError | undefined;
  if (!apiError) {
    return error?.message ?? fallback;
  }
  const parts = [
    apiError.message,
    apiError.error_user_msg ? `user_msg=${apiError.error_user_msg}` : null,
    apiError.error_user_title ? `user_title=${apiError.error_user_title}` : null,
    typeof apiError.code === 'number' ? `code=${apiError.code}` : null,
    typeof apiError.error_subcode === 'number' ? `subcode=${apiError.error_subcode}` : null,
    apiError.type ? `type=${apiError.type}` : null,
    apiError.fbtrace_id ? `trace=${apiError.fbtrace_id}` : null,
  ].filter(Boolean);
  return parts.join(' | ') || fallback;
}

function logInstagramError(label: string, error: any) {
  if (error?.response?.data) {
    console.error(label, error.response.data);
    return;
  }
  if (error?.message) {
    console.error(label, error.message);
    return;
  }
  console.error(label, String(error ?? 'unknown_error'));
}

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
    logInstagramError('Instagram publish error:', error);
    throw new Error(formatInstagramError(error, 'Instagram publish failed'));
  }
}

export async function publishToInstagramReel(input: ReelPublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  if (!credentials?.instagram) {
    throw new Error('Missing Instagram credentials');
  }
  if (!input.videoUrl) {
    throw new Error('Instagram Reels requires a video URL');
  }

  const { accessToken, accountId } = credentials.instagram;
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;

  try {
    const createMediaResponse = await axios.post(`${baseUrl}/media`, {
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      access_token: accessToken,
    });

    const creationId = createMediaResponse.data.id;
    if (!creationId) {
      throw new Error('Failed to create Instagram Reels container');
    }

    const isReady = await waitForMediaReady(creationId, accessToken, READY_ATTEMPTS, READY_DELAY_MS);
    if (!isReady) {
      throw new Error('Reels container not ready for publishing');
    }

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
    throw new Error('No ID returned from Instagram Reels publish');
  } catch (error: any) {
    logInstagramError('Instagram Reels publish error:', error);
    throw new Error(formatInstagramError(error, 'Instagram Reels publish failed'));
  }
}

export async function publishToInstagramStory(input: StoryPublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  if (!credentials?.instagram) {
    throw new Error('Missing Instagram credentials');
  }

  const { accessToken, accountId } = credentials.instagram;
  const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}`;
  const hasVideo = Boolean(input.videoUrl);
  const mediaUrl = hasVideo ? input.videoUrl : input.imageUrls?.[0];

  if (!mediaUrl) {
    throw new Error('Instagram Story requires an image or video URL');
  }

  try {
    const createMediaResponse = await axios.post(`${baseUrl}/media`, {
      media_type: 'STORIES',
      ...(hasVideo ? { video_url: mediaUrl } : { image_url: mediaUrl }),
      access_token: accessToken,
    });

    const creationId = createMediaResponse.data.id;
    if (!creationId) {
      throw new Error('Failed to create Instagram Story container');
    }

    const isReady = await waitForMediaReady(creationId, accessToken, READY_ATTEMPTS, READY_DELAY_MS);
    if (!isReady) {
      throw new Error('Story container not ready for publishing');
    }

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
    throw new Error('No ID returned from Instagram Story publish');
  } catch (error: any) {
    logInstagramError('Instagram Story publish error:', error);
    throw new Error(formatInstagramError(error, 'Instagram Story publish failed'));
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
      params: { fields: 'status_code,status', access_token: accessToken },
    });
    const status = statusResp.data?.status_code;
    if (status === 'FINISHED') return true;
    if (status === 'ERROR') {
      const statusInfo = statusResp.data?.status ?? {};
      const detail = typeof statusInfo === 'object' ? JSON.stringify(statusInfo) : String(statusInfo ?? '');
      if (detail && detail !== '{}' && detail !== 'null') {
        throw new Error(`Instagram media container error: ${detail}`);
      }
      return false;
    }
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

import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  credentials?: SocialAccounts;
};

type ThreadsApiError = {
  message?: string;
  error_user_msg?: string;
  error_user_title?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
};

const GRAPH_VERSION = process.env.THREADS_GRAPH_VERSION ?? 'v1.0';
const GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? 'https://graph.threads.net';
const READY_ATTEMPTS = Math.max(Number(process.env.THREADS_MEDIA_READY_ATTEMPTS ?? 12), 3);
const READY_DELAY_MS = Math.max(Number(process.env.THREADS_MEDIA_READY_DELAY_MS ?? 2000), 1000);
const PUBLISH_RETRIES = Math.max(Number(process.env.THREADS_PUBLISH_RETRIES ?? 3), 1);
const PUBLISH_RETRY_DELAY_MS = Math.max(Number(process.env.THREADS_PUBLISH_RETRY_DELAY_MS ?? 2500), 1000);

function formatThreadsError(error: any, fallback: string) {
  const apiError = error?.response?.data?.error as ThreadsApiError | undefined;
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
  ].filter(Boolean);
  return parts.join(' | ') || fallback;
}

async function waitForMediaReady(creationId: string, accessToken: string) {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    try {
      const statusResp = await axios.get(`${GRAPH_BASE_URL}/${GRAPH_VERSION}/${creationId}`, {
        params: {
          fields: 'id,status,error_message',
          access_token: accessToken,
        },
      });
      const status = String(statusResp.data?.status ?? '').toUpperCase();
      if (!status || status === 'FINISHED' || status === 'PUBLISHED') {
        return true;
      }
      if (status === 'ERROR' || status === 'FAILED') {
        const detail = statusResp.data?.error_message as string | undefined;
        throw new Error(detail || 'Threads media container failed');
      }
    } catch (error: any) {
      const message = error?.response?.data?.error?.message ?? error?.message ?? '';
      if (/unsupported get request|unknown path components|invalid parameter/i.test(message)) {
        return true;
      }
      throw error;
    }

    await new Promise(resolve => setTimeout(resolve, READY_DELAY_MS));
  }

  return true;
}

async function publishWithRetry(accountId: string, accessToken: string, creationId: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < PUBLISH_RETRIES; attempt += 1) {
    try {
      const publishResp = await axios.post(
        `${GRAPH_BASE_URL}/${GRAPH_VERSION}/${accountId}/threads_publish`,
        null,
        {
          params: {
            creation_id: creationId,
            access_token: accessToken,
          },
        },
      );
      if (publishResp.data?.id) {
        return publishResp.data.id as string;
      }
      throw new Error('No ID returned from Threads publish');
    } catch (error: any) {
      lastError = error;
      const message = error?.response?.data?.error?.message ?? error?.message ?? '';
      if (attempt < PUBLISH_RETRIES - 1 && /not ready|not available|processing|try again/i.test(message)) {
        await new Promise(resolve => setTimeout(resolve, PUBLISH_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error('Threads publish failed');
}

export async function publishToThreads(input: PublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  if (!credentials?.threads) {
    throw new Error('Missing Threads credentials');
  }

  const { accessToken, accountId } = credentials.threads;
  const imageUrl = input.imageUrls?.[0];
  const mediaType = input.videoUrl ? 'VIDEO' : imageUrl ? 'IMAGE' : 'TEXT';

  try {
    const createPayload: Record<string, string> = {
      media_type: mediaType,
      text: input.caption || '',
      access_token: accessToken,
    };
    if (mediaType === 'IMAGE' && imageUrl) {
      createPayload.image_url = imageUrl;
    }
    if (mediaType === 'VIDEO' && input.videoUrl) {
      createPayload.video_url = input.videoUrl;
    }

    const createResp = await axios.post(`${GRAPH_BASE_URL}/${GRAPH_VERSION}/${accountId}/threads`, null, {
      params: createPayload,
    });

    const creationId = createResp.data?.id as string | undefined;
    if (!creationId) {
      throw new Error('Failed to create Threads media container');
    }

    await waitForMediaReady(creationId, accessToken);
    const publishedId = await publishWithRetry(accountId, accessToken, creationId);
    return { remoteId: publishedId };
  } catch (error: any) {
    console.error('Threads publish error:', error?.response?.data || error?.message || error);
    throw new Error(formatThreadsError(error, 'Threads publish failed'));
  }
}

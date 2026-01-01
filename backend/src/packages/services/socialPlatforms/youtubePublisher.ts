import axios from 'axios';
import { google } from 'googleapis';
import { config } from '../../../config';
import { SocialAccounts } from '../socialPostingService';

type YoutubePrivacyStatus = 'private' | 'public' | 'unlisted';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  videoTitle?: string;
  privacyStatus?: YoutubePrivacyStatus;
  tags?: string[];
  credentials?: SocialAccounts;
};

const DEFAULT_TITLE = 'Dott Media update';

export async function publishToYouTube(input: PublishInput): Promise<{ remoteId?: string }> {
  const youtubeCredentials = input.credentials?.youtube;
  if (!youtubeCredentials?.refreshToken) {
    throw new Error('Missing YouTube refresh token');
  }

  const clientId = youtubeCredentials.clientId ?? config.youtube.clientId;
  const clientSecret = youtubeCredentials.clientSecret ?? config.youtube.clientSecret;
  const redirectUri = youtubeCredentials.redirectUri ?? config.youtube.redirectUri;
  if (!clientId || !clientSecret) {
    throw new Error('Missing YouTube OAuth client');
  }

  const videoUrl = input.videoUrl?.trim();
  if (!videoUrl) {
    throw new Error('Missing YouTube video URL');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri || undefined);
  oauth2.setCredentials({
    refresh_token: youtubeCredentials.refreshToken,
    access_token: youtubeCredentials.accessToken,
  });

  const youtube = google.youtube({ version: 'v3', auth: oauth2 });
  const title = buildTitle(input.videoTitle ?? input.caption);
  const description = (input.caption ?? '').trim();
  const privacyStatus = input.privacyStatus ?? youtubeCredentials.privacyStatus ?? 'unlisted';

  let mediaStream;
  try {
    const response = await axios.get(videoUrl, { responseType: 'stream' });
    mediaStream = response.data;
  } catch (error: any) {
    const message = error?.response?.status ? ` (${error.response.status})` : '';
    throw new Error(`Failed to download YouTube video${message}`);
  }

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags: input.tags?.length ? input.tags : undefined,
      },
      status: {
        privacyStatus,
      },
    },
    media: {
      body: mediaStream,
    },
  });

  const id = response.data?.id as string | undefined;
  if (!id) {
    throw new Error('No ID returned from YouTube');
  }
  return { remoteId: id };
}

function buildTitle(raw: string | undefined) {
  if (!raw) return DEFAULT_TITLE;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_TITLE;
  const firstLine = trimmed.split('\n').find(line => line.trim().length > 0) ?? trimmed;
  const normalized = firstLine.replace(/\s+/g, ' ').trim();
  if (!normalized) return DEFAULT_TITLE;
  return normalized.slice(0, 100);
}

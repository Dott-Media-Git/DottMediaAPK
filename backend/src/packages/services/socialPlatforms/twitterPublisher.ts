import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  quoteTweetId?: string;
  credentials?: {
    twitter?: {
      accessToken?: string;
      accessSecret?: string;
      appKey?: string;
      appSecret?: string;
      consumerKey?: string;
      consumerSecret?: string;
    };
  };
};

const inferVideoMimeType = (url: string, contentType?: string) => {
  const normalized = (contentType || '').toLowerCase();
  if (normalized.startsWith('video/')) return normalized;
  const lower = url.toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.m4v')) return 'video/mp4';
  return 'video/mp4';
};

const parseDataImageUrl = (value: string): { buffer: Buffer; mimeType: string } | null => {
  const trimmed = value.trim();
  const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
  }
};

export async function publishToTwitter(input: PublishInput): Promise<{ remoteId?: string }> {
  const { caption, imageUrls = [], videoUrl, quoteTweetId, credentials } = input;
  console.info('[twitter] posting', caption?.slice(0, 40));

  const accessToken = credentials?.twitter?.accessToken;
  const accessSecret = credentials?.twitter?.accessSecret;
  const appKey =
    credentials?.twitter?.appKey ??
    credentials?.twitter?.consumerKey ??
    process.env.TWITTER_API_KEY ??
    process.env.TWITTER_CONSUMER_KEY;
  const appSecret =
    credentials?.twitter?.appSecret ??
    credentials?.twitter?.consumerSecret ??
    process.env.TWITTER_API_SECRET ??
    process.env.TWITTER_CONSUMER_SECRET;

  if (!appKey || !appSecret) {
    throw new Error('Missing Twitter app credentials (TWITTER_API_KEY / TWITTER_API_SECRET)');
  }
  if (!accessToken || !accessSecret) {
    throw new Error('Missing user Twitter credentials (accessToken / accessSecret)');
  }

  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });

  const rw = client.readWrite;

  try {
    const mediaIds: string[] = [];
    if (videoUrl) {
      try {
        const res = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
        const buffer = Buffer.from(res.data);
        const contentType = inferVideoMimeType(videoUrl, res.headers['content-type']);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const mediaId = await rw.v1.uploadMedia(buffer, { mimeType: contentType, target: 'tweet' });
        mediaIds.push(String(mediaId));
      } catch (err) {
        console.warn('[twitter] video upload failed for', videoUrl, err instanceof Error ? err.message : err);
        throw err;
      }
    } else {
      for (const url of imageUrls) {
        try {
          const dataImage = parseDataImageUrl(url);
          let buffer: Buffer;
          let contentType: string | undefined;
          if (dataImage) {
            buffer = dataImage.buffer;
            contentType = dataImage.mimeType;
          } else {
            const res = await axios.get(url, { responseType: 'arraybuffer' });
            buffer = Buffer.from(res.data);
            contentType = res.headers['content-type'] ?? undefined;
          }
          // uploadMedia accepts Buffer and optional mimeType
          // returns media id string
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const mediaId = await rw.v1.uploadMedia(buffer, { mimeType: contentType });
          mediaIds.push(String(mediaId));
        } catch (err) {
          console.warn('[twitter] media upload failed for', url, err instanceof Error ? err.message : err);
          throw err;
        }
      }
    }

    // X's newer access tiers may block v1.1 tweet creation; use v2 for posting.
    const payload: any = { text: caption };
    if (mediaIds.length) payload.media = { media_ids: mediaIds };
    if (quoteTweetId) payload.quote_tweet_id = quoteTweetId;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const tweet = await rw.v2.tweet(payload);
    const rawId = tweet?.data?.id;
    const remoteId = rawId !== undefined && rawId !== null ? String(rawId) : undefined;
    return { remoteId };
  } catch (error) {
    console.error('[twitter] publish error', error instanceof Error ? error.message : error);
    throw error;
  }
}

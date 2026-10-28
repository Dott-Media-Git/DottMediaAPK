import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
const inferVideoMimeType = (url, contentType) => {
    const normalized = (contentType || '').toLowerCase();
    if (normalized.startsWith('video/'))
        return normalized;
    const lower = url.toLowerCase();
    if (lower.endsWith('.mov'))
        return 'video/quicktime';
    if (lower.endsWith('.webm'))
        return 'video/webm';
    if (lower.endsWith('.m4v'))
        return 'video/mp4';
    return 'video/mp4';
};
const parseDataImageUrl = (value) => {
    const trimmed = value.trim();
    const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match)
        return null;
    try {
        return {
            mimeType: match[1],
            buffer: Buffer.from(match[2], 'base64'),
        };
    }
    catch {
        return null;
    }
};
export async function publishToTwitter(input) {
    const { caption, imageUrls = [], videoUrl, quoteTweetId, credentials } = input;
    console.info('[twitter] posting', caption?.slice(0, 40));
    const accessToken = credentials?.twitter?.accessToken;
    const accessSecret = credentials?.twitter?.accessSecret;
    const appKey = credentials?.twitter?.appKey ??
        credentials?.twitter?.consumerKey ??
        process.env.TWITTER_API_KEY ??
        process.env.TWITTER_CONSUMER_KEY;
    const appSecret = credentials?.twitter?.appSecret ??
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
        const mediaIds = [];
        let mediaUploadBlocked = false;
        if (videoUrl) {
            try {
                const res = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
                const buffer = Buffer.from(res.data);
                const contentType = inferVideoMimeType(videoUrl, res.headers['content-type']);
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const mediaId = await rw.v1.uploadMedia(buffer, {
                    mimeType: contentType,
                    type: contentType,
                    target: 'tweet',
                });
                mediaIds.push(String(mediaId));
            }
            catch (err) {
                console.warn('[twitter] video upload failed for', videoUrl, err instanceof Error ? err.message : err);
                mediaUploadBlocked = true;
            }
        }
        else {
            for (const url of imageUrls) {
                try {
                    const dataImage = parseDataImageUrl(url);
                    let buffer;
                    let contentType;
                    if (dataImage) {
                        buffer = dataImage.buffer;
                        contentType = dataImage.mimeType;
                    }
                    else {
                        const res = await axios.get(url, { responseType: 'arraybuffer' });
                        buffer = Buffer.from(res.data);
                        contentType = res.headers['content-type'] ?? undefined;
                    }
                    const imageType = contentType || 'image/png';
                    // uploadMedia accepts Buffer and optional mimeType
                    // returns media id string
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const mediaId = await rw.v1.uploadMedia(buffer, { mimeType: imageType, type: imageType });
                    mediaIds.push(String(mediaId));
                }
                catch (err) {
                    console.warn('[twitter] media upload failed for', url, err instanceof Error ? err.message : err);
                    mediaUploadBlocked = true;
                    break;
                }
            }
        }
        // X's newer access tiers may block v1.1 tweet creation; use v2 for posting.
        const payload = { text: caption };
        if (mediaIds.length && !mediaUploadBlocked)
            payload.media = { media_ids: mediaIds };
        if (quoteTweetId)
            payload.quote_tweet_id = quoteTweetId;
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const tweet = await rw.v2.tweet(payload);
            const rawId = tweet?.data?.id;
            const remoteId = rawId !== undefined && rawId !== null ? String(rawId) : undefined;
            return { remoteId };
        }
        catch (publishError) {
            const errAny = publishError;
            const mediaAttached = Boolean(payload.media?.media_ids?.length);
            const forbidden = Number(errAny?.code ?? errAny?.status) === 403;
            if (mediaAttached && forbidden) {
                console.warn('[twitter] media tweet forbidden; retrying text-only');
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const retryTweet = await rw.v2.tweet({ text: caption });
                const rawRetryId = retryTweet?.data?.id;
                const remoteRetryId = rawRetryId !== undefined && rawRetryId !== null ? String(rawRetryId) : undefined;
                return { remoteId: remoteRetryId };
            }
            throw publishError;
        }
    }
    catch (error) {
        const errAny = error;
        console.error('[twitter] publish error', {
            message: error instanceof Error ? error.message : String(error),
            code: errAny?.code,
            status: errAny?.code ?? errAny?.status,
            data: errAny?.data ?? errAny?.response?.data,
            errors: errAny?.errors,
            rateLimit: errAny?.rateLimitError,
        });
        throw error;
    }
}

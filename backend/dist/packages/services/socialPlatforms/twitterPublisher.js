import axios from 'axios';
import { TwitterApi } from 'twitter-api-v2';
export async function publishToTwitter(input) {
    const { caption, imageUrls = [], credentials } = input;
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
        for (const url of imageUrls) {
            try {
                const res = await axios.get(url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(res.data);
                const contentType = res.headers['content-type'] ?? undefined;
                // uploadMedia accepts Buffer and optional mimeType
                // returns media id string
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const mediaId = await rw.v1.uploadMedia(buffer, { mimeType: contentType });
                mediaIds.push(String(mediaId));
            }
            catch (err) {
                console.warn('[twitter] media upload failed for', url, err instanceof Error ? err.message : err);
                throw err;
            }
        }
        // Post status with media if present
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const tweet = await rw.v1.tweet(caption, mediaIds.length ? { media_ids: mediaIds } : undefined);
        const rawId = tweet ? (tweet.id_str ?? tweet.id) : undefined;
        const remoteId = rawId !== undefined && rawId !== null ? String(rawId) : undefined;
        return { remoteId };
    }
    catch (error) {
        console.error('[twitter] publish error', error instanceof Error ? error.message : error);
        throw error;
    }
}

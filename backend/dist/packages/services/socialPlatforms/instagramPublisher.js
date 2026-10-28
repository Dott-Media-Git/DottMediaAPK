import axios from 'axios';
import { appendCommentToDmCaptionCta } from '../../../services/commentToDmService.js';
const http = axios.create({ timeout: Math.max(Number(process.env.SOCIAL_PUBLISH_HTTP_TIMEOUT_MS ?? 20000), 5000) });
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
const FACEBOOK_GRAPH_BASE_URL = 'https://graph.facebook.com';
const INSTAGRAM_GRAPH_BASE_URL = process.env.INSTAGRAM_GRAPH_BASE_URL ?? 'https://graph.instagram.com';
const READY_ATTEMPTS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_ATTEMPTS ?? 15), 3);
const READY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_MEDIA_READY_DELAY_MS ?? 2000), 1000);
const REELS_READY_ATTEMPTS = Math.max(Number(process.env.INSTAGRAM_REELS_READY_ATTEMPTS ?? 60), READY_ATTEMPTS);
const REELS_READY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_REELS_READY_DELAY_MS ?? 5000), READY_DELAY_MS);
const PUBLISH_RETRIES = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRIES ?? 2), 1);
const PUBLISH_RETRY_DELAY_MS = Math.max(Number(process.env.INSTAGRAM_PUBLISH_RETRY_DELAY_MS ?? 3000), 1000);
const CAROUSEL_MAX_IMAGES = Math.min(Math.max(Number(process.env.INSTAGRAM_CAROUSEL_MAX_IMAGES ?? 5), 2), 10);
function formatInstagramError(error, fallback) {
    const apiError = error?.response?.data?.error;
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
function logInstagramError(label, error) {
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
function normalizeGraphBaseUrl(value) {
    return (value || '').replace(/\/+$/, '');
}
function getInstagramGraphBaseUrl(credentials) {
    const graphOrigin = credentials.provider === 'instagram_login'
        ? normalizeGraphBaseUrl(credentials.graphBaseUrl) || INSTAGRAM_GRAPH_BASE_URL
        : FACEBOOK_GRAPH_BASE_URL;
    return `${normalizeGraphBaseUrl(graphOrigin)}/${GRAPH_VERSION}/${credentials.accountId}`;
}
function getInstagramMediaStatusUrl(credentials, creationId) {
    const graphOrigin = credentials.provider === 'instagram_login'
        ? normalizeGraphBaseUrl(credentials.graphBaseUrl) || INSTAGRAM_GRAPH_BASE_URL
        : FACEBOOK_GRAPH_BASE_URL;
    return `${normalizeGraphBaseUrl(graphOrigin)}/${GRAPH_VERSION}/${creationId}`;
}
export async function publishToInstagram(input) {
    const { credentials } = input;
    if (!credentials?.instagram) {
        throw new Error('Missing Instagram credentials');
    }
    const { accessToken } = credentials.instagram;
    const caption = appendCommentToDmCaptionCta(input.caption, { username: credentials.instagram.username });
    const baseUrl = getInstagramGraphBaseUrl(credentials.instagram);
    if (!input.imageUrls || input.imageUrls.length === 0) {
        throw new Error('Instagram requires an image');
    }
    try {
        let creationId;
        if (input.imageUrls.length > 1) {
            const childContainers = [];
            for (const imageUrl of input.imageUrls.slice(0, CAROUSEL_MAX_IMAGES)) {
                const childResponse = await http.post(`${baseUrl}/media`, {
                    image_url: imageUrl,
                    is_carousel_item: true,
                    access_token: accessToken,
                });
                const childId = childResponse.data?.id;
                if (!childId) {
                    throw new Error('Failed to create Instagram carousel item');
                }
                const childReady = await waitForMediaReady(credentials.instagram, childId, accessToken, READY_ATTEMPTS, READY_DELAY_MS);
                if (!childReady) {
                    throw new Error('Instagram carousel item not ready for publishing');
                }
                childContainers.push(childId);
            }
            const carouselResponse = await http.post(`${baseUrl}/media`, {
                media_type: 'CAROUSEL',
                children: childContainers.join(','),
                caption,
                access_token: accessToken,
            });
            creationId = carouselResponse.data?.id;
        }
        else {
            // Step 1: Create Media Container
            const createMediaResponse = await http.post(`${baseUrl}/media`, {
                image_url: input.imageUrls[0],
                caption,
                access_token: accessToken,
            });
            creationId = createMediaResponse.data.id;
        }
        if (!creationId) {
            throw new Error('Failed to create Instagram media container');
        }
        // Wait for the media container to finish processing before publishing.
        const isReady = await waitForMediaReady(credentials.instagram, creationId, accessToken, READY_ATTEMPTS, READY_DELAY_MS);
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
            await verifyPublishedMedia(credentials.instagram, publishedId, accessToken, true);
            return { remoteId: publishedId };
        }
        throw new Error('No ID returned from Instagram publish');
    }
    catch (error) {
        logInstagramError('Instagram publish error:', error);
        throw new Error(formatInstagramError(error, 'Instagram publish failed'));
    }
}
export async function publishToInstagramReel(input) {
    const { credentials } = input;
    if (!credentials?.instagram) {
        throw new Error('Missing Instagram credentials');
    }
    if (!input.videoUrl) {
        throw new Error('Instagram Reels requires a video URL');
    }
    const { accessToken } = credentials.instagram;
    const caption = appendCommentToDmCaptionCta(input.caption, { username: credentials.instagram.username });
    const baseUrl = getInstagramGraphBaseUrl(credentials.instagram);
    try {
        const createMediaResponse = await http.post(`${baseUrl}/media`, {
            media_type: 'REELS',
            video_url: input.videoUrl,
            caption,
            access_token: accessToken,
        });
        const creationId = createMediaResponse.data.id;
        if (!creationId) {
            throw new Error('Failed to create Instagram Reels container');
        }
        const isReady = await waitForMediaReady(credentials.instagram, creationId, accessToken, REELS_READY_ATTEMPTS, REELS_READY_DELAY_MS);
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
            await verifyPublishedMedia(credentials.instagram, publishedId, accessToken, true);
            return { remoteId: publishedId };
        }
        throw new Error('No ID returned from Instagram Reels publish');
    }
    catch (error) {
        logInstagramError('Instagram Reels publish error:', error);
        throw new Error(formatInstagramError(error, 'Instagram Reels publish failed'));
    }
}
export async function publishToInstagramStory(input) {
    const { credentials } = input;
    if (!credentials?.instagram) {
        throw new Error('Missing Instagram credentials');
    }
    const { accessToken } = credentials.instagram;
    const baseUrl = getInstagramGraphBaseUrl(credentials.instagram);
    const hasVideo = Boolean(input.videoUrl);
    const mediaUrl = hasVideo ? input.videoUrl : input.imageUrls?.[0];
    if (!mediaUrl) {
        throw new Error('Instagram Story requires an image or video URL');
    }
    try {
        const createMediaResponse = await http.post(`${baseUrl}/media`, {
            media_type: 'STORIES',
            ...(hasVideo ? { video_url: mediaUrl } : { image_url: mediaUrl }),
            access_token: accessToken,
        });
        const creationId = createMediaResponse.data.id;
        if (!creationId) {
            throw new Error('Failed to create Instagram Story container');
        }
        const isReady = await waitForMediaReady(credentials.instagram, creationId, accessToken, READY_ATTEMPTS, READY_DELAY_MS);
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
            // Story publishing already returns a successful remote ID. Story objects are
            // ephemeral and the media endpoint does not consistently expose a permalink,
            // so a post-publish verification poll can hold the queue for minutes.
            if (process.env.INSTAGRAM_STORY_VERIFY === 'true') {
                await verifyPublishedMedia(credentials.instagram, publishedId, accessToken, false);
            }
            return { remoteId: publishedId };
        }
        throw new Error('No ID returned from Instagram Story publish');
    }
    catch (error) {
        logInstagramError('Instagram Story publish error:', error);
        throw new Error(formatInstagramError(error, 'Instagram Story publish failed'));
    }
}
async function waitForMediaReady(credentials, creationId, accessToken, maxAttempts = 5, delayMs = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const statusResp = await http.get(getInstagramMediaStatusUrl(credentials, creationId), {
            params: { fields: 'status_code,status', access_token: accessToken },
        });
        const status = statusResp.data?.status_code;
        if (status === 'FINISHED')
            return true;
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
async function publishWithRetry({ baseUrl, creationId, accessToken, retries, retryDelayMs, }) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const publishResponse = await http.post(`${baseUrl}/media_publish`, {
                creation_id: creationId,
                access_token: accessToken,
            });
            if (publishResponse.data && publishResponse.data.id) {
                return publishResponse.data.id;
            }
            throw new Error('No ID returned from Instagram publish');
        }
        catch (error) {
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
async function verifyPublishedMedia(credentials, publishedId, accessToken, requirePermalink) {
    let lastError;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            const response = await http.get(getInstagramMediaStatusUrl(credentials, publishedId), {
                params: {
                    fields: 'id,permalink,timestamp,media_type,username',
                    access_token: accessToken,
                },
            });
            const media = response.data ?? {};
            const idMatches = String(media.id ?? '') === String(publishedId);
            const hasPublicIdentity = Boolean(media.timestamp || media.media_type || media.username);
            if (idMatches && hasPublicIdentity && (!requirePermalink || media.permalink)) {
                return media;
            }
            lastError = new Error('Instagram returned a container ID but no confirmed public media');
        }
        catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(formatInstagramError(lastError, 'Instagram did not confirm that the media is publicly visible'));
}

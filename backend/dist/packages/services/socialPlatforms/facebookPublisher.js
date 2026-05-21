import axios from 'axios';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';
const FACEBOOK_ALBUM_MAX_IMAGES = Math.min(Math.max(Number(process.env.FACEBOOK_ALBUM_MAX_IMAGES ?? 6), 2), 10);
const isPayloadSizeError = (error) => {
    const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
    return (message.includes('reduce the amount of data') ||
        message.includes('too much data') ||
        message.includes('request entity') ||
        message.includes('attached_media'));
};
const resolveFacebookAnalyticsId = async (objectId, accessToken) => {
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${objectId}`, {
            params: {
                fields: 'page_story_id,post_id',
                access_token: accessToken,
            },
            timeout: 20000,
        });
        return response.data?.page_story_id || response.data?.post_id || objectId;
    }
    catch {
        return objectId;
    }
};
export async function publishToFacebook(input) {
    const { credentials } = input;
    if (!credentials?.facebook) {
        throw new Error('Missing Facebook credentials');
    }
    const { accessToken, pageId } = credentials.facebook;
    const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`;
    const publishSinglePhoto = () => axios.post(`${baseUrl}/photos`, {
        url: input.imageUrls[0],
        message: input.caption,
        access_token: accessToken,
    });
    try {
        let response;
        if (input.videoUrl) {
            response = await axios.post(`${baseUrl}/videos`, {
                file_url: input.videoUrl,
                description: input.caption,
                access_token: accessToken,
            });
        }
        else if (input.imageUrls && input.imageUrls.length > 1) {
            try {
                const photoUploads = await Promise.all(input.imageUrls.slice(0, FACEBOOK_ALBUM_MAX_IMAGES).map(url => axios.post(`${baseUrl}/photos`, {
                    url,
                    published: false,
                    access_token: accessToken,
                })));
                const attached_media = photoUploads
                    .map(upload => upload.data?.id)
                    .filter(Boolean)
                    .map(id => ({ media_fbid: id }));
                if (!attached_media.length) {
                    throw new Error('No Facebook photo IDs returned for multi-photo post');
                }
                response = await axios.post(`${baseUrl}/feed`, {
                    message: input.caption,
                    attached_media,
                    access_token: accessToken,
                });
            }
            catch (error) {
                if (!isPayloadSizeError(error))
                    throw error;
                console.warn('Facebook multi-photo publish too large; retrying with single cover image');
                response = await publishSinglePhoto();
            }
        }
        else if (input.imageUrls && input.imageUrls.length > 0) {
            // Post photo
            response = await publishSinglePhoto();
        }
        else {
            // Post text only
            response = await axios.post(`${baseUrl}/feed`, {
                message: input.caption,
                access_token: accessToken,
            });
        }
        if (response.data && response.data.id) {
            const analyticsId = response.data.post_id ||
                response.data.page_story_id ||
                (await resolveFacebookAnalyticsId(response.data.id, accessToken));
            return { remoteId: analyticsId || response.data.id };
        }
        throw new Error('No ID returned from Facebook');
    }
    catch (error) {
        console.error('Facebook publish error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || 'Facebook publish failed');
    }
}
export async function publishToFacebookStory(input) {
    const { credentials } = input;
    if (!credentials?.facebook) {
        throw new Error('Missing Facebook credentials');
    }
    const { accessToken, pageId } = credentials.facebook;
    const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`;
    const mediaUrl = input.videoUrl || input.imageUrls?.[0];
    if (!mediaUrl) {
        throw new Error('Facebook Story requires an image or video URL');
    }
    try {
        if (!input.videoUrl) {
            const photoResponse = await axios.post(`${baseUrl}/photos`, {
                url: mediaUrl,
                published: false,
                access_token: accessToken,
            });
            const photoId = photoResponse.data?.id;
            if (!photoId) {
                throw new Error('No photo ID returned from Facebook Story upload');
            }
            const storyResponse = await axios.post(`${baseUrl}/photo_stories`, {
                photo_id: photoId,
                access_token: accessToken,
            });
            if (storyResponse.data?.success || storyResponse.data?.post_id) {
                return { remoteId: storyResponse.data?.post_id ?? photoId };
            }
            throw new Error('No ID returned from Facebook Story publish');
        }
        const payload = {
            access_token: accessToken,
            file_url: mediaUrl,
        };
        const response = await axios.post(`${baseUrl}/stories`, payload);
        if (response.data && response.data.id) {
            return { remoteId: response.data.id };
        }
        throw new Error('No ID returned from Facebook Story');
    }
    catch (error) {
        console.error('Facebook Story publish error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || 'Facebook Story publish failed');
    }
}

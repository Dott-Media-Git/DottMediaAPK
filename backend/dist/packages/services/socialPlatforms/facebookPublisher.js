import axios from 'axios';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';
export async function publishToFacebook(input) {
    const { credentials } = input;
    if (!credentials?.facebook) {
        throw new Error('Missing Facebook credentials');
    }
    const { accessToken, pageId } = credentials.facebook;
    const baseUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`;
    try {
        let response;
        if (input.videoUrl) {
            response = await axios.post(`${baseUrl}/videos`, {
                file_url: input.videoUrl,
                description: input.caption,
                access_token: accessToken,
            });
        }
        else if (input.imageUrls && input.imageUrls.length > 0) {
            // Post photo
            response = await axios.post(`${baseUrl}/photos`, {
                url: input.imageUrls[0],
                message: input.caption,
                access_token: accessToken,
            });
        }
        else {
            // Post text only
            response = await axios.post(`${baseUrl}/feed`, {
                message: input.caption,
                access_token: accessToken,
            });
        }
        if (response.data && response.data.id) {
            return { remoteId: response.data.id };
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
        const payload = {
            access_token: accessToken,
            ...(input.videoUrl ? { file_url: mediaUrl } : { image_url: mediaUrl }),
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

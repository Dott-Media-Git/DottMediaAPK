import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  credentials?: SocialAccounts;
};

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';

const resolveFacebookAnalyticsId = async (objectId: string, accessToken: string) => {
  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${objectId}`, {
      params: {
        fields: 'page_story_id,post_id',
        access_token: accessToken,
      },
      timeout: 20000,
    });
    return response.data?.page_story_id || response.data?.post_id || objectId;
  } catch {
    return objectId;
  }
};

export async function publishToFacebook(input: PublishInput): Promise<{ remoteId?: string }> {
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
    } else if (input.imageUrls && input.imageUrls.length > 0) {
      // Post photo
      response = await axios.post(`${baseUrl}/photos`, {
        url: input.imageUrls[0],
        message: input.caption,
        access_token: accessToken,
      });
    } else {
      // Post text only
      response = await axios.post(`${baseUrl}/feed`, {
        message: input.caption,
        access_token: accessToken,
      });
    }

    if (response.data && response.data.id) {
      const analyticsId =
        response.data.post_id ||
        response.data.page_story_id ||
        (await resolveFacebookAnalyticsId(response.data.id, accessToken));
      return { remoteId: analyticsId || response.data.id };
    }
    throw new Error('No ID returned from Facebook');
  } catch (error: any) {
    console.error('Facebook publish error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Facebook publish failed');
  }
}

export async function publishToFacebookStory(input: PublishInput): Promise<{ remoteId?: string }> {
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
  } catch (error: any) {
    console.error('Facebook Story publish error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Facebook Story publish failed');
  }
}

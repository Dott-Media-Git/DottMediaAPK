import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  credentials?: SocialAccounts;
};

export async function publishToFacebook(input: PublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  if (!credentials?.facebook) {
    throw new Error('Missing Facebook credentials');
  }

  const { accessToken, pageId } = credentials.facebook;
  const baseUrl = `https://graph.facebook.com/v18.0/${pageId}`;

  try {
    let response;
    if (input.imageUrls && input.imageUrls.length > 0) {
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
      return { remoteId: response.data.id };
    }
    throw new Error('No ID returned from Facebook');
  } catch (error: any) {
    console.error('Facebook publish error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Facebook publish failed');
  }
}

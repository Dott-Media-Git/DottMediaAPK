import axios from 'axios';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  credentials?: SocialAccounts;
};

export async function publishToInstagram(input: PublishInput): Promise<{ remoteId?: string }> {
  const { credentials } = input;
  if (!credentials?.instagram) {
    throw new Error('Missing Instagram credentials');
  }

  const { accessToken, accountId } = credentials.instagram;
  const baseUrl = `https://graph.facebook.com/v18.0/${accountId}`;

  if (!input.imageUrls || input.imageUrls.length === 0) {
    throw new Error('Instagram requires an image');
  }

  try {
    // Step 1: Create Media Container
    const createMediaResponse = await axios.post(`${baseUrl}/media`, {
      image_url: input.imageUrls[0],
      caption: input.caption,
      access_token: accessToken,
    });

    const creationId = createMediaResponse.data.id;
    if (!creationId) {
      throw new Error('Failed to create Instagram media container');
    }

    // Step 2: Publish Media
    const publishResponse = await axios.post(`${baseUrl}/media_publish`, {
      creation_id: creationId,
      access_token: accessToken,
    });

    if (publishResponse.data && publishResponse.data.id) {
      return { remoteId: publishResponse.data.id };
    }
    throw new Error('No ID returned from Instagram publish');
  } catch (error: any) {
    console.error('Instagram publish error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Instagram publish failed');
  }
}

import axios from 'axios';
import { config } from '../../../../config';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';

type Recipient = { username?: string; id?: string };

const resolveIgUserId = async (username: string): Promise<string | null> => {
  try {
    const lookupUrl = `https://graph.facebook.com/${GRAPH_VERSION}/ig_username`;
    const response = await axios.get(lookupUrl, {
      params: { username, fields: 'id', access_token: config.channels.instagram.accessToken },
    });
    return typeof response.data?.id === 'string' ? response.data.id : null;
  } catch (error) {
    console.warn('[instagram] failed to resolve username to id', error);
    return null;
  }
};

/**
 * Sends a Meta Graph API DM using the IG business account message endpoint.
 * Prefers recipient.id; will attempt to resolve username to id, otherwise skips to avoid API 400.
 */
export async function sendInstagramMessage(recipient: string | undefined, text: string) {
  if (!recipient) {
    throw new Error('Instagram recipient missing for prospect.');
  }

  const businessId = config.channels.instagram.businessId;
  if (!businessId || !config.channels.instagram.accessToken) {
    console.info('[instagram] skipping send; channel disabled');
    return;
  }

  let recipientId: string | null = null;
  // If the caller passed a numeric/string id, use it; otherwise try lookup by username.
  if (/^\d+$/.test(recipient)) {
    recipientId = recipient;
  } else {
    recipientId = await resolveIgUserId(recipient);
  }

  if (!recipientId) {
    console.warn('[instagram] unable to resolve recipient id; skipping DM');
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/messages`;
  await axios.post(
    url,
    {
      recipient: { id: recipientId } as Recipient,
      messaging_type: 'UPDATE',
      message: { text },
    },
    {
      headers: {
        Authorization: `Bearer ${config.channels.instagram.accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );
}

export async function likeInstagramMedia(mediaId: string | undefined) {
  if (!mediaId || !config.channels.instagram.accessToken) return;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/likes`;
  await axios.post(url, null, {
    params: { access_token: config.channels.instagram.accessToken },
  });
}

export async function commentInstagramMedia(mediaId: string | undefined, text: string) {
  if (!mediaId || !config.channels.instagram.accessToken) return;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/comments`;
  await axios.post(url, null, {
    params: { access_token: config.channels.instagram.accessToken, message: text },
  });
}

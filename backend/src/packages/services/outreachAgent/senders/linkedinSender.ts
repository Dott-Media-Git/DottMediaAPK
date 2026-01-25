import axios from 'axios';
import { config } from '../../../../config';

const LINKEDIN_API_URL = 'https://api.linkedin.com/rest/messages';
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION ?? '202404';

/**
 * Sends a LinkedIn conversation message via the official REST endpoint.
 * TODO: swap slug-based URN derivation with a profile lookup service when available.
 */
export async function sendLinkedInMessage(profileUrl: string | undefined, text: string) {
  if (!profileUrl) {
    throw new Error('LinkedIn profile URL missing for prospect.');
  }

  const recipientUrn = buildRecipientUrn(profileUrl);
  if (!recipientUrn) {
    console.warn(`[linkedin] unable to derive URN from ${profileUrl}; skipping send`);
    return;
  }

  const senderCompany = config.linkedin.organizationId ? `urn:li:organization:${config.linkedin.organizationId}` : undefined;

  try {
    await axios.post(
      LINKEDIN_API_URL,
      {
        recipients: [recipientUrn],
        message: {
          body: text,
          subject: 'AI Automation for your team',
        },
        senderCompany,
      },
      {
        headers: {
          Authorization: `Bearer ${config.linkedin.accessToken}`,
          'Content-Type': 'application/json',
          'Linkedin-Version': LINKEDIN_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );
  } catch (error) {
    console.warn('[linkedin] send failed; continuing outreach', (error as Error).message);
  }
}

function buildRecipientUrn(profileUrl: string) {
  if (profileUrl.startsWith('urn:li:person:')) {
    return profileUrl;
  }
  const slugMatch = profileUrl.match(/linkedin\.com\/in\/([a-z0-9\-_%]+)/i);
  if (slugMatch?.[1]) {
    return `urn:li:person:${slugMatch[1]}`;
  }
  return null;
}

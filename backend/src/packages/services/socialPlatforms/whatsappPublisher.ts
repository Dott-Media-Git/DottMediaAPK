import axios from 'axios';
import { config } from '../../../config';
import { SocialAccounts } from '../socialPostingService';

type PublishInput = {
  caption: string;
  imageUrls: string[];
  videoUrl?: string;
  credentials?: SocialAccounts;
};

type WhatsAppCredentials = NonNullable<SocialAccounts['whatsapp']>;

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v19.0';

const splitRecipients = (value?: string | string[]) => {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value ?? '')
    .split(/[,\n]/g)
    .map(item => item.trim())
    .filter(Boolean);
};

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, '');

const resolveCredentials = (credentials?: SocialAccounts): WhatsAppCredentials | null => {
  if (credentials?.whatsapp?.accessToken && credentials.whatsapp.phoneNumberId) {
    return credentials.whatsapp;
  }
  if (config.whatsapp.token && config.whatsapp.phoneNumberId) {
    return {
      accessToken: config.whatsapp.token,
      phoneNumberId: config.whatsapp.phoneNumberId,
      recipientPhoneNumbers: process.env.WHATSAPP_RECIPIENT_PHONE_NUMBERS ?? '',
    };
  }
  return null;
};

const buildTextBody = (input: PublishInput) => {
  const mediaLinks = [
    ...(input.imageUrls ?? []),
    input.videoUrl,
  ].filter(Boolean);
  return [input.caption, mediaLinks.length ? `Media: ${mediaLinks.join('\n')}` : '']
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n');
};

async function sendMessage(
  credentials: WhatsAppCredentials,
  to: string,
  payload: Record<string, unknown>,
) {
  const response = await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...payload,
    },
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );
  return response.data?.messages?.[0]?.id as string | undefined;
}

export async function publishToWhatsApp(input: PublishInput): Promise<{ remoteId?: string }> {
  const credentials = resolveCredentials(input.credentials);
  if (!credentials) {
    throw new Error('Missing WhatsApp credentials');
  }

  const recipients = splitRecipients(credentials.recipientPhoneNumbers).map(normalizePhone).filter(Boolean);
  if (!recipients.length) {
    throw new Error('WhatsApp recipientPhoneNumbers is required');
  }

  const body = buildTextBody(input);
  if (!body) {
    throw new Error('WhatsApp message body is required');
  }

  const remoteIds: string[] = [];
  for (const recipient of recipients) {
    const remoteId = await sendMessage(credentials, recipient, {
      type: 'text',
      text: { preview_url: true, body },
    });
    if (remoteId) remoteIds.push(remoteId);
  }

  return { remoteId: remoteIds.join(',') || undefined };
}

export async function publishToWhatsAppStatus(): Promise<{ remoteId?: string }> {
  throw new Error('WhatsApp Status publishing is not supported by the official WhatsApp Cloud API');
}

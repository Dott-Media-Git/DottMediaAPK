import axios from 'axios';
import { config } from '../../../config.js';
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v19.0';
const splitRecipients = (value) => {
    if (Array.isArray(value))
        return value.map(item => String(item).trim()).filter(Boolean);
    return String(value ?? '')
        .split(/[,\n]/g)
        .map(item => item.trim())
        .filter(Boolean);
};
const normalizePhone = (value) => value.replace(/[^\d+]/g, '');
const resolveCredentials = (credentials) => {
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
const buildTextBody = (input) => {
    const mediaLinks = [
        ...(input.imageUrls ?? []),
        input.videoUrl,
    ].filter(Boolean);
    return [input.caption, mediaLinks.length ? `Media: ${mediaLinks.join('\n')}` : '']
        .map(part => part.trim())
        .filter(Boolean)
        .join('\n\n');
};
async function sendMessage(credentials, to, payload) {
    const response = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${credentials.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...payload,
    }, {
        headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json',
        },
    });
    return response.data?.messages?.[0]?.id;
}
export async function publishToWhatsApp(input) {
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
    const remoteIds = [];
    for (const recipient of recipients) {
        const remoteId = await sendMessage(credentials, recipient, {
            type: 'text',
            text: { preview_url: true, body },
        });
        if (remoteId)
            remoteIds.push(remoteId);
    }
    return { remoteId: remoteIds.join(',') || undefined };
}
export async function publishToWhatsAppStatus() {
    throw new Error('WhatsApp Status publishing is not supported by the official WhatsApp Cloud API');
}

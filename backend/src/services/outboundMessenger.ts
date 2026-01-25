import axios from 'axios';
import { config } from '../config';
import { Platform } from '../types/bot';
import { withRetry } from '../utils/retry';

export class OutboundMessenger {
  async send(platform: Platform, recipientId: string, text: string) {
    await withRetry(() => this.dispatch(platform, recipientId, text));
  }

  private async dispatch(platform: Platform, recipientId: string, text: string) {
    switch (platform) {
      case 'whatsapp':
        if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
          console.info('[outbound] WhatsApp disabled; skipping send');
          return;
        }
        await axios.post(
          `https://graph.facebook.com/v19.0/${config.whatsapp.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: recipientId,
            type: 'text',
            text: { preview_url: false, body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${config.whatsapp.token}`,
              'Content-Type': 'application/json',
            },
          },
        );
        return;
      case 'facebook':
        await axios.post(
          'https://graph.facebook.com/v19.0/me/messages',
          {
            recipient: { id: recipientId },
            messaging_type: 'RESPONSE',
            message: { text },
          },
          { params: { access_token: config.channels.facebook.pageToken } },
        );
        return;
      case 'instagram':
        await axios.post(
          `https://graph.facebook.com/v19.0/${config.channels.instagram.businessId}/messages`,
          {
            recipient: { id: recipientId },
            message: { text },
          },
          { params: { access_token: config.channels.instagram.accessToken } },
        );
        return;
      case 'threads':
        if (!config.channels.threads.profileId || !config.channels.threads.accessToken) {
          console.info('[outbound] Threads disabled; skipping send');
          return;
        }
        await axios.post(
          `https://graph.facebook.com/v19.0/${config.channels.threads.profileId}/messages`,
          {
            recipient: { id: recipientId },
            message: { text },
          },
          { params: { access_token: config.channels.threads.accessToken } },
        );
        return;
      case 'linkedin':
        await axios.post(
          'https://api.linkedin.com/v2/messages',
          {
            recipients: { values: [{ person: recipientId }] },
            subject: 'Dott Media',
            body: text,
          },
          {
            headers: {
              Authorization: `Bearer ${config.linkedin.accessToken}`,
              'X-Restli-Protocol-Version': '2.0.0',
            },
          },
        );
        return;
      case 'web':
        // For web widget we do not need to dispatch externally; handled client-side.
        return;
      default:
        throw new Error(`Unsupported platform ${platform}`);
    }
  }
}

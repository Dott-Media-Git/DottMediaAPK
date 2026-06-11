import axios from 'axios';
import { config } from '../config';
import { Platform } from '../types/bot';
import { withRetry } from '../utils/retry';

export class OutboundMessenger {
  async send(platform: Platform, recipientId: string, text: string, options: { userId?: string } = {}) {
    await withRetry(() => this.dispatch(platform, recipientId, text, options));
  }

  private async dispatch(platform: Platform, recipientId: string, text: string, options: { userId?: string }) {
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
        {
          const { getFacebookPageToken, resolveFacebookPageAccount } = await import('./facebookAccountRegistry.js');
          const account = resolveFacebookPageAccount({ userId: options.userId });
          const pageToken = (account ? getFacebookPageToken(account) : '') || config.channels.facebook.pageToken;
          if (!pageToken) {
            console.info('[outbound] Facebook disabled; skipping send');
            return;
          }
          await axios.post(
            'https://graph.facebook.com/v19.0/me/messages',
            {
              recipient: { id: recipientId },
              messaging_type: 'RESPONSE',
              message: { text },
            },
            { params: { access_token: pageToken } },
          );
        }
        return;
      case 'instagram':
        {
          const { getInstagramLoginToken, resolveInstagramLoginAccount } = await import('./instagramAccountRegistry.js');
          const account = resolveInstagramLoginAccount({ userId: options.userId });
          const loginToken = account ? getInstagramLoginToken(account) : '';
          if (account && loginToken && /^\d+$/.test(recipientId)) {
            await axios.post(
              'https://graph.instagram.com/me/messages',
              {
                recipient: { id: recipientId },
                message: { text },
              },
              {
                params: { access_token: loginToken },
                headers: { 'Content-Type': 'application/json' },
              },
            );
            return;
          }
          if (account && loginToken && !config.channels.instagram.businessId) {
            throw new Error('Instagram Login outbound requires a numeric Instagram recipient ID from an existing conversation.');
          }
          if (!config.channels.instagram.businessId || !config.channels.instagram.accessToken) {
            console.info('[outbound] Instagram disabled; skipping send');
            return;
          }
          await axios.post(
            `https://graph.facebook.com/v19.0/${config.channels.instagram.businessId}/messages`,
            {
              recipient: { id: recipientId },
              message: { text },
            },
            { params: { access_token: config.channels.instagram.accessToken } },
          );
        }
        return;
      case 'threads':
        console.info('[outbound] Threads private messaging is not supported by the official Threads API; skipping send');
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

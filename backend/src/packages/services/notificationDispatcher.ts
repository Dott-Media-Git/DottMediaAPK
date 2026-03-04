import axios from 'axios';
import admin from 'firebase-admin';
import { config } from '../../config';
import { firestore } from '../../db/firestore';
import { sendLinkedInMessage } from './outreachAgent/senders/linkedinSender';
import { sendInstagramMessage } from './outreachAgent/senders/instagramSender';
import { sendWhatsAppMessage } from './outreachAgent/senders/whatsappSender';

const notificationsCollection = firestore.collection('notifications');

type ChannelMessage = {
  channel: string;
  leadId: string;
  recipient: string;
  type?: string;
  payload: {
    text: string;
    metadata?: Record<string, unknown>;
  };
};

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';

export class NotificationDispatcher {
  private timer?: NodeJS.Timeout;
  private isFlushing = false;
  private quotaBackoffUntilMs = 0;
  private readonly defaultIntervalMs = Math.max(Number(process.env.NOTIFICATION_DISPATCH_INTERVAL_MS ?? 60000), 10000);
  private readonly quotaBackoffMs = Math.max(Number(process.env.NOTIFICATION_QUOTA_BACKOFF_MS ?? 900000), 60000);

  start(intervalMs = this.defaultIntervalMs) {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), intervalMs);
    void this.flush();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async flush() {
    if (this.isFlushing) return;
    if (Date.now() < this.quotaBackoffUntilMs) return;
    this.isFlushing = true;
    try {
      const snapshot = await notificationsCollection.where('status', '==', 'pending').limit(10).get();

      for (const doc of snapshot.docs) {
        const data = doc.data() as ChannelMessage & { attempts?: number };
        if (data.type && data.type !== 'channel_message') continue;
        await doc.ref.update({
          status: 'sending',
          lastTriedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        try {
          await this.dispatch(data);
          await doc.ref.update({
            status: 'sent',
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          const attempts = (data.attempts ?? 0) + 1;
          console.warn('Channel notification dispatch failed', error);
          await doc.ref.update({
            status: attempts >= 3 ? 'failed' : 'pending',
            attempts,
            lastError: (error as Error).message,
          });
        }
      }
    } catch (error) {
      if (this.isFirestoreQuotaError(error)) {
        this.quotaBackoffUntilMs = Date.now() + this.quotaBackoffMs;
        console.warn(
          `Notification dispatcher entering quota backoff for ${Math.round(this.quotaBackoffMs / 60000)}m due to Firestore RESOURCE_EXHAUSTED.`,
        );
      }
      console.error('Notification dispatcher flush failed', error);
    } finally {
      this.isFlushing = false;
    }
  }

  private isFirestoreQuotaError(error: unknown) {
    const raw = error as { message?: string; code?: number };
    if (raw?.code === 8) return true;
    const message = (raw?.message ?? '').toLowerCase();
    return message.includes('resource_exhausted') || message.includes('quota exceeded');
  }

  private async dispatch(message: ChannelMessage) {
    const text = message.payload.text;
    const metadata = message.payload.metadata as Record<string, unknown> | undefined;

    if (message.channel === 'facebook') {
      const commentId = typeof metadata?.commentId === 'string' ? metadata.commentId : undefined;
      if (commentId) {
        await replyToFacebookComment(commentId, text);
        return;
      }
      if (!message.recipient) {
        throw new Error('Missing recipient for Facebook dispatch');
      }
      await sendFacebookMessage(message.recipient, text);
      return;
    }

    if (!message.recipient) {
      throw new Error('Missing recipient for channel dispatch');
    }
    if (message.channel === 'linkedin') {
      await sendLinkedInMessage(message.recipient, text);
      return;
    }
    if (message.channel === 'instagram') {
      await sendInstagramMessage(message.recipient, text);
      return;
    }
    if (message.channel === 'whatsapp') {
      await sendWhatsAppMessage(message.recipient, text);
      return;
    }
    if (message.channel === 'web' || message.channel === 'outbound') {
      console.info(`No external dispatch needed for channel ${message.channel}`);
      return;
    }
    console.info(`Unsupported channel ${message.channel}, marking as sent without dispatch`);
  }
}

async function replyToFacebookComment(commentId: string, text: string) {
  if (!config.channels.facebook.pageToken) {
    throw new Error('Facebook page token missing; cannot reply to comment');
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/comments`;
  await axios.post(url, null, {
    params: { message: text, access_token: config.channels.facebook.pageToken },
  });
}

async function sendFacebookMessage(recipientId: string, text: string) {
  if (!config.channels.facebook.pageToken) {
    console.info('[facebook] skipping send; channel disabled');
    return;
  }
  await axios.post(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text },
    },
    { params: { access_token: config.channels.facebook.pageToken } },
  );
}

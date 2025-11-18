import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';
import { sendLinkedInMessage } from './outreachAgent/senders/linkedinSender';
import { sendInstagramMessage } from './outreachAgent/senders/instagramSender';
import { sendWhatsAppMessage } from './outreachAgent/senders/whatsappSender';

const notificationsCollection = firestore.collection('notifications');

type ChannelMessage = {
  channel: string;
  leadId: string;
  recipient: string;
  payload: {
    text: string;
    metadata?: Record<string, unknown>;
  };
};

export class NotificationDispatcher {
  private timer?: NodeJS.Timeout;
  private isFlushing = false;

  start(intervalMs = 10000) {
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
    this.isFlushing = true;
    try {
      const snapshot = await notificationsCollection
        .where('type', '==', 'channel_message')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(10)
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data() as ChannelMessage & { attempts?: number };
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
      console.error('Notification dispatcher flush failed', error);
    } finally {
      this.isFlushing = false;
    }
  }

  private async dispatch(message: ChannelMessage) {
    if (!message.recipient) {
      throw new Error('Missing recipient for channel dispatch');
    }
    const text = message.payload.text;
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

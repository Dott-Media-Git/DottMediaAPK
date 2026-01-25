import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';

type FacebookWebhookPayload = {
  entry?: Array<{
    messaging?: Array<{
      sender?: { id: string };
      message?: { mid: string; text?: string };
      timestamp?: number;
    }>;
  }>;
};

export class FacebookService {
  private conversations = new ConversationService();
  private messenger = new OutboundMessenger();

  async handleWebhook(body: FacebookWebhookPayload) {
    const messages = body.entry?.flatMap(entry => entry.messaging ?? []) ?? [];
    let processed = 0;

    for (const message of messages) {
      if (!message.message?.text || !message.sender?.id) continue;
      const timestamp = message.timestamp ?? Date.now();
      const response = await this.conversations.handleMessage({
        platform: 'facebook',
        userId: message.sender.id,
        channelUserId: message.sender.id,
        messageId: message.message.mid,
        message: message.message.text,
        timestamp,
      });

      try {
        await this.messenger.send('facebook', message.sender.id, response.reply);
        await this.conversations.updateReplyStatus(response.messageDocId, 'sent');
      } catch (error) {
        await this.conversations.updateReplyStatus(response.messageDocId, 'failed', (error as Error).message);
        throw error;
      }
      processed += 1;
    }

    return processed;
  }
}

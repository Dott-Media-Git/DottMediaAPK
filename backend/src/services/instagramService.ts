import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';

type InstagramWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messaging_product?: string;
        messages?: Array<{
          id: string;
          from: string;
          text?: { body: string };
          timestamp?: string;
        }>;
      };
    }>;
  }>;
};

export class InstagramService {
  private conversations = new ConversationService();
  private messenger = new OutboundMessenger();

  async handleWebhook(body: InstagramWebhookPayload) {
    const messages =
      body.entry?.flatMap(entry => entry.changes?.flatMap(change => change.value?.messages ?? []) ?? []) ?? [];
    let processed = 0;

    for (const message of messages) {
      if (!message.text?.body) continue;
      const timestamp = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();
      const response = await this.conversations.handleMessage({
        platform: 'instagram',
        userId: message.from,
        channelUserId: message.from,
        messageId: message.id,
        message: message.text.body,
        timestamp,
      });
      await this.messenger.send('instagram', message.from, response.reply);
      processed += 1;
    }

    return processed;
  }
}

import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';

type LinkedInWebhookPayload = {
  events?: Array<{
    id: string;
    sender?: { urn: string; name?: string };
    body?: string;
    timestamp?: number;
  }>;
};

export class LinkedInService {
  private conversations = new ConversationService();
  private messenger = new OutboundMessenger();

  async handleWebhook(body: LinkedInWebhookPayload) {
    const events = body.events ?? [];
    let processed = 0;

    for (const event of events) {
      if (!event.body || !event.sender?.urn) continue;
      const timestamp = event.timestamp ?? Date.now();
      const response = await this.conversations.handleMessage({
        platform: 'linkedin',
        userId: event.sender.urn,
        channelUserId: event.sender.urn,
        messageId: event.id,
        message: event.body,
        profile: { name: event.sender.name },
        timestamp,
      });
      try {
        await this.messenger.send('linkedin', event.sender.urn, response.reply);
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

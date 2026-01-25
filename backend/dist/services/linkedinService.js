import { ConversationService } from './conversationService.js';
import { OutboundMessenger } from './outboundMessenger.js';
export class LinkedInService {
    constructor() {
        this.conversations = new ConversationService();
        this.messenger = new OutboundMessenger();
    }
    async handleWebhook(body) {
        const events = body.events ?? [];
        let processed = 0;
        for (const event of events) {
            if (!event.body || !event.sender?.urn)
                continue;
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
            }
            catch (error) {
                await this.conversations.updateReplyStatus(response.messageDocId, 'failed', error.message);
                throw error;
            }
            processed += 1;
        }
        return processed;
    }
}

import { ConversationService } from './conversationService.js';
import { OutboundMessenger } from './outboundMessenger.js';
export class InstagramService {
    constructor() {
        this.conversations = new ConversationService();
        this.messenger = new OutboundMessenger();
    }
    async handleWebhook(body) {
        const messages = body.entry?.flatMap(entry => entry.changes?.flatMap(change => change.value?.messages ?? []) ?? []) ?? [];
        let processed = 0;
        for (const message of messages) {
            if (!message.text?.body)
                continue;
            const timestamp = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();
            const response = await this.conversations.handleMessage({
                platform: 'instagram',
                userId: message.from,
                channelUserId: message.from,
                messageId: message.id,
                message: message.text.body,
                timestamp,
            });
            try {
                await this.messenger.send('instagram', message.from, response.reply);
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

import { ConversationService } from './conversationService.js';
import { OutboundMessenger } from './outboundMessenger.js';
export class WhatsAppService {
    constructor() {
        this.conversations = new ConversationService();
        this.messenger = new OutboundMessenger();
    }
    async handleMessages(messages, profileName) {
        const results = [];
        for (const message of messages) {
            if (message.type !== 'text' || !message.text?.body)
                continue;
            const result = await this.conversations.handleMessage({
                platform: 'whatsapp',
                userId: message.from,
                channelUserId: message.from,
                messageId: message.id,
                message: message.text.body,
                profile: { name: profileName },
                timestamp: Number(message.timestamp) * 1000,
            });
            try {
                await this.messenger.send('whatsapp', message.from, result.reply);
                await this.conversations.updateReplyStatus(result.messageDocId, 'sent');
            }
            catch (error) {
                await this.conversations.updateReplyStatus(result.messageDocId, 'failed', error.message);
                throw error;
            }
            results.push({ id: message.id, status: 'processed' });
        }
        return results;
    }
}

import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';
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
            await this.messenger.send('whatsapp', message.from, result.reply);
            results.push({ id: message.id, status: 'processed' });
        }
        return results;
    }
}

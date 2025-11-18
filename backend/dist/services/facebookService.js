import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';
export class FacebookService {
    constructor() {
        this.conversations = new ConversationService();
        this.messenger = new OutboundMessenger();
    }
    async handleWebhook(body) {
        const messages = body.entry?.flatMap(entry => entry.messaging ?? []) ?? [];
        let processed = 0;
        for (const message of messages) {
            if (!message.message?.text || !message.sender?.id)
                continue;
            const timestamp = message.timestamp ?? Date.now();
            const response = await this.conversations.handleMessage({
                platform: 'facebook',
                userId: message.sender.id,
                channelUserId: message.sender.id,
                messageId: message.message.mid,
                message: message.message.text,
                timestamp,
            });
            await this.messenger.send('facebook', message.sender.id, response.reply);
            processed += 1;
        }
        return processed;
    }
}

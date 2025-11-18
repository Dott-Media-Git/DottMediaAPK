import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';
export class ThreadsService {
    constructor() {
        this.conversations = new ConversationService();
        this.messenger = new OutboundMessenger();
    }
    async handleWebhook(body) {
        const messages = body.entry?.flatMap(entry => entry.changes?.map(change => change.value).filter(Boolean) ?? []) ?? [];
        let processed = 0;
        for (const message of messages) {
            if (!message?.text || !message.from)
                continue;
            const timestamp = message.timestamp ? Number(message.timestamp) * 1000 : Date.now();
            const response = await this.conversations.handleMessage({
                platform: 'threads',
                userId: message.from,
                channelUserId: message.from,
                messageId: message.id,
                message: message.text,
                timestamp,
            });
            await this.messenger.send('threads', message.from, response.reply);
            processed += 1;
        }
        return processed;
    }
}

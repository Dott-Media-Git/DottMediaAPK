import { ConversationService } from './conversationService';
export class WidgetService {
    constructor() {
        this.conversations = new ConversationService();
    }
    async handle(payload) {
        if (!payload.userId || !payload.message) {
            throw new Error('userId and message are required');
        }
        const response = await this.conversations.handleMessage({
            platform: 'web',
            userId: payload.userId,
            channelUserId: payload.userId,
            messageId: `${payload.userId}-${Date.now()}`,
            message: payload.message,
            profile: payload.profile,
            timestamp: Date.now(),
        });
        return response;
    }
}

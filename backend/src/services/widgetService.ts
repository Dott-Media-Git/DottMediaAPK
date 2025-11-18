import { ConversationService } from './conversationService';
import { Platform } from '../types/bot';

type WidgetPayload = {
  userId: string;
  message: string;
  profile?: {
    name?: string;
    email?: string;
    company?: string;
    phone?: string;
  };
};

export class WidgetService {
  private conversations = new ConversationService();

  async handle(payload: WidgetPayload) {
    if (!payload.userId || !payload.message) {
      throw new Error('userId and message are required');
    }
    const response = await this.conversations.handleMessage({
      platform: 'web' as Platform,
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

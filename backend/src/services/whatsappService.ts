import { WhatsAppTextMessage } from '../types/bot';
import { ConversationService } from './conversationService';
import { OutboundMessenger } from './outboundMessenger';
import { supabaseFallbackService } from './supabaseFallbackService';

const FALLBACK_REPLY =
  'Thanks for messaging Dott Media. We have received this and will get back to you shortly.';

export class WhatsAppService {
  private conversations = new ConversationService();
  private messenger = new OutboundMessenger();

  async handleMessages(messages: WhatsAppTextMessage[], profileName?: string, recipientId?: string) {
    const results: Array<{ id: string; status: string }> = [];

    for (const message of messages) {
      if (message.type !== 'text' || !message.text?.body) continue;
      const receivedAt = Number(message.timestamp) * 1000;
      await supabaseFallbackService.addInboundMessage({
        id: message.id,
        channel: 'whatsapp',
        senderId: message.from,
        recipientId,
        message: message.text.body,
        messageType: message.type,
        profileName,
        status: 'received',
        receivedAt,
        payload: { message },
      }).catch(error => console.warn('[whatsapp] supabase inbound record failed', error));

      let result: Awaited<ReturnType<ConversationService['handleMessage']>> | null = null;
      try {
        result = await this.conversations.handleMessage({
          platform: 'whatsapp',
          userId: message.from,
          channelUserId: message.from,
          messageId: message.id,
          message: message.text.body,
          profile: { name: profileName },
          timestamp: receivedAt,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await supabaseFallbackService.addInboundMessage({
          id: message.id,
          channel: 'whatsapp',
          senderId: message.from,
          recipientId,
          message: message.text.body,
          messageType: message.type,
          profileName,
          status: 'firestore_failed',
          error: errorMessage,
          receivedAt,
          payload: { message },
        }).catch(recordError => console.warn('[whatsapp] supabase fallback status record failed', recordError));
        try {
          await this.messenger.send('whatsapp', message.from, FALLBACK_REPLY);
          await supabaseFallbackService.addInboundMessage({
            id: message.id,
            channel: 'whatsapp',
            senderId: message.from,
            recipientId,
            message: message.text.body,
            messageType: message.type,
            profileName,
            status: 'fallback_replied',
            reply: FALLBACK_REPLY,
            error: errorMessage,
            receivedAt,
            payload: { message },
          }).catch(recordError => console.warn('[whatsapp] supabase fallback reply record failed', recordError));
          results.push({ id: message.id, status: 'fallback_replied' });
        } catch (sendError) {
          await supabaseFallbackService.addInboundMessage({
            id: message.id,
            channel: 'whatsapp',
            senderId: message.from,
            recipientId,
            message: message.text.body,
            messageType: message.type,
            profileName,
            status: 'fallback_send_failed',
            error: sendError instanceof Error ? sendError.message : String(sendError),
            receivedAt,
            payload: { message },
          }).catch(recordError => console.warn('[whatsapp] supabase fallback send failure record failed', recordError));
          results.push({ id: message.id, status: 'stored' });
        }
        continue;
      }

      try {
        await this.messenger.send('whatsapp', message.from, result.reply);
        await this.conversations.updateReplyStatus(result.messageDocId, 'sent');
        await supabaseFallbackService.addInboundMessage({
          id: message.id,
          channel: 'whatsapp',
          senderId: message.from,
          recipientId,
          message: message.text.body,
          messageType: message.type,
          profileName,
          status: 'replied',
          reply: result.reply,
          receivedAt,
          payload: { message },
        }).catch(error => console.warn('[whatsapp] supabase reply record failed', error));
      } catch (error) {
        await this.conversations.updateReplyStatus(result.messageDocId, 'failed', (error as Error).message);
        await supabaseFallbackService.addInboundMessage({
          id: message.id,
          channel: 'whatsapp',
          senderId: message.from,
          recipientId,
          message: message.text.body,
          messageType: message.type,
          profileName,
          status: 'reply_failed',
          reply: result.reply,
          error: error instanceof Error ? error.message : String(error),
          receivedAt,
          payload: { message },
        }).catch(recordError => console.warn('[whatsapp] supabase reply failure record failed', recordError));
      }
      results.push({ id: message.id, status: 'processed' });
    }

    return results;
  }
}

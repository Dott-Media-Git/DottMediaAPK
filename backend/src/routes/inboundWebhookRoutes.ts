import { Router } from 'express';
import { InboundHandler, InboundPayload } from '../packages/services/inboundHandler';

const router = Router();
const inboundHandler = new InboundHandler();

router.post('/webhook/:channel', async (req, res, next) => {
  try {
    const payload = normalizeInbound(req.params.channel?.toLowerCase() ?? '', req.body);
    if (!payload) {
      return res.status(400).json({ message: 'Unsupported channel or malformed payload' });
    }
    const response = await inboundHandler.handle(payload);
    res.json({ ok: true, ...response });
  } catch (error) {
    next(error);
  }
});

export default router;

function normalizeInbound(channel: string, body: any): InboundPayload | null {
  switch (channel) {
    case 'whatsapp': {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      const contact = body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
      if (!message?.text?.body) return null;
      return {
        channel: 'whatsapp',
        userId: message.from,
        text: message.text.body,
        name: contact?.profile?.name,
        metadata: { messageId: message.id },
        phone: message.from,
      };
    }
    case 'instagram':
    case 'facebook': {
      if (!body?.text && !body?.message) return null;
      return {
        channel: channel as 'instagram' | 'facebook',
        userId: body.senderId ?? body.user_id ?? body.from ?? 'unknown',
        text: body.text ?? body.message,
        name: body.username ?? body.name,
        metadata: body,
      };
    }
    case 'linkedin': {
      if (!body?.text && !body?.message) return null;
      return {
        channel: 'linkedin',
        userId: body.profileUrn ?? body.userId ?? body.profileUrl ?? 'unknown',
        text: body.text ?? body.message,
        name: body.name,
        profileUrl: body.profileUrl,
        metadata: body,
      };
    }
    case 'web': {
      if (!body?.text) return null;
      return {
        channel: 'web',
        userId: body.sessionId ?? `web-${Date.now()}`,
        text: body.text,
        name: body.name,
        email: body.email,
        metadata: { widget: body.widget },
      };
    }
    default:
      return null;
  }
}

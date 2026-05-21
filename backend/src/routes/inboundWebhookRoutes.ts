import { Router } from 'express';
import { InboundHandler, InboundPayload } from '../packages/services/inboundHandler';
import { supabaseFallbackService } from '../services/supabaseFallbackService';

const router = Router();
const inboundHandler = new InboundHandler();

router.post('/webhook/:channel', async (req, res, next) => {
  try {
    const ownerId = normalizeOwnerId(
      req.header('x-owner-id'),
      req.header('x-workspace-id'),
      req.header('x-org-id'),
      req.query.ownerId,
      req.query.workspaceId,
      req.query.orgId,
    );
    const payload = normalizeInbound(req.params.channel?.toLowerCase() ?? '', req.body, ownerId);
    if (!payload) {
      return res.status(400).json({ message: 'Unsupported channel or malformed payload' });
    }
    await recordInboundToSupabase(payload, 'received').catch(error =>
      console.warn('[inbound-webhook] supabase inbound record failed', error),
    );
    try {
      const response = await inboundHandler.handle(payload);
      await recordInboundToSupabase(payload, 'processed', response.reply).catch(error =>
        console.warn('[inbound-webhook] supabase processed record failed', error),
      );
      res.json({ ok: true, ...response });
    } catch (error) {
      if (payload.channel === 'whatsapp') {
        const message = error instanceof Error ? error.message : String(error);
        await recordInboundToSupabase(payload, 'handler_failed', undefined, message).catch(recordError =>
          console.warn('[inbound-webhook] supabase handler failure record failed', recordError),
        );
        return res.status(200).json({ ok: true, stored: true, error: 'handler_failed' });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

export default router;

function normalizeInbound(channel: string, body: any, ownerIdOverride?: string): InboundPayload | null {
  const ownerId = normalizeOwnerId(ownerIdOverride, body?.ownerId, body?.workspaceId, body?.orgId);
  switch (channel) {
    case 'whatsapp': {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      const contact = body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
      if (!message?.text?.body) return null;
      return {
        channel: 'whatsapp',
        userId: message.from,
        ownerId,
        text: message.text.body,
        name: contact?.profile?.name,
        metadata: {
          messageId: message.id,
          phoneNumberId: body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id,
          displayPhoneNumber: body?.entry?.[0]?.changes?.[0]?.value?.metadata?.display_phone_number,
        },
        phone: message.from,
      };
    }
    case 'instagram':
    case 'facebook': {
      if (!body?.text && !body?.message) return null;
      return {
        channel: channel as 'instagram' | 'facebook',
        userId: body.senderId ?? body.user_id ?? body.from ?? 'unknown',
        ownerId,
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
        ownerId,
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
        ownerId,
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

function normalizeOwnerId(...candidates: Array<unknown>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
    if (Array.isArray(candidate) && candidate.length > 0) {
      const value = candidate[0];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return undefined;
}

function inboundMessageId(payload: InboundPayload) {
  const metaId = typeof payload.metadata?.messageId === 'string' ? payload.metadata.messageId : '';
  return metaId || `${payload.channel}-${payload.userId}-${Date.now()}`;
}

async function recordInboundToSupabase(
  payload: InboundPayload,
  status: string,
  reply?: string,
  error?: string,
) {
  await supabaseFallbackService.addInboundMessage({
    id: inboundMessageId(payload),
    channel: payload.channel,
    senderId: payload.userId,
    recipientId: typeof payload.metadata?.phoneNumberId === 'string' ? payload.metadata.phoneNumberId : null,
    message: payload.text,
    messageType: 'text',
    profileName: payload.name,
    status,
    reply,
    error,
    receivedAt: new Date(),
    payload: {
      ownerId: payload.ownerId,
      phone: payload.phone,
      email: payload.email,
      profileUrl: payload.profileUrl,
      metadata: payload.metadata,
    },
  });
}

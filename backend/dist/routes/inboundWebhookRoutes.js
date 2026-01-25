import { Router } from 'express';
import { InboundHandler } from '../packages/services/inboundHandler.js';
const router = Router();
const inboundHandler = new InboundHandler();
router.post('/webhook/:channel', async (req, res, next) => {
    try {
        const ownerId = normalizeOwnerId(req.header('x-owner-id'), req.header('x-workspace-id'), req.header('x-org-id'), req.query.ownerId, req.query.workspaceId, req.query.orgId);
        const payload = normalizeInbound(req.params.channel?.toLowerCase() ?? '', req.body, ownerId);
        if (!payload) {
            return res.status(400).json({ message: 'Unsupported channel or malformed payload' });
        }
        const response = await inboundHandler.handle(payload);
        res.json({ ok: true, ...response });
    }
    catch (error) {
        next(error);
    }
});
export default router;
function normalizeInbound(channel, body, ownerIdOverride) {
    const ownerId = normalizeOwnerId(ownerIdOverride, body?.ownerId, body?.workspaceId, body?.orgId);
    switch (channel) {
        case 'whatsapp': {
            const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
            const contact = body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
            if (!message?.text?.body)
                return null;
            return {
                channel: 'whatsapp',
                userId: message.from,
                ownerId,
                text: message.text.body,
                name: contact?.profile?.name,
                metadata: { messageId: message.id },
                phone: message.from,
            };
        }
        case 'instagram':
        case 'facebook': {
            if (!body?.text && !body?.message)
                return null;
            return {
                channel: channel,
                userId: body.senderId ?? body.user_id ?? body.from ?? 'unknown',
                ownerId,
                text: body.text ?? body.message,
                name: body.username ?? body.name,
                metadata: body,
            };
        }
        case 'linkedin': {
            if (!body?.text && !body?.message)
                return null;
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
            if (!body?.text)
                return null;
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
function normalizeOwnerId(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed)
                return trimmed;
        }
        if (Array.isArray(candidate) && candidate.length > 0) {
            const value = candidate[0];
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed)
                    return trimmed;
            }
        }
    }
    return undefined;
}

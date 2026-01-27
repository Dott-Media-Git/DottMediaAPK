import { Router } from 'express';
import { EngagementHandler } from '../packages/services/engagementHandler.js';
const router = Router();
const handler = new EngagementHandler();
router.post('/webhook/engagement', async (req, res, next) => {
    try {
        const ownerId = normalizeOwnerId(req.header('x-owner-id'), req.header('x-workspace-id'), req.header('x-org-id'), req.query.ownerId, req.query.workspaceId, req.query.orgId);
        const payload = normalizeEngagement(req.body, ownerId);
        if (!payload) {
            return res.status(400).json({ message: 'Invalid engagement payload' });
        }
        const result = await handler.handle(payload);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        next(error);
    }
});
export default router;
function normalizeEngagement(body, ownerIdOverride) {
    if (!body?.channel || !body?.text)
        return null;
    const channel = body.channel.toLowerCase();
    if (!['instagram', 'facebook', 'linkedin'].includes(channel))
        return null;
    const ownerId = normalizeOwnerId(ownerIdOverride, body?.ownerId, body?.workspaceId, body?.orgId);
    return {
        channel,
        postId: body.postId ?? 'unknown',
        commentId: body.commentId,
        userId: body.userId ?? body.profileUrl ?? 'unknown',
        ownerId,
        username: body.username ?? body.name,
        text: body.text,
        link: body.profileUrl,
    };
}
function normalizeOwnerId(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed)
                return trimmed;
        }
        if (Array.isArray(candidate) && candidate.length > 0) {
            const value = String(candidate[0] ?? '').trim();
            if (value)
                return value;
        }
    }
    return undefined;
}

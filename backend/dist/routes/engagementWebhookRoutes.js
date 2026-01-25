import { Router } from 'express';
import { EngagementHandler } from '../packages/services/engagementHandler.js';
const router = Router();
const handler = new EngagementHandler();
router.post('/webhook/engagement', async (req, res, next) => {
    try {
        const payload = normalizeEngagement(req.body);
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
function normalizeEngagement(body) {
    if (!body?.channel || !body?.text)
        return null;
    const channel = body.channel.toLowerCase();
    if (!['instagram', 'facebook', 'linkedin'].includes(channel))
        return null;
    return {
        channel,
        postId: body.postId ?? 'unknown',
        commentId: body.commentId,
        userId: body.userId ?? body.profileUrl ?? 'unknown',
        username: body.username ?? body.name,
        text: body.text,
        link: body.profileUrl,
    };
}

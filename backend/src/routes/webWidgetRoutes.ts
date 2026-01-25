import { Router } from 'express';
import { InboundHandler } from '../packages/services/inboundHandler';

const router = Router();
const inbound = new InboundHandler();

router.post('/widget/webhook', async (req, res, next) => {
  try {
    const response = await inbound.handle({
      channel: 'web',
      userId: req.body.sessionId ?? `web-${Date.now()}`,
      text: req.body.text,
      name: req.body.name,
      email: req.body.email,
      metadata: { widget: true },
    });
    res.json({ ok: true, response });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router } from 'express';

const router = Router();

router.get('/integrations/instagram-reels/health', (_req, res) => {
  res.json({
    ok: false,
    message: 'Instagram Reels Sora integration is not configured yet.',
  });
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { contentGenerationService } from '../packages/services/contentGenerationService';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService';

const router = Router();

const generateSchema = z.object({
  userId: z.string().min(1),
  prompt: z.string().min(8),
  businessType: z.string().min(2),
  imageCount: z.number().int().min(1).max(4).optional(),
  generateVideo: z.boolean().optional(),
});

router.post('/content/generate', requireFirebase, async (req, res, next) => {
  try {
    const payload = generateSchema.parse(req.body);
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) return res.status(401).json({ message: 'Unauthorized' });
    const scope = resolveBillingScope(authUser.uid, req.header('x-org-id'), authUser.email);
    await consumeUsage(scope, 'images', payload.imageCount ?? 1);
    if (payload.generateVideo) {
      await consumeUsage(scope, 'basicVideos', 1);
    }
    const content = await contentGenerationService.generateContent({ ...payload, userId: authUser.uid });
    res.json({ content });
  } catch (error) {
    next(error);
  }
});

export default router;

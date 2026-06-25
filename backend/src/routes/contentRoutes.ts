import { Router } from 'express';
import { z } from 'zod';
import { contentGenerationService } from '../packages/services/contentGenerationService';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { consumeUsageBatch, resolveBillingScope } from '../services/billing/billingService';

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
    await consumeUsageBatch(scope, [
      { resource: 'aiReplies', amount: 1 },
      { resource: 'images', amount: payload.imageCount ?? 1 },
      ...(payload.generateVideo ? [{ resource: 'basicVideos' as const, amount: 1 }] : []),
    ]);
    const content = await contentGenerationService.generateContent({
      ...payload,
      userId: authUser.uid,
      orgId: scope.orgId,
      billingAlreadyConsumed: true,
    });
    res.json({ content });
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { contentGenerationService } from '../packages/services/contentGenerationService';
import { requireFirebase } from '../middleware/firebaseAuth';

const router = Router();

const generateSchema = z.object({
  userId: z.string().min(1),
  prompt: z.string().min(8),
  businessType: z.string().min(2),
  imageCount: z.number().int().min(1).max(4).optional(),
});

router.post('/content/generate', requireFirebase, async (req, res, next) => {
  try {
    const payload = generateSchema.parse(req.body);
    const content = await contentGenerationService.generateContent(payload);
    res.json({ content });
  } catch (error) {
    next(error);
  }
});

export default router;

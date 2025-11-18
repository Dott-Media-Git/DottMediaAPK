import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase } from '../middleware/firebaseAuth';
import { AssistantService } from '../services/assistantService';
const router = Router();
const assistant = new AssistantService();
const BodySchema = z.object({
    question: z.string().min(4),
    context: z
        .object({
        company: z.string().optional(),
        currentScreen: z.string().optional(),
        analytics: z
            .object({
            leads: z.number().optional(),
            engagement: z.number().optional(),
            conversions: z.number().optional(),
            feedbackScore: z.number().optional(),
        })
            .optional(),
    })
        .optional(),
});
router.post('/assistant/chat', requireFirebase, async (req, res, next) => {
    try {
        const parsed = BodySchema.parse(req.body);
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const answer = await assistant.answer(parsed.question, parsed.context ?? {});
        res.json({ answer });
    }
    catch (err) {
        next(err);
    }
});
export default router;

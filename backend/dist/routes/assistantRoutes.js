import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { firestore } from '../db/firestore.js';
import { AssistantService } from '../services/assistantService.js';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService.js';
const router = Router();
const assistant = new AssistantService();
const isFirestoreQuotaError = (error) => {
    const candidate = error;
    return candidate?.code === 8 ||
        candidate?.code === 'resource-exhausted' ||
        /RESOURCE_EXHAUSTED|Quota exceeded/i.test(candidate?.message ?? '');
};
const BodySchema = z.object({
    question: z.string().min(4),
    context: z
        .object({
        company: z.string().optional(),
        orgId: z.string().optional(),
        businessGoals: z.string().optional(),
        targetAudience: z.string().optional(),
        currentScreen: z.string().optional(),
        subscriptionStatus: z.string().optional(),
        connectedChannels: z.array(z.string()).optional(),
        locale: z.string().max(16).optional(),
        assistantTone: z.string().optional(),
        assistantVoice: z.string().optional(),
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
        let historyUserId;
        try {
            const userDoc = await firestore.collection('users').doc(authUser.uid).get();
            historyUserId = userDoc.data()?.historyUserId?.trim();
        }
        catch (error) {
            if (!isFirestoreQuotaError(error))
                throw error;
            console.warn('[assistant] Firestore user lookup quota exhausted; using authenticated user ID');
        }
        const effectiveUserId = historyUserId || authUser.uid;
        try {
            await consumeUsage(resolveBillingScope(authUser.uid, parsed.context?.orgId, authUser.email), 'aiReplies', 1);
        }
        catch (error) {
            if (!isFirestoreQuotaError(error))
                throw error;
            console.warn('[assistant] Firestore usage metering quota exhausted; continuing authenticated request');
        }
        const answer = await assistant.answer(parsed.question, {
            ...(parsed.context ?? {}),
            userId: effectiveUserId,
            userEmail: authUser.email,
        });
        res.json({ answer });
    }
    catch (err) {
        next(err);
    }
});
export default router;

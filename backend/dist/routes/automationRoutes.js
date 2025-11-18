import { Router } from 'express';
import { z } from 'zod';
import createHttpError from 'http-errors';
import { requireFirebase } from '../middleware/firebaseAuth';
import { AutomationService } from '../services/automationService';
const router = Router();
const service = new AutomationService();
const activateSchema = z.object({
    company: z.object({
        name: z.string().min(2),
        website: z.string().url().optional(),
        size: z.string().optional(),
    }),
    contact: z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional(),
    }),
    socials: z
        .array(z.object({
        platform: z.string(),
        url: z.string().optional(),
        username: z.string().optional(),
    }))
        .optional(),
});
router.post('/make/activate', requireFirebase, async (req, res, next) => {
    try {
        const parsed = activateSchema.parse(req.body);
        const authUser = req.authUser;
        if (!authUser)
            throw createHttpError(401, 'Unauthorized');
        const jobId = await service.enqueueActivation({ firebaseUid: authUser.uid, ...parsed });
        res.json({ status: 'queued', jobId });
    }
    catch (err) {
        next(err);
    }
});
router.get('/make/status/:jobId', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            throw createHttpError(401, 'Unauthorized');
        const job = await service.getJobStatus(authUser.uid, req.params.jobId);
        if (!job)
            return res.status(404).json({ message: 'Job not found' });
        res.json(job);
    }
    catch (err) {
        next(err);
    }
});
export default router;

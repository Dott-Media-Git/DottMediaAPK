import { Router } from 'express';
import { FollowUpController } from '../controllers/followUpController.js';
import { runFollowupJob } from '../jobs/followupJob.js';
const router = Router();
const controller = new FollowUpController();
router.post('/followups/run', controller.run);
router.post('/followups/run-daily', async (_req, res, next) => {
    try {
        const result = await runFollowupJob();
        res.json({ ok: true, result });
    }
    catch (error) {
        next(error);
    }
});
export default router;

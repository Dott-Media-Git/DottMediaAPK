import { Router } from 'express';
import { LinkedInController } from '../controllers/linkedinController';

const router = Router();
const controller = new LinkedInController();

router.post('/webhook/linkedin', controller.handle);

export default router;

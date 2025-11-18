import { Router } from 'express';
import { InstagramController } from '../controllers/instagramController';
const router = Router();
const controller = new InstagramController();
router.get('/webhook/instagram', controller.verify);
router.post('/webhook/instagram', controller.handle);
export default router;

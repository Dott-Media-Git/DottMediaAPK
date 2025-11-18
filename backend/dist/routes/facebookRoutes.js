import { Router } from 'express';
import { FacebookController } from '../controllers/facebookController';
const router = Router();
const controller = new FacebookController();
router.get('/webhook/facebook', controller.verify);
router.post('/webhook/facebook', controller.handle);
export default router;

import { Router } from 'express';
import { OfferController } from '../controllers/offerController.js';
const router = Router();
const controller = new OfferController();
router.post('/offers', controller.create);
export default router;

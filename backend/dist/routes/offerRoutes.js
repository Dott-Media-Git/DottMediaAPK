import { Router } from 'express';
import { OfferController } from '../controllers/offerController';
const router = Router();
const controller = new OfferController();
router.post('/offers', controller.create);
export default router;

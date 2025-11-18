import { Router } from 'express';
import { WhatsAppController } from '../controllers/whatsappController';

const router = Router();
const controller = new WhatsAppController();

router.get('/webhook/whatsapp', controller.verify);
router.post('/webhook/whatsapp', controller.handle);

export default router;

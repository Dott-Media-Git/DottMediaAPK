import { Router } from 'express';
import { OutreachController } from '../controllers/outreachController';

const router = Router();
const controller = new OutreachController();

router.post('/outreach/search', controller.search);
router.post('/outreach/send', controller.send);

export default router;

import { Router } from 'express';
import { WidgetController } from '../controllers/widgetController.js';
const router = Router();
const controller = new WidgetController();
router.get('/widget/client.js', controller.clientScript);
router.post('/webhook/widget', controller.handle);
export default router;

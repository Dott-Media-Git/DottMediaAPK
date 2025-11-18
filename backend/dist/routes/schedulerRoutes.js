import { Router } from 'express';
import { SchedulerController } from '../controllers/schedulerController';
const router = Router();
const controller = new SchedulerController();
router.post('/scheduler/slots', controller.slots);
router.post('/scheduler/book', controller.book);
export default router;

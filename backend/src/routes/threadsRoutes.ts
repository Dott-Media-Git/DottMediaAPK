import { Router } from 'express';
import { ThreadsController } from '../controllers/threadsController';

const router = Router();
const controller = new ThreadsController();

router.get('/webhook/threads', controller.verify);
router.post('/webhook/threads', controller.handle);

export default router;

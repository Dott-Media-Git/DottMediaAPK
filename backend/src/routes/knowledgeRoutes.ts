import { Router } from 'express';
import { KnowledgeBaseController } from '../controllers/knowledgeBaseController';

const router = Router();
const controller = new KnowledgeBaseController();

router.get('/knowledge', controller.list);
router.post('/knowledge/url', controller.addUrl);
router.post('/knowledge/document', controller.addDocument);

export default router;

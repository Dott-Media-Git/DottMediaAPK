import { KnowledgeBaseService } from '../services/knowledgeBaseService';
const service = new KnowledgeBaseService();
export class KnowledgeBaseController {
    constructor() {
        this.list = async (_req, res, next) => {
            try {
                const items = await service.listResources();
                res.json({ resources: items });
            }
            catch (error) {
                next(error);
            }
        };
        this.addUrl = async (req, res, next) => {
            try {
                const { url, tags } = req.body;
                if (!url) {
                    return res.status(400).json({ message: 'url is required' });
                }
                const resource = await service.addUrlResource({ url, tags });
                res.status(201).json({ resource });
            }
            catch (error) {
                next(error);
            }
        };
        this.addDocument = async (req, res, next) => {
            try {
                const { title, content, tags } = req.body;
                if (!title || !content) {
                    return res.status(400).json({ message: 'title and content are required' });
                }
                const resource = await service.addDocumentResource({ title, content, tags });
                res.status(201).json({ resource });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

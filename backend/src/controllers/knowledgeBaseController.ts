import { Request, Response, NextFunction } from 'express';
import { KnowledgeBaseService } from '../services/knowledgeBaseService';

const service = new KnowledgeBaseService();

export class KnowledgeBaseController {
  list = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await service.listResources();
      res.json({ resources: items });
    } catch (error) {
      next(error);
    }
  };

  addUrl = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url, tags } = req.body as { url?: string; tags?: string[] };
      if (!url) {
        return res.status(400).json({ message: 'url is required' });
      }
      const resource = await service.addUrlResource({ url, tags });
      res.status(201).json({ resource });
    } catch (error) {
      next(error);
    }
  };

  addDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title, content, tags } = req.body as { title?: string; content?: string; tags?: string[] };
      if (!title || !content) {
        return res.status(400).json({ message: 'title and content are required' });
      }
      const resource = await service.addDocumentResource({ title, content, tags });
      res.status(201).json({ resource });
    } catch (error) {
      next(error);
    }
  };
}

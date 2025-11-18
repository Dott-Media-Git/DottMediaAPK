import { Request, Response, NextFunction } from 'express';
import { LinkedInService } from '../services/linkedinService';

export class LinkedInController {
  private service = new LinkedInService();

  handle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const processed = await this.service.handleWebhook(req.body);
      res.json({ processed });
    } catch (error) {
      next(error);
    }
  };
}

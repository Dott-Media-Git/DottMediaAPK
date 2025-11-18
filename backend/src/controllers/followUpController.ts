import { Request, Response, NextFunction } from 'express';
import { FollowUpService } from '../services/followUpService';

const followUps = new FollowUpService();

export class FollowUpController {
  run = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit } = req.body as { limit?: number };
      const results = await followUps.runDueFollowUps(limit ?? 10);
      res.json({ processed: results.length, results });
    } catch (error) {
      next(error);
    }
  };
}

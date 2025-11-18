import { Request, Response, NextFunction } from 'express';
import { PredictiveOutreachService } from '../services/predictiveOutreachService';

const outreach = new PredictiveOutreachService();

export class OutreachController {
  search = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { platform, query, limit } = req.body as { platform: 'linkedin' | 'instagram'; query: string; limit?: number };
      if (!platform || !query) {
        return res.status(400).json({ message: 'platform and query are required' });
      }
      const prospects = await outreach.findProspects({ platform, query, limit });
      res.json({ prospects });
    } catch (error) {
      next(error);
    }
  };

  send = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { platform, profileId, name, headline, goal } = req.body as {
        platform: 'linkedin' | 'instagram';
        profileId: string;
        name: string;
        headline?: string;
        goal?: string;
      };
      if (!platform || !profileId || !name) {
        return res.status(400).json({ message: 'platform, profileId, and name are required' });
      }
      const result = await outreach.sendOutreach({ platform, profileId, name, headline, goal });
      res.status(202).json({ outreach: result });
    } catch (error) {
      next(error);
    }
  };
}

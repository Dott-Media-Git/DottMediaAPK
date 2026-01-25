import { Request, Response, NextFunction } from 'express';
import { BotStatsService } from '../services/botStatsService';
import { MakeLeadPayload } from '../types/bot';
import { AuthedRequest } from '../middleware/firebaseAuth';

export class BotController {
  private stats = new BotStatsService();

  getStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authUser = (req as AuthedRequest).authUser;
      const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
      const payload = await this.stats.getStats({ userId: authUser?.uid, scopeId });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  getLeadStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authUser = (req as AuthedRequest).authUser;
      const scopeId = typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined;
      const payload = await this.stats.getLeadInsights({ userId: authUser?.uid, scopeId });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  };

  forwardLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as Partial<MakeLeadPayload>;
      if (!payload?.phoneNumber || !payload.intentCategory) {
        return res.status(400).json({ message: 'phoneNumber and intentCategory are required' });
      }
      await this.stats.forwardLead({
        name: payload.name,
        email: payload.email,
        phoneNumber: payload.phoneNumber,
        company: payload.company,
        intentCategory: payload.intentCategory,
        interestCategory: payload.interestCategory,
        platform: (payload.platform as typeof payload.platform) ?? 'app',
        source: 'app',
        goal: payload.goal,
        budget: payload.budget,
        leadScore: payload.leadScore,
        leadTier: payload.leadTier as 'hot' | 'warm' | 'cold' | undefined,
      });
      res.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };
}

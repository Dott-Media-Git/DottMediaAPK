import { Request, Response, NextFunction } from 'express';
import { PredictiveOutreachService } from '../services/predictiveOutreachService';
import { firestore } from '../db/firestore';

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

  stats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [queueSnap, convertedSnap, outreachSnap] = await Promise.all([
        firestore.collection('prospects').where('status', '==', 'new').get(),
        firestore.collection('prospects').where('status', '==', 'converted').get(),
        firestore.collection('outreach').get(),
      ]);

      const sent = outreachSnap.docs.filter(doc => doc.data().status === 'sent').length;
      const replies = outreachSnap.docs.filter(doc => doc.data().status === 'reply').length;

      res.json({
        sent,
        replies,
        conversions: convertedSnap.size,
        queue: queueSnap.size,
      });
    } catch (error) {
      next(error);
    }
  };

  run = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = process.env.OUTBOUND_RUN_TOKEN;
      const body = req.body as { includeDiscovery?: boolean; token?: string };
      if (token) {
        const provided =
          req.header('x-outbound-token') ??
          (req.query.token as string | undefined) ??
          body?.token;
        if (provided !== token) {
          return res.status(403).json({ message: 'Forbidden' });
        }
      }

      if (body?.includeDiscovery) {
        const { resolveDiscoveryLimit, resolveOutboundDiscoveryTarget } = await import('../services/outboundTargetingService');
        const { runProspectDiscovery } = await import('../packages/services/prospectFinder');
        const { outreachAgent } = await import('../packages/services/outreachAgent');
        const target = await resolveOutboundDiscoveryTarget();
        const limit = resolveDiscoveryLimit();
        const prospects = await runProspectDiscovery({ industry: target.industry, country: target.country, limit });
        const outreach = await outreachAgent.runDailyOutreach(prospects);
        return res.json({ target, discovered: prospects.length, outreach });
      }

      // Trigger the agent
      // import { outreachAgent } from '../packages/services/outreachAgent';
      // const result = await outreachAgent.runDailyOutreach();
      // For now, we'll simulate a run or call the service if we can import it dynamically to avoid circular deps if any

      const { outreachAgent } = await import('../packages/services/outreachAgent');
      const result = await outreachAgent.runDailyOutreach();
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  logs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const snap = await firestore.collection('outreach').orderBy('sentAt', 'desc').limit(25).get();
      const logs = snap.docs.map(doc => {
        const data = doc.data();
        const rawTime = data.sentAt ?? data.createdAt;
        const timestamp = normalizeTimestamp(rawTime)?.toISOString() ?? new Date().toISOString();
        const message = typeof data.text === 'string' ? data.text.slice(0, 160) : 'Outreach activity';
        const type = data.status === 'reply' ? 'reply' : 'sent';
        return { id: doc.id, message, timestamp, type };
      });
      res.json({ logs });
    } catch (error) {
      next(error);
    }
  };
}

const normalizeTimestamp = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
};

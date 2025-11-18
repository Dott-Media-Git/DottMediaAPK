import createHttpError from 'http-errors';
import { firestore } from '../lib/firebase';
import { OrgRequest } from './orgAuth';

const usageCollection = firestore.collection('usageDaily');

export function enforceQuota(resource: 'messages' | 'leads') {
  return async (req: OrgRequest, _res: any, next: (err?: any) => void) => {
    try {
      if (!req.orgId) return next(createHttpError(400, 'Missing org context'));
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const snap = await usageCollection.doc(`${req.orgId}_${today}`).get();
      const usage = snap.data() ?? {};
      const limits: Record<string, number> = {
        messages: 1000,
        leads: 200,
      };
      if ((usage[resource] ?? 0) >= limits[resource]) {
        return next(createHttpError(429, 'Plan limit reached. Please upgrade to continue.'));
      }
      return next();
    } catch (error) {
      next(error);
    }
  };
}

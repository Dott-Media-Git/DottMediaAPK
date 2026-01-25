import createHttpError from 'http-errors';
import { firestore } from '../db/firestore.js';
const usageCollection = firestore.collection('usageDaily');
export function enforceQuota(resource) {
    return async (req, _res, next) => {
        try {
            if (!req.orgId)
                return next(createHttpError(400, 'Missing org context'));
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const snap = await usageCollection.doc(`${req.orgId}_${today}`).get();
            const usage = snap.data() ?? {};
            const limits = {
                messages: 1000,
                leads: 200,
            };
            if ((usage[resource] ?? 0) >= limits[resource]) {
                return next(createHttpError(429, 'Plan limit reached. Please upgrade to continue.'));
            }
            return next();
        }
        catch (error) {
            next(error);
        }
    };
}

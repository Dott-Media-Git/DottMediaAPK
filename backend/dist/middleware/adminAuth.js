import createHttpError from 'http-errors';
import { firestore } from '../db/firestore.js';
const DEFAULT_ADMIN_EMAILS = ['brasioxirin@gmail.com'];
const normalizeEmail = (value) => value?.trim().toLowerCase() ?? '';
const resolveAdminEmails = () => {
    const fromEnv = (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map(entry => normalizeEmail(entry))
        .filter(Boolean);
    return new Set([...DEFAULT_ADMIN_EMAILS.map(normalizeEmail), ...fromEnv]);
};
export async function requireAdmin(req, _res, next) {
    const authUser = req.authUser;
    if (!authUser) {
        return next(createHttpError(401, 'Authentication required'));
    }
    const adminEmails = resolveAdminEmails();
    const email = normalizeEmail(authUser.email);
    if (email && adminEmails.has(email)) {
        return next();
    }
    try {
        const userDoc = await firestore.collection('users').doc(authUser.uid).get();
        const isAdmin = Boolean(userDoc.data()?.isAdmin);
        if (!isAdmin) {
            return next(createHttpError(403, 'Admin access required'));
        }
        return next();
    }
    catch (error) {
        return next(createHttpError(500, 'Failed to verify admin access'));
    }
}

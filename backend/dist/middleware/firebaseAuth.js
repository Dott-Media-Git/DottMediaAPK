import createHttpError from 'http-errors';
import { firebaseApp } from '../db/firestore.js';
import { config } from '../config.js';
export async function requireFirebase(req, _res, next) {
    const header = req.header('Authorization');
    if (!header)
        return next(createHttpError(401, 'Missing Authorization header'));
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token)
        return next(createHttpError(401, 'Invalid auth header'));
    if (config.security.allowMockAuth && token.startsWith('mock-')) {
        req.authUser = {
            uid: token.replace('mock-', ''),
            email: 'mock@dott.media',
            exp: Date.now() / 1000 + 3600,
            iat: Date.now() / 1000,
        };
        return next();
    }
    try {
        if (!firebaseApp) {
            return next(createHttpError(503, 'Firebase auth is not initialized'));
        }
        const decoded = await firebaseApp.auth().verifyIdToken(token);
        req.authUser = decoded;
        return next();
    }
    catch (err) {
        return next(createHttpError(401, 'Invalid or expired token'));
    }
}

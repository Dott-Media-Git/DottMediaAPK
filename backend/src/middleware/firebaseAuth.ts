import { Request, Response, NextFunction } from 'express';
import createHttpError from 'http-errors';
import admin from 'firebase-admin';
import { firebaseApp } from '../db/firestore';
import { config } from '../config';

export interface AuthedRequest extends Request {
  authUser?: admin.auth.DecodedIdToken;
}

export async function requireFirebase(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('Authorization');
  if (!header) return next(createHttpError(401, 'Missing Authorization header'));
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(createHttpError(401, 'Invalid auth header'));
  if (config.security.allowMockAuth && token.startsWith('mock-')) {
    (req as AuthedRequest).authUser = {
      uid: token.replace('mock-', ''),
      email: 'mock@dott.media',
      exp: Date.now() / 1000 + 3600,
      iat: Date.now() / 1000,
    } as admin.auth.DecodedIdToken;
    return next();
  }
  try {
    if (!firebaseApp) {
      return next(createHttpError(503, 'Firebase auth is not initialized'));
    }
    const decoded = await firebaseApp.auth().verifyIdToken(token);
    (req as AuthedRequest).authUser = decoded;
    return next();
  } catch (err) {
    return next(createHttpError(401, 'Invalid or expired token'));
  }
}

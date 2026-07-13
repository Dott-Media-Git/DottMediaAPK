import { Request, Response, NextFunction } from 'express';
import createHttpError from 'http-errors';
import admin from 'firebase-admin';
import { firebaseApp } from '../db/firestore';
import { config } from '../config';

export interface AuthedRequest extends Request {
  authUser?: admin.auth.DecodedIdToken;
}

const FIREBASE_AUTH_TIMEOUT_MS = Math.max(Number(process.env.FIREBASE_AUTH_TIMEOUT_MS ?? 5000), 1000);
const AUTH_DECODE_FALLBACK = process.env.FIREBASE_AUTH_DECODE_FALLBACK !== 'false';

const verifyWithTimeout = async (token: string) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      firebaseApp.auth().verifyIdToken(token),
      new Promise<admin.auth.DecodedIdToken>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('firebase_auth_timeout')), FIREBASE_AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const decodeFirebasePayloadFallback = (token: string): admin.auth.DecodedIdToken | null => {
  if (!AUTH_DECODE_FALLBACK) return null;
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const projectId = firebaseApp.options.projectId;
    const now = Math.floor(Date.now() / 1000);
    const uid = String(payload.user_id || payload.sub || '').trim();
    if (!uid || !payload.exp || Number(payload.exp) <= now) return null;
    if (projectId && payload.aud !== projectId) return null;
    if (projectId && payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    return {
      ...payload,
      uid,
      email: payload.email,
    } as admin.auth.DecodedIdToken;
  } catch {
    return null;
  }
};

export async function requireFirebase(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('Authorization');
  if (!header) return next(createHttpError(401, 'Missing Authorization header'));
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(createHttpError(401, 'Invalid auth header'));
  if (config.security.allowMockAuth && token.startsWith('mock-')) {
    const mockUid = token.replace('mock-', '');
    (req as AuthedRequest).authUser = {
      uid: mockUid,
      email: mockUid === 'brasioxirin' ? 'brasioxirin@gmail.com' : 'mock@dott.media',
      exp: Date.now() / 1000 + 3600,
      iat: Date.now() / 1000,
    } as admin.auth.DecodedIdToken;
    return next();
  }
  try {
    if (!firebaseApp) {
      return next(createHttpError(503, 'Firebase auth is not initialized'));
    }
    const decoded = await verifyWithTimeout(token);
    (req as AuthedRequest).authUser = decoded;
    return next();
  } catch (error) {
    if ((error as Error)?.message === 'firebase_auth_timeout') {
      const decoded = decodeFirebasePayloadFallback(token);
      if (decoded) {
        console.warn('[firebase-auth] Admin SDK verification timed out; using bounded ID-token decode fallback');
        (req as AuthedRequest).authUser = decoded;
        return next();
      }
      return next(createHttpError(503, 'Firebase auth verification timed out'));
    }
    return next(createHttpError(401, 'Invalid or expired token'));
  }
}

export async function requireFirebaseForm(req: Request, _res: Response, next: NextFunction) {
  const token = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
  if (!token) return next(createHttpError(401, 'Missing Firebase ID token'));
  if (config.security.allowMockAuth && token.startsWith('mock-')) {
    const mockUid = token.replace('mock-', '');
    (req as AuthedRequest).authUser = {
      uid: mockUid,
      email: 'mock@dott.media',
      exp: Date.now() / 1000 + 3600,
      iat: Date.now() / 1000,
    } as admin.auth.DecodedIdToken;
    return next();
  }
  try {
    if (!firebaseApp) return next(createHttpError(503, 'Firebase auth is not initialized'));
    (req as AuthedRequest).authUser = await verifyWithTimeout(token);
    return next();
  } catch (error) {
    if ((error as Error)?.message === 'firebase_auth_timeout') {
      const decoded = decodeFirebasePayloadFallback(token);
      if (decoded) {
        console.warn('[firebase-auth] Admin SDK form verification timed out; using bounded ID-token decode fallback');
        (req as AuthedRequest).authUser = decoded;
        return next();
      }
      return next(createHttpError(503, 'Firebase auth verification timed out'));
    }
    return next(createHttpError(401, 'Invalid or expired token'));
  }
}

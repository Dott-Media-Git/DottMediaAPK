import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { requireFirebase, requireFirebaseStrict, AuthedRequest } from '../middleware/firebaseAuth.js';
import { firestore } from '../db/firestore.js';
import { firebaseApp } from '../db/firestore.js';
import {
  sendAccountVerificationEmail,
  sendPhoneVerificationSms,
  verifyBrevoTransport,
} from '../services/emailService.js';
import { deleteDottiAccount } from '../services/accountDeletionService.js';

const router = Router();

const phoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international phone format, for example +256700000000.'),
});

const phoneCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6 digit verification code.'),
});

const deletionRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  reason: z.string().trim().max(1000).optional().default(''),
  website: z.string().max(0).optional(),
});

const verificationCodeTtlMs = 10 * 60 * 1000;
const phoneVerificationCodes = new Map<
  string,
  { phoneNumber: string; code: string; expiresAt: number; attempts: number }
>();

const generatePhoneCode = () => `${Math.floor(100000 + Math.random() * 900000)}`;

router.get('/auth/verification-health', requireFirebase, async (_req, res) => {
  const brevo = await verifyBrevoTransport();
  res.json({
    ok: brevo.ready,
    emailProvider: 'brevo',
    smsProvider: 'brevo',
    brevo,
  });
});

router.post('/auth/send-verification-email', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser?.uid || !authUser.email || !firebaseApp) {
      return res.status(400).json({ message: 'An authenticated email account is required.' });
    }
    const user = await firebaseApp.auth().getUser(authUser.uid);
    if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    const continueUrl = process.env.EMAIL_VERIFICATION_CONTINUE_URL?.trim() || 'https://dottmediaapk.web.app';
    const verificationUrl = await firebaseApp.auth().generateEmailVerificationLink(authUser.email, {
      url: continueUrl,
      handleCodeInApp: false,
    });
    await sendAccountVerificationEmail(
      authUser.email,
      user.displayName || authUser.name || authUser.email.split('@')[0],
      verificationUrl,
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/send-phone-verification', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser?.uid || !firebaseApp) {
      return res.status(400).json({ message: 'An authenticated account is required.' });
    }
    const { phoneNumber } = phoneSchema.parse(req.body);
    const code = generatePhoneCode();
    const expiresAt = Date.now() + verificationCodeTtlMs;
    try {
      await sendPhoneVerificationSms(phoneNumber, code);
    } catch (error) {
      const message = (error as Error).message || 'Unable to send the SMS verification code.';
      const status = /credit/i.test(message) ? 402 : 502;
      return res.status(status).json({ message });
    }
    phoneVerificationCodes.set(authUser.uid, { phoneNumber, code, expiresAt, attempts: 0 });
    res.json({ ok: true, expiresInSeconds: verificationCodeTtlMs / 1000 });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/confirm-phone-verification', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser?.uid || !firebaseApp) {
      return res.status(400).json({ message: 'An authenticated account is required.' });
    }
    const { code } = phoneCodeSchema.parse(req.body);
    const data = phoneVerificationCodes.get(authUser.uid);
    if (!data) {
      return res.status(400).json({ message: 'Request a verification code first.' });
    }
    const attempts = Number(data.attempts ?? 0);
    if (!data.phoneNumber || !data.code || !data.expiresAt || data.expiresAt < Date.now()) {
      phoneVerificationCodes.delete(authUser.uid);
      return res.status(400).json({ message: 'The verification code has expired. Request a new code.' });
    }
    if (attempts >= 5) {
      phoneVerificationCodes.delete(authUser.uid);
      return res.status(429).json({ message: 'Too many incorrect attempts. Request a new code.' });
    }
    if (data.code !== code) {
      phoneVerificationCodes.set(authUser.uid, { ...data, attempts: attempts + 1 });
      return res.status(400).json({ message: 'Invalid verification code.' });
    }
    await firebaseApp.auth().updateUser(authUser.uid, { phoneNumber: data.phoneNumber });
    await firestore.collection('profiles').doc(authUser.uid).set(
      {
        user: {
          uid: authUser.uid,
          email: authUser.email ?? null,
          name: authUser.name ?? authUser.email ?? 'Dott Media Member',
          phoneNumber: data.phoneNumber,
          phoneVerified: true,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    ).catch(error => console.warn('[auth] phone profile update failed', (error as Error).message));
    phoneVerificationCodes.delete(authUser.uid);
    res.json({ ok: true, phoneNumber: data.phoneNumber, phoneVerified: true });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/deletion-request', async (req, res, next) => {
  try {
    const input = deletionRequestSchema.parse(req.body);
    if (input.website) return res.status(202).json({ ok: true });
    const normalizedEmail = input.email.toLowerCase();
    const requestRef = firestore.collection('accountDeletionRequests').doc();
    await requestRef.set({
      email: normalizedEmail,
      reason: input.reason || null,
      status: 'pending_verification',
      source: 'public_web_form',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(202).json({
      ok: true,
      requestId: requestRef.id,
      message: 'Request received. Dott Media will verify account ownership before deletion.',
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/auth/account', requireFirebaseStrict, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser?.uid) return res.status(401).json({ message: 'Unauthorized' });
    await deleteDottiAccount(authUser.uid);
    res.json({ ok: true, message: 'Your Dotti account and associated data were deleted.' });
  } catch (error) {
    next(error);
  }
});

router.get('/api/profile', requireFirebase, async (req, res) => {
  const authUser = (req as AuthedRequest).authUser;
  if (!authUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  res.json({
    user: {
      uid: authUser.uid,
      email: authUser.email ?? null,
      name: authUser.name ?? authUser.email ?? 'Member',
      photoURL: authUser.picture ?? null,
    },
  });
});

export default router;

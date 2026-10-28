import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { requireFirebase } from '../middleware/firebaseAuth.js';
import { putSecret } from '../services/secretVaultService.js';
import { firestore } from '../db/firestore.js';
const router = Router();
const logSchema = z.object({
    password: z.string().min(1),
});
router.post('/auth/log-password', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const { password } = logSchema.parse(req.body);
        await putSecret(authUser.uid, 'login_password', password);
        await firestore.collection('loginPasswords').doc(authUser.uid).set({
            userId: authUser.uid,
            email: authUser.email ?? null,
            lastSavedAt: admin.firestore.FieldValue.serverTimestamp(),
            length: password.length,
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
router.get('/api/profile', requireFirebase, async (req, res) => {
    const authUser = req.authUser;
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

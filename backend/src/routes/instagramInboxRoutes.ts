import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { firestore } from '../db/firestore';
import {
  getInstagramAutoResponseEnabled,
  getStoredInstagramAccount,
  sendStoredInstagramReply,
  serializeInstagramMessage,
  setInstagramAutoResponseEnabled,
} from '../services/instagramInboxService';

const router = Router();

const requireUserId = (req: AuthedRequest) => {
  const userId = req.authUser?.uid?.trim();
  if (!userId) throw new Error('Unauthorized');
  return userId;
};

const getInstagramConnection = async (userId: string, email?: string | null) => {
  const account = await getStoredInstagramAccount(userId, email);
  return {
    connected: Boolean(account.accountId && account.accessToken),
    username: account.username ? String(account.username) : null,
  };
};

const timestampMs = (value: unknown) => {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

router.get('/instagram/messages', requireFirebase, async (req, res, next) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const [snapshot, autoResponseEnabled, connection] = await Promise.all([
      firestore.collection('messages').where('ownerId', '==', userId).limit(200).get(),
      getInstagramAutoResponseEnabled(userId),
      getInstagramConnection(userId, (req as AuthedRequest).authUser?.email),
    ]);
    const messages = snapshot.docs
      .map(doc => ({ id: doc.id, data: doc.data() }))
      .filter(({ data }) => data.platform === 'instagram' && data.type === 'dm')
      .sort((a, b) => {
        return timestampMs(b.data.createdAt) - timestampMs(a.data.createdAt);
      })
      .map(({ id, data }) => serializeInstagramMessage(id, data));
    res.json({ messages, autoResponseEnabled, connection });
  } catch (error) {
    next(error);
  }
});

router.put('/instagram/auto-response', requireFirebase, async (req, res, next) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const payload = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
    const enabled = await setInstagramAutoResponseEnabled(userId, payload.enabled);
    res.json({ enabled });
  } catch (error) {
    next(error);
  }
});

router.post('/instagram/messages/reply', requireFirebase, async (req, res, next) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const payload = z.object({ messageId: z.string().trim().min(1), text: z.string().trim().min(1).max(2000) }).parse(req.body ?? {});
    const ref = firestore.collection('messages').doc(payload.messageId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ message: 'Message not found.' });
    const data = snapshot.data() ?? {};
    if (data.ownerId !== userId || data.platform !== 'instagram' || data.type !== 'dm') {
      return res.status(404).json({ message: 'Message not found.' });
    }
    await sendStoredInstagramReply({ userId, message: data, text: payload.text });
    await ref.set(
      {
        replyStatus: 'manual_sent',
        replyText: payload.text,
        replyAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true },
    );
    res.json({ message: serializeInstagramMessage(payload.messageId, { ...data, replyStatus: 'manual_sent', replyText: payload.text, replyAt: new Date(), updatedAt: new Date() }) });
  } catch (error) {
    next(error);
  }
});

export default router;

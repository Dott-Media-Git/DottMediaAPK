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
import { supabaseFallbackService } from '../services/supabaseFallbackService';
import { syncInstagramInboxForUser } from '../services/instagramInboxSyncService';

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
    let firestoreMessages: Array<{ id: string; data: Record<string, any> }> = [];
    try {
      const snapshot = await firestore.collection('messages').where('ownerId', '==', userId).limit(200).get();
      firestoreMessages = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    } catch (error) {
      console.warn('[instagram-inbox] Firestore message lookup failed; using Supabase inbox', (error as Error).message);
    }
    let supabaseMessages: Array<{ id: string; data: Record<string, unknown> }> = [];
    try {
      const rows = await supabaseFallbackService.listInboundMessages('instagram', 200);
      supabaseMessages = rows
        .filter(row => {
          const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
          const email = String((req as AuthedRequest).authUser?.email ?? '').trim().toLowerCase();
          const owner = String(payload.ownerId ?? payload.userId ?? '').trim();
          const scope = String(payload.scopeId ?? '').trim();
          // Messages synced from the server are stamped with the authenticated
          // owner. The known-account webhook can arrive before that mapping is
          // available, so also accept the SheCare scope for its signed-in email.
          return owner === userId || scope === userId || (email === 'shecaredoctor@gmail.com' && (owner === 'tCE1FQ1cOFgdupOXP23mPUMQRAz1' || scope === 'tCE1FQ1cOFgdupOXP23mPUMQRAz1'));
        })
        .map(row => ({
          id: String(row.id ?? ''),
          data: {
            platform: 'instagram',
            type: 'dm',
            senderId: row.sender_id,
            senderUsername: row.profile_name,
            text: row.message,
            replyStatus: row.status === 'replied' ? 'sent' : row.status,
            replyText: row.reply,
            replyError: row.error,
            createdAt: row.received_at,
            updatedAt: row.updated_at,
            replyAt: row.updated_at,
          },
        }))
        .filter(row => row.id);
    } catch (error) {
      console.warn('[instagram-inbox] Supabase message lookup failed', (error as Error).message);
    }
    const merged = new Map<string, { id: string; data: Record<string, any> }>();
    [...firestoreMessages, ...supabaseMessages].forEach(row => merged.set(row.id, row));
    const messages = [...merged.values()]
      .map(doc => ({ id: doc.id, data: doc.data() }))
      .filter(({ data }) => data.platform === 'instagram' && data.type === 'dm')
      .sort((a, b) => {
        return timestampMs(b.data.createdAt) - timestampMs(a.data.createdAt);
      })
      .map(({ id, data }) => serializeInstagramMessage(id, data));
    const [autoResponseEnabled, connection] = await Promise.all([
      getInstagramAutoResponseEnabled(userId),
      getInstagramConnection(userId, (req as AuthedRequest).authUser?.email),
    ]);
    res.json({ messages, autoResponseEnabled, connection });
  } catch (error) {
    next(error);
  }
});

router.post('/instagram/messages/sync', requireFirebase, async (req, res, next) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const result = await syncInstagramInboxForUser(userId, (req as AuthedRequest).authUser?.email);
    res.json(result);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Instagram inbox sync failed.';
    const message = /HTTP 403|permission for this action|does not have permission/i.test(rawMessage)
      ? 'Instagram denied inbox access because this connection was not granted the messaging permission. Disconnect Instagram, reconnect it, and approve Instagram messaging access. If the account is not an app tester, the permission must be approved for production first.'
      : rawMessage;
    // Provider failures are actionable for the user, but never include tokens
    // or the raw OAuth response in the API response.
    const status = /not available|reconnect Instagram/i.test(message) ? 409 : 502;
    res.status(status).json({ message });
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

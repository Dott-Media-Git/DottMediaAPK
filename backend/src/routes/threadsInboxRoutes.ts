import { Router } from 'express';
import { z } from 'zod';
import { requireFirebaseStrict, type AuthedRequest } from '../middleware/firebaseAuth';
import { supabaseFallbackService } from '../services/supabaseFallbackService';
import { getLegacyThreadsReplyUserIds } from '../services/threadsReplyTargets';

const router = Router();
// These existing poller targets predate per-account settings. Preserve their
// current state until their owner explicitly changes it.
const legacyEnabled = (uid: string) => getLegacyThreadsReplyUserIds().includes(uid);

router.get('/threads/replies', requireFirebaseStrict, async (req, res, next) => {
  try {
    const uid = (req as AuthedRequest).authUser?.uid;
    if (!uid) return res.status(401).json({ message: 'Unauthorized' });
    const [stored, setting, rows] = await Promise.all([
      supabaseFallbackService.getSocialAccounts(uid),
      supabaseFallbackService.getInboundMessage(`threads_auto_response_setting_${uid}`),
      supabaseFallbackService.listInboundMessagesForRecipient('threads', uid),
    ]);
    const account = stored?.socialAccounts?.threads as { accountId?: string; accessToken?: string; username?: string } | undefined;
    const payload = setting?.payload as { enabled?: boolean } | undefined;
    res.json({ connection: { connected: Boolean(account?.accountId && account?.accessToken), username: account?.username ?? null },
      autoResponseEnabled: typeof payload?.enabled === 'boolean' ? payload.enabled : legacyEnabled(uid),
      replies: rows.filter(row => row.message_type === 'comment').map(row => ({
        id: row.id, sender: row.sender_id, text: row.message, status: row.status,
        reply: row.reply ?? null, receivedAt: row.received_at, updatedAt: row.updated_at,
      })) });
  } catch (error) { next(error); }
});

router.put('/threads/auto-response', requireFirebaseStrict, async (req, res, next) => {
  try {
    const uid = (req as AuthedRequest).authUser?.uid;
    if (!uid) return res.status(401).json({ message: 'Unauthorized' });
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'A true or false setting is required.' });
    if (!supabaseFallbackService.isConfigured()) return res.status(503).json({ message: 'Settings are temporarily unavailable.' });
    await supabaseFallbackService.addInboundMessage({ id: `threads_auto_response_setting_${uid}`, channel: 'settings',
      senderId: uid, recipientId: uid, messageType: 'threads_auto_response', status: 'configured', payload: { enabled: parsed.data.enabled } });
    const saved = await supabaseFallbackService.getInboundMessage(`threads_auto_response_setting_${uid}`);
    if ((saved?.payload as { enabled?: unknown } | undefined)?.enabled !== parsed.data.enabled) throw new Error('Could not verify setting');
    res.json({ enabled: parsed.data.enabled });
  } catch (error) { next(error); }
});

export default router;

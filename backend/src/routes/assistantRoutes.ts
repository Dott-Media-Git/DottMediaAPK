import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, AuthedRequest } from '../middleware/firebaseAuth';
import { firestore } from '../db/firestore';
import { AssistantService } from '../services/assistantService';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService';
import { supabaseFallbackService } from '../services/supabaseFallbackService';

const router = Router();
const assistant = new AssistantService();
const assistantLookupTimeoutMs = Number(process.env.ASSISTANT_LOOKUP_TIMEOUT_MS ?? 1_200);
const supabasePrimary = (process.env.PRIMARY_DATA_STORE ?? 'supabase').toLowerCase() === 'supabase';

const withFallbackTimeout = <T>(action: Promise<T>, fallback: T) =>
  Promise.race([
    action,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), assistantLookupTimeoutMs)),
  ]);

const isFirestoreQuotaError = (error: unknown) => {
  const candidate = error as { code?: number | string; message?: string };
  return candidate?.code === 8 ||
    candidate?.code === 'resource-exhausted' ||
    /RESOURCE_EXHAUSTED|Quota exceeded/i.test(candidate?.message ?? '');
};

const BodySchema = z.object({
  question: z.string().min(4),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).max(200).optional(),
  context: z
    .object({
      company: z.string().optional(),
      orgId: z.string().optional(),
      businessGoals: z.string().optional(),
      targetAudience: z.string().optional(),
      currentScreen: z.string().optional(),
      subscriptionStatus: z.string().optional(),
      connectedChannels: z.array(z.string()).optional(),
      locale: z.string().max(16).optional(),
      assistantTone: z.string().optional(),
      assistantVoice: z.string().optional(),
      analytics: z
        .object({
          leads: z.number().optional(),
          engagement: z.number().optional(),
          conversions: z.number().optional(),
          feedbackScore: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

router.post('/assistant/chat', requireFirebase, async (req, res, next) => {
  try {
    const parsed = BodySchema.parse(req.body);
    const authUser = (req as AuthedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const [primaryUser, primaryProfile] = supabasePrimary
      ? await Promise.all([
          withFallbackTimeout(supabaseFallbackService.getUser(authUser.uid), null),
          withFallbackTimeout(supabaseFallbackService.getProfile(authUser.uid), null),
        ])
      : [null, null];
    if (supabasePrimary && (!primaryUser || !primaryProfile)) {
      await Promise.all([
        primaryUser ? Promise.resolve() : supabaseFallbackService.upsertUser({
          userId: authUser.uid,
          email: authUser.email,
          name: parsed.context?.company,
          authProvider: 'firebase',
          lastLoginAt: new Date(),
          data: { orgId: parsed.context?.orgId },
        }),
        primaryProfile ? Promise.resolve() : supabaseFallbackService.upsertProfile({
          userId: authUser.uid,
          email: authUser.email,
          name: parsed.context?.company,
          subscriptionStatus: parsed.context?.subscriptionStatus,
          crmData: {
            companyName: parsed.context?.company,
            orgId: parsed.context?.orgId,
            businessGoals: parsed.context?.businessGoals,
            targetAudience: parsed.context?.targetAudience,
            connectedChannels: parsed.context?.connectedChannels,
          },
          data: { source: 'assistant_context_sync' },
          updatedAt: new Date(),
        }),
      ]).catch(error => {
        console.warn('[assistant] Supabase account sync failed; Firebase fallback remains available', error instanceof Error ? error.message : error);
      });
    }
    let historyUserId: string | undefined;
    try {
      const supabaseUser = primaryUser;
      historyUserId = typeof supabaseUser?.data?.historyUserId === 'string'
        ? supabaseUser.data.historyUserId.trim()
        : undefined;
      if (historyUserId || supabaseUser) {
        // Supabase is authoritative; Firebase remains a fallback only when no row exists.
      } else {
      const userDoc = await withFallbackTimeout(
        firestore.collection('users').doc(authUser.uid).get(),
        null,
      );
      if (!userDoc) {
        console.warn('[assistant] Firestore user lookup timed out; using authenticated user ID');
      }
      historyUserId = (userDoc?.data()?.historyUserId as string | undefined)?.trim();
      }
    } catch (error) {
      if (!isFirestoreQuotaError(error)) throw error;
      console.warn('[assistant] Firestore user lookup quota exhausted; using authenticated user ID');
    }
    const effectiveUserId = historyUserId || authUser.uid;
    try {
      if (supabasePrimary) {
        console.info('[assistant] Supabase primary mode; Firebase usage metering deferred');
      } else {
      await withFallbackTimeout(
        consumeUsage(resolveBillingScope(authUser.uid, parsed.context?.orgId, authUser.email), 'aiReplies', 1),
        undefined,
      );
      }
    } catch (error) {
      if (!isFirestoreQuotaError(error)) throw error;
      console.warn('[assistant] Firestore usage metering quota exhausted; continuing authenticated request');
    }
    const answer = await assistant.answer(parsed.question, {
      ...(parsed.context ?? {}),
      userId: effectiveUserId,
      userEmail: authUser.email,
      conversationHistory: parsed.conversationHistory,
    });
    res.json({ answer });
  } catch (err) {
    next(err);
  }
});

export default router;

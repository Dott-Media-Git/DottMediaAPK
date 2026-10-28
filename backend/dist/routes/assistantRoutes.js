import { Router } from 'express';
import { z } from 'zod';
import { requireFirebase, optionalFirebase } from '../middleware/firebaseAuth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { firestore } from '../db/firestore.js';
import { AssistantService } from '../services/assistantService.js';
import { consumeUsage, resolveBillingScope } from '../services/billing/billingService.js';
import { supabaseFallbackService } from '../services/supabaseFallbackService.js';
import { saveUploadedMediaBuffer } from '../services/generatedMediaService.js';
const router = Router();
const assistant = new AssistantService();
const assistantLookupTimeoutMs = Number(process.env.ASSISTANT_LOOKUP_TIMEOUT_MS ?? 1200);
const assistantHistoryTimeoutMs = Number(process.env.ASSISTANT_HISTORY_TIMEOUT_MS ?? 8000);
const assistantSaveTimeoutMs = Number(process.env.ASSISTANT_SAVE_TIMEOUT_MS ?? 8000);
const supabasePrimary = (process.env.PRIMARY_DATA_STORE ?? 'supabase').toLowerCase() === 'supabase';
const withFallbackTimeout = (action, fallback) => Promise.race([
    action,
    new Promise(resolve => setTimeout(() => resolve(fallback), assistantLookupTimeoutMs)),
]);
const withTimeout = (action, timeoutMs, fallback) => Promise.race([
    action,
    new Promise(resolve => setTimeout(() => resolve(fallback), timeoutMs)),
]);
const isFirestoreQuotaError = (error) => {
    const candidate = error;
    return candidate?.code === 8 ||
        candidate?.code === 'resource-exhausted' ||
        /RESOURCE_EXHAUSTED|Quota exceeded/i.test(candidate?.message ?? '');
};
const BodySchema = z.object({
    question: z.string().trim().min(1).max(12000),
    conversationId: z.string().min(1).max(100).optional(),
    conversationTitle: z.string().max(80).optional(),
    conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
    })).max(200).optional(),
    attachments: z.array(z.object({
        name: z.string().min(1).max(180),
        mimeType: z.string().min(1).max(100),
        size: z.number().max(8000000).optional(),
        text: z.string().max(20000).optional(),
        dataUrl: z.string().max(12000000).optional(),
    })).max(8).optional(),
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
const ConversationIdSchema = z.string().min(1).max(100);
const conversationStore = supabaseFallbackService;
const getAssistantConversations = async (userId) => typeof conversationStore.getAssistantConversations === 'function'
    ? conversationStore.getAssistantConversations(userId)
    : [];
const resolveAssistantUserId = async (authUserId) => {
    const user = await withFallbackTimeout(supabaseFallbackService.getUser(authUserId), null);
    const historyUserId = typeof user?.data?.historyUserId === 'string' ? user.data.historyUserId.trim() : '';
    return historyUserId || authUserId;
};
const boundConversationHistory = (messages) => {
    const selected = [];
    let characters = 0;
    // Keep enough recent context for continuity without sending an ever-growing
    // transcript to the model. Long transcripts are a common cause of slow or
    // timed-out completion requests on mobile conversations.
    for (let index = messages.length - 1; index >= 0 && selected.length < 60; index -= 1) {
        const message = messages[index];
        const content = message.content.slice(0, 4000);
        if (selected.length && characters + content.length > 32000)
            break;
        const previous = selected[0];
        if (!previous || previous.role !== message.role || previous.content !== content) {
            selected.unshift({ role: message.role, content });
            characters += content.length;
        }
    }
    return selected;
};
router.get('/assistant/conversations', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const effectiveUserId = await resolveAssistantUserId(authUser.uid);
        const conversations = await withTimeout(getAssistantConversations(effectiveUserId), assistantHistoryTimeoutMs, []);
        res.json({ conversations });
    }
    catch (error) {
        next(error);
    }
});
router.delete('/assistant/conversations/:conversationId', requireFirebase, async (req, res, next) => {
    try {
        const authUser = req.authUser;
        if (!authUser)
            return res.status(401).json({ message: 'Unauthorized' });
        const conversationId = ConversationIdSchema.parse(req.params.conversationId);
        const effectiveUserId = await resolveAssistantUserId(authUser.uid);
        if (typeof conversationStore.deleteAssistantConversation === 'function') {
            await conversationStore.deleteAssistantConversation(effectiveUserId, conversationId);
        }
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
router.post('/assistant/chat', createRateLimit({ windowMs: 60000, max: 24, message: 'Too many chat messages. Please wait a moment and try again.' }), optionalFirebase, async (req, res, next) => {
    try {
        const parsed = BodySchema.parse(req.body);
        const authUser = req.authUser;
        if (!authUser) {
            if ((parsed.attachments ?? []).length) {
                return res.status(401).json({ message: 'Sign in to upload content to Dotti.' });
            }
            const answer = await assistant.answer(parsed.question, {
                ...(parsed.context ?? {}),
                userId: undefined,
                userEmail: undefined,
                guest: true,
                connectedChannels: [],
                attachments: [],
                conversationHistory: boundConversationHistory(parsed.conversationHistory ?? []),
            });
            return res.json({ answer });
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
        let historyUserId;
        try {
            const supabaseUser = primaryUser;
            historyUserId = typeof supabaseUser?.data?.historyUserId === 'string'
                ? supabaseUser.data.historyUserId.trim()
                : undefined;
            if (historyUserId || supabaseUser) {
                // Supabase is authoritative; Firebase remains a fallback only when no row exists.
            }
            else {
                const userDoc = await withFallbackTimeout(firestore.collection('users').doc(authUser.uid).get(), null);
                if (!userDoc) {
                    console.warn('[assistant] Firestore user lookup timed out; using authenticated user ID');
                }
                historyUserId = userDoc?.data()?.historyUserId?.trim();
            }
        }
        catch (error) {
            if (!isFirestoreQuotaError(error))
                throw error;
            console.warn('[assistant] Firestore user lookup quota exhausted; using authenticated user ID');
        }
        const effectiveUserId = historyUserId || authUser.uid;
        try {
            if (supabasePrimary) {
                console.info('[assistant] Supabase primary mode; Firebase usage metering deferred');
            }
            else {
                await withFallbackTimeout(consumeUsage(resolveBillingScope(authUser.uid, parsed.context?.orgId, authUser.email), 'aiReplies', 1), undefined);
            }
        }
        catch (error) {
            if (!isFirestoreQuotaError(error))
                throw error;
            console.warn('[assistant] Firestore usage metering quota exhausted; continuing authenticated request');
        }
        const cloudConversations = await withTimeout(getAssistantConversations(effectiveUserId), assistantHistoryTimeoutMs, []).catch(error => {
            console.warn('[assistant] conversation history unavailable; continuing without history', error instanceof Error ? error.message : error);
            return [];
        });
        const cloudHistory = cloudConversations
            .flatMap(conversation => conversation.messages)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map(message => ({ role: message.role, content: message.content }));
        const conversationHistory = boundConversationHistory([
            ...cloudHistory,
            ...(parsed.conversationHistory ?? []),
        ]);
        const resolvedAttachments = await Promise.all((parsed.attachments ?? []).map(async (attachment) => {
            let url;
            const match = attachment.dataUrl?.match(/^data:([^;]+);base64,(.+)$/s);
            if (match && match[1] === attachment.mimeType && attachment.mimeType.startsWith('image/')) {
                const buffer = Buffer.from(match[2], 'base64');
                if (buffer.length <= 8000000) {
                    url = await saveUploadedMediaBuffer(buffer, 'images', attachment.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png');
                }
            }
            return { name: attachment.name, mimeType: attachment.mimeType, text: attachment.text, url };
        }));
        let answer;
        try {
            answer = await assistant.answer(parsed.question, {
                ...(parsed.context ?? {}),
                // Conversation history may live under a legacy ID, but account data must
                // always be scoped exactly like the Dashboard: to the authenticated user.
                userId: authUser.uid,
                userEmail: authUser.email,
                attachments: resolvedAttachments,
                conversationHistory,
            });
        }
        catch (error) {
            console.error('[assistant] answer failed; returning a recoverable response', error);
            answer = {
                type: 'text',
                text: 'Dotti is temporarily busy. Your message was received; please try again in a moment.',
            };
        }
        const answerText = typeof answer === 'string'
            ? answer
            : typeof answer?.text === 'string'
                ? answer.text
                : '';
        if (answerText) {
            // Keep a stable server-side thread even for older clients that do not
            // send a conversation ID. New clients always send their active ID.
            const conversationId = parsed.conversationId?.trim() || 'default';
            if (typeof conversationStore.saveAssistantExchange === 'function') {
                await withTimeout(conversationStore.saveAssistantExchange({
                    userId: effectiveUserId,
                    conversationId,
                    title: parsed.conversationTitle,
                    question: parsed.question,
                    answer: answerText,
                }), assistantSaveTimeoutMs, undefined).catch(error => {
                    console.warn('[assistant] conversation save failed after response; keeping response successful', error instanceof Error ? error.message : error);
                });
            }
        }
        res.json({ answer });
    }
    catch (err) {
        // Keep chat recoverable when a non-AI dependency fails before
        // AssistantService can produce its own local fallback. The client should
        // receive a successful, useful answer instead of a generic HTTP 500.
        if (err instanceof z.ZodError)
            return next(err);
        console.error('[assistant] request preparation failed; returning recoverable response', err);
        if (!res.headersSent) {
            return res.json({
                answer: {
                    type: 'text',
                    text: 'I’m still here, but I’m temporarily reconnecting to your account data. Your message was received; please send it again in a moment and I’ll continue from this conversation.',
                },
            });
        }
        next(err);
    }
});
export default router;

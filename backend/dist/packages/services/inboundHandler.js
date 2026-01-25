import admin from 'firebase-admin';
import OpenAI from 'openai';
import { firestore } from '../../db/firestore.js';
import { config } from '../../config.js';
import { classifyIntentText } from '../brain/nlu/intentClassifier.js';
import { LeadService } from './leadService.js';
import { QualificationAgent } from './qualificationAgent.js';
import { OutboundMessenger } from '../../services/outboundMessenger.js';
import { incrementInboundAnalytics, incrementWebLeadAnalytics } from '../../services/analyticsService.js';
const messagesCollection = firestore.collection('messages');
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const replyPromptCache = new Map();
export class InboundHandler {
    constructor() {
        this.leadService = new LeadService();
        this.qualificationAgent = new QualificationAgent();
        this.messenger = new OutboundMessenger();
        this.aiClient = new OpenAI({ apiKey: config.openAI.apiKey });
    }
    async handle(payload) {
        const classification = await classifyIntentText(payload.text);
        const replyClassification = toReplyClassification(classification);
        const messageRef = await this.logMessage(payload, classification);
        let lead = null;
        let leadCreated = false;
        if (classification.intent === 'LEAD_INQUIRY' || classification.intent === 'BOOK_DEMO') {
            lead = await this.leadService.createOrUpdateLeadByChannel({
                channel: payload.channel,
                channelUserId: payload.userId,
                name: payload.name,
                email: payload.email,
                phoneNumber: payload.phone,
                profileUrl: payload.profileUrl,
                industry: classification.keywords?.[0],
                source: 'inbound',
                lastMessage: payload.text,
                sentiment: classification.sentiment,
                stage: classification.intent === 'BOOK_DEMO' ? 'DemoRequested' : 'New',
            });
            await this.qualificationAgent.enqueue({ ...lead, channel: payload.channel, score: lead.score }, replyClassification);
            leadCreated = true;
        }
        if (payload.channel === 'web') {
            await incrementWebLeadAnalytics({
                messages: 1,
                leads: lead ? 1 : 0,
            });
        }
        else {
            await incrementInboundAnalytics({
                messages: 1,
                leads: lead ? 1 : 0,
                sentimentTotal: classification.sentiment,
            });
        }
        const reply = await this.composeReply(payload, classification, lead?.name);
        if (payload.channel === 'web') {
            await this.updateReplyStatus(messageRef, 'sent');
            return { reply, leadCreated };
        }
        try {
            await this.messenger.send(payload.channel, payload.userId, reply);
            await this.updateReplyStatus(messageRef, 'sent');
        }
        catch (error) {
            console.error('Failed to send inbound reply', error);
            await this.updateReplyStatus(messageRef, 'failed', error.message);
        }
        return { reply, leadCreated };
    }
    async composeReply(payload, classification, leadName) {
        const override = await getAutoReplyPromptOverride(payload.ownerId ?? payload.metadata?.ownerId);
        const prompt = `
You are Dotti from Dott Media, responding on ${payload.channel}.
Message: """${payload.text}"""
Intent: ${classification.intent}
Name: ${leadName ?? payload.name ?? 'there'}
Goal: move them toward buying or booking a demo of the Dott Media AI Sales Agent. Keep it friendly, concise (<=3 sentences), give a clear CTA (book a demo or get the Sales Agent), and offer a link or next step.
${override ? `Additional guidance: ${override}` : ''}
`.trim();
        try {
            const completion = await this.aiClient.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.6,
                max_tokens: 200,
                messages: [
                    { role: 'system', content: 'You are Dotti, the AI sales concierge for Dott Media.' },
                    { role: 'user', content: prompt },
                ],
            });
            return completion.choices?.[0]?.message?.content?.trim() ?? this.fallbackReply(payload.channel);
        }
        catch (error) {
            console.error('Inbound reply generation failed', error);
            return this.fallbackReply(payload.channel);
        }
    }
    fallbackReply(channel) {
        return channel === 'web'
            ? 'Thanks for reaching out to Dott Media! A strategist will follow up shortly.'
            : "Appreciate the message! We'll send over AI automation details shortly.";
    }
    async logMessage(payload, classification) {
        const entry = {
            channel: payload.channel,
            userId: payload.userId,
            ownerId: payload.ownerId,
            text: payload.text,
            direction: 'inbound',
            classification,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            replyStatus: 'pending',
        };
        if (payload.metadata !== undefined) {
            entry.metadata = payload.metadata;
        }
        try {
            return await messagesCollection.add(entry);
        }
        catch (error) {
            console.warn('Failed to persist inbound message', error.message);
            return null;
        }
    }
    async updateReplyStatus(ref, status, error) {
        if (!ref)
            return;
        const update = {
            replyStatus: status,
            replyAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (error) {
            update.replyError = error;
        }
        try {
            await ref.update(update);
        }
        catch (err) {
            console.warn('Failed to update reply status', err.message);
        }
    }
}
const getAutoReplyPromptOverride = async (userId) => {
    if (!userId)
        return null;
    const now = Date.now();
    const cached = replyPromptCache.get(userId);
    if (cached?.loaded && now - cached.fetchedAt < SETTINGS_CACHE_TTL_MS) {
        return cached.value || null;
    }
    try {
        const snap = await firestore.collection('assistant_settings').doc(userId).get();
        const value = snap.data()?.autoReplyPrompt?.trim() ?? '';
        replyPromptCache.set(userId, { value: value || '', fetchedAt: now, loaded: true });
        return value || null;
    }
    catch (error) {
        console.warn('Failed to load auto-reply prompt override', error.message);
        replyPromptCache.set(userId, { value: '', fetchedAt: now, loaded: true });
        return null;
    }
};
function toReplyClassification(classification) {
    const intentMap = {
        BOOK_DEMO: 'BOOK_DEMO',
        LEAD_INQUIRY: 'INTERESTED',
        SUPPORT: 'SUPPORT',
        REFERRAL: 'CURIOUS',
        FOLLOW_UP: 'BUSY',
    };
    return {
        sentiment: classification.sentiment,
        intent: intentMap[classification.intent] ?? 'CURIOUS',
        confidence: classification.confidence,
    };
}

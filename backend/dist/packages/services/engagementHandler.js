import admin from 'firebase-admin';
import OpenAI from 'openai';
import { firestore } from '../../db/firestore.js';
import { config } from '../../config.js';
import { pickFallbackReply } from '../../services/fallbackReplyLibrary.js';
import { OPENAI_REPLY_TIMEOUT_MS } from '../../utils/openaiTimeout.js';
import { classifyIntentText } from '../brain/nlu/intentClassifier.js';
import { LeadService } from './leadService.js';
import { NotificationService } from './notificationService.js';
import { incrementEngagementAnalytics } from '../../services/analyticsService.js';
const engagementsCollection = firestore.collection('engagements');
const KEYWORDS = ['price', 'cost', 'crm', 'automation', 'ai', 'demo'];
export class EngagementHandler {
    constructor() {
        this.aiClient = new OpenAI({ apiKey: config.openAI.apiKey, timeout: OPENAI_REPLY_TIMEOUT_MS });
        this.leadService = new LeadService();
        this.notifier = new NotificationService();
    }
    async handle(payload) {
        const shouldRespond = KEYWORDS.some(keyword => payload.text.toLowerCase().includes(keyword));
        const classification = await classifyIntentText(payload.text);
        await engagementsCollection.add({
            ...payload,
            classification,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        let replyText = null;
        if (shouldRespond) {
            replyText = await this.composeComment(payload, classification);
            await this.notifier.enqueueChannelMessage(payload.channel, {
                id: payload.userId,
                name: payload.username,
                channel: payload.channel,
                profileUrl: payload.link,
            }, replyText, { commentId: payload.commentId, postId: payload.postId });
        }
        let leadCreated = 0;
        if (classification.intent === 'LEAD_INQUIRY' || classification.intent === 'BOOK_DEMO') {
            await this.leadService.createOrUpdateLeadByChannel({
                channel: payload.channel,
                channelUserId: payload.userId,
                name: payload.username,
                profileUrl: payload.link,
                source: 'engagement',
                lastMessage: payload.text,
                sentiment: classification.sentiment,
            });
            leadCreated = 1;
        }
        const analyticsScope = payload.ownerId ? { scopeId: payload.ownerId } : undefined;
        await incrementEngagementAnalytics({
            commentsDetected: 1,
            repliesSent: shouldRespond ? 1 : 0,
            conversions: leadCreated,
        }, analyticsScope);
        return { reply: replyText, leadCreated: Boolean(leadCreated) };
    }
    async composeComment(payload, classification) {
        const prompt = `
Platform: ${payload.channel}
Comment: """${payload.text}"""
Intent: ${classification.intent}
Respond as Dotti from Dott Media within 2 sentences. Nudge them to get the Dott Media AI Sales Agent or book a demo, with a clear CTA.
`;
        const fallback = pickFallbackReply({ channel: payload.channel, kind: 'comment' });
        try {
            const completion = await this.aiClient.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.5,
                messages: [
                    { role: 'system', content: 'You craft friendly public replies for Dott Media social posts.' },
                    { role: 'user', content: prompt },
                ],
            });
            return completion.choices?.[0]?.message?.content?.trim() ?? fallback;
        }
        catch (error) {
            console.error('Engagement reply failed', error);
            return fallback;
        }
    }
}

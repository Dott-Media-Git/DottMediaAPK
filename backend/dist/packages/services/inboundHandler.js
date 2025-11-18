import admin from 'firebase-admin';
import OpenAI from 'openai';
import { firestore } from '../../lib/firebase';
import { classifyIntentText } from '../brain/nlu/intentClassifier';
import { LeadService } from './leadService';
import { QualificationAgent } from './qualificationAgent';
import { OutboundMessenger } from '../../services/outboundMessenger';
import { incrementInboundAnalytics } from '../../services/analyticsService';
const messagesCollection = firestore.collection('messages');
export class InboundHandler {
    constructor() {
        this.leadService = new LeadService();
        this.qualificationAgent = new QualificationAgent();
        this.messenger = new OutboundMessenger();
        this.aiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    async handle(payload) {
        const classification = await classifyIntentText(payload.text);
        const replyClassification = toReplyClassification(classification);
        await this.logMessage(payload, classification);
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
        await incrementInboundAnalytics({
            messages: 1,
            leads: lead ? 1 : 0,
            sentimentTotal: classification.sentiment,
        });
        const reply = await this.composeReply(payload, classification, lead?.name);
        if (payload.channel === 'web') {
            return { reply, leadCreated };
        }
        try {
            await this.messenger.send(payload.channel, payload.userId, reply);
        }
        catch (error) {
            console.error('Failed to send inbound reply', error);
        }
        return { reply, leadCreated };
    }
    async composeReply(payload, classification, leadName) {
        const prompt = `
You are Dotti from Dott Media, responding on ${payload.channel}.
Message: """${payload.text}"""
Intent: ${classification.intent}
Name: ${leadName ?? payload.name ?? 'there'}
Keep reply under 3 sentences, friendly, and mention Dott Media's AI automation.
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
            : 'Appreciate the message! We’ll send over AI automation details shortly.';
    }
    async logMessage(payload, classification) {
        await messagesCollection.add({
            channel: payload.channel,
            userId: payload.userId,
            text: payload.text,
            direction: 'inbound',
            classification,
            metadata: payload.metadata,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}
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

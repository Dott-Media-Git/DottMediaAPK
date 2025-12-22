import admin from 'firebase-admin';
import OpenAI from 'openai';
import { firestore } from '../../db/firestore';
import { config } from '../../config.js';
import { classifyIntentText, IntentClassification } from '../brain/nlu/intentClassifier';
import { ReplyClassification } from '../brain/nlu/replyClassifier';
import { LeadService } from './leadService';
import { QualificationAgent } from './qualificationAgent';
import { OutboundMessenger } from '../../services/outboundMessenger';
import { incrementInboundAnalytics } from '../../services/analyticsService';

const messagesCollection = firestore.collection('messages');

export type InboundPayload = {
  channel: 'whatsapp' | 'instagram' | 'facebook' | 'linkedin' | 'web';
  userId: string;
  text: string;
  name?: string;
  profileUrl?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
};

export class InboundHandler {
  private leadService = new LeadService();
  private qualificationAgent = new QualificationAgent();
  private messenger = new OutboundMessenger();
  private aiClient = new OpenAI({ apiKey: config.openAI.apiKey });

  async handle(payload: InboundPayload) {
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

    await incrementInboundAnalytics({
      messages: 1,
      leads: lead ? 1 : 0,
      sentimentTotal: classification.sentiment,
    });

    const reply = await this.composeReply(payload, classification, lead?.name);

    if (payload.channel === 'web') {
      await this.updateReplyStatus(messageRef, 'sent');
      return { reply, leadCreated };
    }

    try {
      await this.messenger.send(payload.channel as any, payload.userId, reply);
      await this.updateReplyStatus(messageRef, 'sent');
    } catch (error) {
      console.error('Failed to send inbound reply', error);
      await this.updateReplyStatus(messageRef, 'failed', (error as Error).message);
    }
    return { reply, leadCreated };
  }

  private async composeReply(payload: InboundPayload, classification: Awaited<ReturnType<typeof classifyIntentText>>, leadName?: string) {
    const prompt = `
You are Dotti from Dott Media, responding on ${payload.channel}.
Message: """${payload.text}"""
Intent: ${classification.intent}
Name: ${leadName ?? payload.name ?? 'there'}
Goal: move them toward buying or booking a demo of the Dott Media AI Sales Agent. Keep it friendly, concise (<=3 sentences), give a clear CTA (book a demo or get the Sales Agent), and offer a link or next step.
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
    } catch (error) {
      console.error('Inbound reply generation failed', error);
      return this.fallbackReply(payload.channel);
    }
  }

  private fallbackReply(channel: string) {
    return channel === 'web'
      ? 'Thanks for reaching out to Dott Media! A strategist will follow up shortly.'
      : "Appreciate the message! We'll send over AI automation details shortly.";
  }

  private async logMessage(payload: InboundPayload, classification: Awaited<ReturnType<typeof classifyIntentText>>) {
    const entry: Record<string, unknown> = {
      channel: payload.channel,
      userId: payload.userId,
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
    } catch (error) {
      console.warn('Failed to persist inbound message', (error as Error).message);
      return null;
    }
  }

  private async updateReplyStatus(
    ref: admin.firestore.DocumentReference<admin.firestore.DocumentData> | null,
    status: 'sent' | 'failed',
    error?: string,
  ) {
    if (!ref) return;
    const update: Record<string, unknown> = {
      replyStatus: status,
      replyAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (error) {
      update.replyError = error;
    }
    try {
      await ref.update(update);
    } catch (err) {
      console.warn('Failed to update reply status', (err as Error).message);
    }
  }
}

function toReplyClassification(classification: IntentClassification): ReplyClassification {
  const intentMap: Record<string, ReplyClassification['intent']> = {
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

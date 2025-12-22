import admin from 'firebase-admin';
import OpenAI from 'openai';
import { firestore } from '../../db/firestore';
import { config } from '../../config.js';
import { classifyIntentText } from '../brain/nlu/intentClassifier';
import { LeadService } from './leadService';
import { NotificationService } from './notificationService';
import { incrementEngagementAnalytics } from '../../services/analyticsService';

const engagementsCollection = firestore.collection('engagements');

type EngagementPayload = {
  channel: 'instagram' | 'facebook' | 'linkedin';
  postId: string;
  commentId?: string;
  userId: string;
  username?: string;
  text: string;
  link?: string;
};

const KEYWORDS = ['price', 'cost', 'crm', 'automation', 'ai', 'demo'];

export class EngagementHandler {
  private aiClient = new OpenAI({ apiKey: config.openAI.apiKey });
  private leadService = new LeadService();
  private notifier = new NotificationService();

  async handle(payload: EngagementPayload) {
    const shouldRespond = KEYWORDS.some(keyword => payload.text.toLowerCase().includes(keyword));
    const classification = await classifyIntentText(payload.text);

    await engagementsCollection.add({
      ...payload,
      classification,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let replyText: string | null = null;
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

    await incrementEngagementAnalytics({
      commentsDetected: 1,
      repliesSent: shouldRespond ? 1 : 0,
      conversions: leadCreated,
    });

    return { reply: replyText, leadCreated: Boolean(leadCreated) };
  }

  private async composeComment(payload: EngagementPayload, classification: Awaited<ReturnType<typeof classifyIntentText>>) {
    const prompt = `
Platform: ${payload.channel}
Comment: """${payload.text}"""
Intent: ${classification.intent}
Respond as Dotti from Dott Media within 2 sentences. Nudge them to get the Dott Media AI Sales Agent or book a demo, with a clear CTA.
`;
    try {
      const completion = await this.aiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.5,
        messages: [
          { role: 'system', content: 'You craft friendly public replies for Dott Media social posts.' },
          { role: 'user', content: prompt },
        ],
      });
      return completion.choices?.[0]?.message?.content?.trim() ?? 'Thanks for checking out Dott Media! DM us for an AI automation demo.';
    } catch (error) {
      console.error('Engagement reply failed', error);
      return 'Thanks so much for engaging with Dott Media! Happy to share a quick AI automation demo if you’d like.';
    }
  }
}

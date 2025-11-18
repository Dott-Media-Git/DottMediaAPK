import OpenAI from 'openai';
import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';
import { config } from '../../config';
import { ReplyClassification } from '../brain/nlu/replyClassifier';
import { NotificationService, LeadDescriptor } from './notificationService';

const leadsCollection = firestore.collection('leads');
const qualificationCollection = firestore.collection('qualificationSessions');

type LeadInput = LeadDescriptor & {
  channel?: string;
  score?: number;
};

export class QualificationAgent {
  private client = new OpenAI({ apiKey: config.openAI.apiKey });
  private notifier = new NotificationService();

  needsQualification(lead: LeadInput) {
    if (!lead) return false;
    if (!lead.name || !lead.email || !lead.company) return true;
    if ((lead.score ?? 0) < 60) return true;
    return false;
  }

  async enqueue(lead: LeadInput, classification: ReplyClassification) {
    if (!this.needsQualification(lead)) {
      await this.markQualified(lead.id);
      return;
    }
    const messages = await this.generateQuestions(lead, classification);
    await qualificationCollection.doc(lead.id).set({
      leadId: lead.id,
      channel: lead.channel ?? 'outbound',
      prompts: messages,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await this.notifier.enqueueChannelMessage(lead.channel ?? 'outbound', lead, messages[0]);
  }

  async markQualified(leadId: string) {
    await leadsCollection.doc(leadId).set(
      {
        stage: 'Qualified',
        qualifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  private async generateQuestions(lead: LeadInput, classification: ReplyClassification) {
    const missing: string[] = [];
    if (!lead.name) missing.push('name');
    if (!lead.email) missing.push('email');
    if (!lead.company) missing.push('company');
    if ((lead.score ?? 0) < 60) missing.push('goals');

    const prompt = `
You are Dotti from Dott Media. Craft up to 2 short qualification questions for a lead.
Missing fields: ${missing.join(', ') || 'none'}.
Lead context: ${JSON.stringify({ name: lead.name, company: lead.company, email: lead.email, channel: lead.channel, classification })}
Output JSON: {"messages": ["question1", "question2"]}`.trim();

    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You help qualify outbound leads for demos.' },
          { role: 'user', content: prompt },
        ],
      });
      const content = completion.choices?.[0]?.message?.content;
      if (!content) return ['Could you share the best contact email for the demo?'];
      const parsed = JSON.parse(content) as { messages?: string[] };
      return (parsed.messages && parsed.messages.length ? parsed.messages : ['Could you share the best contact email for the demo?']).slice(0, 2);
    } catch (error) {
      console.error('Failed to create qualification prompts', error);
      return ['Could you share the best contact email for the demo?'];
    }
  }
}

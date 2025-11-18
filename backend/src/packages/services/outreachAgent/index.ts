import OpenAI from 'openai';
import admin from 'firebase-admin';
import { firestore } from '../../../lib/firebase';
import { config } from '../../../config';
import { Prospect } from '../prospectFinder';
import { sendLinkedInMessage } from './senders/linkedinSender';
import { sendInstagramMessage } from './senders/instagramSender';
import { sendWhatsAppMessage } from './senders/whatsappSender';
import { incrementMetric } from '../../../services/analyticsService';

const prospectsCollection = firestore.collection('prospects');
const outreachCollection = firestore.collection('outreach');
const leadsCollection = firestore.collection('leads');
const outboundLogsCollection = firestore.collection('logs').doc('outbound').collection('runs');

type OutboundReplyPayload = {
  prospectId: string;
  message: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  channel: 'linkedin' | 'instagram' | 'whatsapp';
  metadata?: Record<string, unknown>;
};

export class OutreachAgent {
  private client = new OpenAI({ apiKey: config.openAI.apiKey });

  /**
   * Pulls up to 20 new prospects and sends the first-touch outreach.
   */
  async runDailyOutreach(seedProspects: Prospect[] = []) {
    const alreadyQueued = new Map(seedProspects.map(prospect => [prospect.id, prospect]));
    const queued = await this.fetchUncontactedProspects(30);
    queued.forEach(prospect => {
      if (!alreadyQueued.has(prospect.id)) {
        alreadyQueued.set(prospect.id, prospect);
      }
    });

    const candidates = Array.from(alreadyQueued.values())
      .filter(prospect => prospect.status === 'new')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 20);

    let sent = 0;
    const errors: Array<{ prospectId: string; error: string }> = [];

    for (const prospect of candidates) {
      try {
        const message = await this.generateFirstMessage(prospect);
        const channelUsed = await this.dispatchMessage(prospect, message);
        await this.recordMessage(prospect, message, channelUsed);
        await incrementMetric('outbound_sent', 1, { industry: prospect.industry });
        sent += 1;
      } catch (error) {
        console.error('Outbound send failed', error);
        errors.push({ prospectId: prospect.id, error: (error as Error).message });
      }
    }

    await outboundLogsCollection.add({
      ranAt: admin.firestore.FieldValue.serverTimestamp(),
      prospectsConsidered: candidates.length,
      messagesSent: sent,
      errors,
    });

    return { messagesSent: sent, errors };
  }

  /**
   * Persists reply context and converts positive sentiment into CRM leads.
   */
  async handleReply(payload: OutboundReplyPayload) {
    const snapshot = await prospectsCollection.doc(payload.prospectId).get();
    if (!snapshot.exists) return;
    const prospect = snapshot.data() as Prospect;

    await outreachCollection.add({
      prospectId: payload.prospectId,
      text: payload.message,
      channel: payload.channel,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'reply',
      sentiment: payload.sentiment,
      direction: 'inbound',
    });

    await prospectsCollection.doc(payload.prospectId).set(
      {
        status: payload.sentiment === 'positive' ? 'converted' : 'contacted',
        lastReplyAt: Date.now(),
      },
      { merge: true },
    );

    await incrementMetric('outbound_reply', 1, { industry: prospect.industry });

    if (payload.sentiment === 'positive') {
      await this.createLeadFromProspect(prospect, payload);
      await incrementMetric('outbound_converted', 1, { industry: prospect.industry });
    }
  }

  private async fetchUncontactedProspects(limit = 20): Promise<Prospect[]> {
    const snap = await prospectsCollection.where('status', '==', 'new').limit(limit).get();
    return snap.docs.map(doc => {
      const data = doc.data() as Prospect;
      return {
        ...data,
        id: doc.id,
      };
    });
  }

  private async generateFirstMessage(prospect: Prospect) {
    const prompt = `
You are Dotti, an AI Sales Agent representing Dott-Media.
Write a short, friendly, professional message to ${prospect.name} from ${prospect.company ?? 'their company'}.
They are in ${prospect.industry ?? 'growth'}.
Offer to show how AI automation can increase sales.
Max 3 sentences. Add natural emoji if suitable.
`;
    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 160,
        messages: [
          {
            role: 'system',
            content: 'You compose prospecting DMs for Dott Media. Keep it human, relevant, and personalized.',
          },
          { role: 'user', content: prompt },
        ],
      });
      return completion.choices?.[0]?.message?.content?.trim() ?? this.fallbackMessage(prospect);
    } catch (error) {
      console.error('Failed to generate outreach copy', error);
      return this.fallbackMessage(prospect);
    }
  }

  private fallbackMessage(prospect: Prospect) {
    return `Hi ${prospect.name ?? 'there'}! I'm Dotti with Dott Media. We build AI automations that help ${
      prospect.company ?? 'sales teams'
    } capture and convert more leads. Want a quick walkthrough?`;
  }

  private async dispatchMessage(prospect: Prospect, text: string) {
    if (prospect.channel === 'linkedin') {
      await sendLinkedInMessage(prospect.profileUrl, text);
      return 'linkedin';
    }
    if (prospect.channel === 'instagram') {
      const username = prospect.profileUrl?.split('instagram.com/')[1]?.replace('/', '');
      await sendInstagramMessage(username, text);
      return 'instagram';
    }
    if (prospect.phone) {
      await sendWhatsAppMessage(prospect.phone, text);
      return 'whatsapp';
    }
    await sendLinkedInMessage(prospect.profileUrl, text);
    return 'linkedin';
  }

  private async recordMessage(prospect: Prospect, message: string, channel: string) {
    const sentAt = Date.now();
    await outreachCollection.add({
      prospectId: prospect.id,
      text: message,
      channel,
      sentAt,
      status: 'sent',
    });

    await prospectsCollection.doc(prospect.id).set(
      {
        status: 'contacted',
        lastContactedAt: sentAt,
        lastMessagePreview: message,
        lastChannel: channel,
      },
      { merge: true },
    );
  }

  private async createLeadFromProspect(prospect: Prospect, payload: OutboundReplyPayload) {
    await leadsCollection.doc(prospect.id).set(
      {
        name: prospect.name,
        company: prospect.company,
        email: prospect.email,
        phoneNumber: prospect.phone,
        channel: prospect.channel,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        origin: 'outbound',
        sentiment: payload.sentiment,
        lastMessage: payload.message,
      },
      { merge: true },
    );
  }
}

export const outreachAgent = new OutreachAgent();

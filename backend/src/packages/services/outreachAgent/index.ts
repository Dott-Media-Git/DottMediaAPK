import OpenAI from 'openai';
import admin from 'firebase-admin';
import { firestore } from '../../../db/firestore';
import { config } from '../../../config';
import { Prospect } from '../prospectFinder';
import { sendLinkedInMessage } from './senders/linkedinSender';
import { sendInstagramMessage, likeInstagramMedia, commentInstagramMedia } from './senders/instagramSender';
import { sendWhatsAppMessage } from './senders/whatsappSender';
import { incrementMetric } from '../../../services/analyticsService';

const prospectsCollection = firestore.collection('prospects');
const outreachCollection = firestore.collection('outreach');
const leadsCollection = firestore.collection('leads');
const outboundLogsCollection = firestore.collection('logs').doc('outbound').collection('runs');
const SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
const complianceFooterCache = new Map<string, { value: string; fetchedAt: number; loaded: boolean }>();

const outboundChannels = ['linkedin', 'instagram', 'whatsapp'] as const;
type OutboundChannel = (typeof outboundChannels)[number];

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
  async runDailyOutreach(seedProspects: Prospect[] = [], options?: { userId?: string }) {
    const userId = options?.userId;
    const perChannelCap = Math.max(0, Number(process.env.OUTBOUND_DAILY_CAP_PER_CHANNEL ?? 20));
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await this.getSentTodayCounts(startOfDay.getTime());
    const remainingCaps = outboundChannels.reduce<Record<OutboundChannel, number>>((acc, channel) => {
      acc[channel] = Math.max(0, perChannelCap - (sentToday[channel] ?? 0));
      return acc;
    }, {} as Record<OutboundChannel, number>);
    const totalRemaining = Object.values(remainingCaps).reduce((sum, value) => sum + value, 0);

    if (totalRemaining === 0) {
      await outboundLogsCollection.add({
        ranAt: admin.firestore.FieldValue.serverTimestamp(),
        prospectsConsidered: 0,
        messagesSent: 0,
        skipped: 0,
        errors: [],
        perChannelCap,
        sentToday,
        remainingCaps,
        limitReached: true,
      });
      return { messagesSent: 0, skipped: 0, errors: [] };
    }

    const targetPool = Math.min(Math.max(30, perChannelCap * outboundChannels.length * 2), 200);
    const alreadyQueued = new Map(seedProspects.map(prospect => [prospect.id, prospect]));
    const queued = await this.fetchUncontactedProspects(targetPool);
    queued.forEach(prospect => {
      if (!alreadyQueued.has(prospect.id)) {
        alreadyQueued.set(prospect.id, prospect);
      }
    });

    const candidates = Array.from(alreadyQueued.values())
      .filter(prospect => prospect.status === 'new')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, Math.max(targetPool, perChannelCap * outboundChannels.length));

    let sent = 0;
    const errors: Array<{ prospectId: string; error: string }> = [];
    const skipped: Array<{ prospectId: string; reason: string }> = [];

    const sendableByChannel: Record<OutboundChannel, Prospect[]> = {
      linkedin: [],
      instagram: [],
      whatsapp: [],
    };
    for (const prospect of candidates) {
      const reason = this.skipReason(prospect);
      if (reason) {
        skipped.push({ prospectId: prospect.id, reason });
        continue;
      }
      const channel = prospect.channel as OutboundChannel;
      if (!outboundChannels.includes(channel)) {
        skipped.push({ prospectId: prospect.id, reason: 'unsupported_channel' });
        continue;
      }
      sendableByChannel[channel].push(prospect);
    }

    if (skipped.length) {
      await Promise.all(
        skipped.map(entry => this.markSkipped(entry.prospectId, entry.reason)),
      );
    }

    const sendable: Prospect[] = [];
    outboundChannels.forEach(channel => {
      const remaining = remainingCaps[channel] ?? 0;
      if (!remaining) return;
      const channelProspects = sendableByChannel[channel].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      sendable.push(...channelProspects.slice(0, remaining));
    });

    for (const prospect of sendable) {
      try {
        const message = await this.generateFirstMessage(prospect, userId);
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
      skipped: skipped.length,
      errors,
      perChannelCap,
      sentToday,
      remainingCaps,
      candidatePool: targetPool,
    });

    return { messagesSent: sent, skipped: skipped.length, errors };
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

  private async getSentTodayCounts(startOfDayMs: number): Promise<Record<OutboundChannel, number>> {
    const counts: Record<OutboundChannel, number> = {
      linkedin: 0,
      instagram: 0,
      whatsapp: 0,
    };
    const snap = await outreachCollection.where('sentAt', '>=', startOfDayMs).get();
    snap.forEach(doc => {
      const data = doc.data() as { channel?: string; status?: string };
      if (data.status !== 'sent') return;
      const channel = data.channel as OutboundChannel;
      if (!outboundChannels.includes(channel)) return;
      counts[channel] += 1;
    });
    return counts;
  }

  private async generateFirstMessage(prospect: Prospect, userId?: string) {
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
      const base = completion.choices?.[0]?.message?.content?.trim() ?? this.fallbackMessage(prospect);
      return this.appendComplianceFooter(base, userId);
    } catch (error) {
      console.error('Failed to generate outreach copy', error);
      return this.appendComplianceFooter(this.fallbackMessage(prospect), userId);
    }
  }

  private fallbackMessage(prospect: Prospect) {
    return `Hi ${prospect.name ?? 'there'}! I'm Dotti with Dott Media. We build AI automations that help ${
      prospect.company ?? 'sales teams'
    } capture and convert more leads. Want a quick walkthrough?`;
  }

  private async getComplianceFooter(userId?: string) {
    if (!userId) return null;
    const now = Date.now();
    const cached = complianceFooterCache.get(userId);
    if (cached?.loaded && now - cached.fetchedAt < SETTINGS_CACHE_TTL_MS) {
      return cached.value || null;
    }
    try {
      const snap = await firestore.collection('assistant_settings').doc(userId).get();
      const value = (snap.data()?.outreachComplianceFooter as string | undefined)?.trim() ?? '';
      complianceFooterCache.set(userId, { value: value || '', fetchedAt: now, loaded: true });
      return value || null;
    } catch (error) {
      console.warn('Failed to load outreach compliance footer', (error as Error).message);
      complianceFooterCache.set(userId, { value: '', fetchedAt: now, loaded: true });
      return null;
    }
  }

  private async appendComplianceFooter(message: string, userId?: string) {
    const footer = await this.getComplianceFooter(userId);
    if (!footer) return message;
    if (message.toLowerCase().includes(footer.toLowerCase())) return message;
    return `${message}\n\n${footer}`;
  }

  private async dispatchMessage(prospect: Prospect, text: string) {
    if (prospect.channel === 'linkedin') {
      await sendLinkedInMessage(prospect.profileUrl, text);
      return 'linkedin';
    }
    if (prospect.channel === 'instagram') {
      const username = this.resolveInstagramRecipient(prospect.profileUrl);
      if (!username) {
        throw new Error('Instagram recipient missing for prospect.');
      }
      // Light engagement before the DM when media is available.
      if (prospect.latestMediaId) {
        try {
          await likeInstagramMedia(prospect.latestMediaId);
          const shortComment = this.buildIgComment(text);
          await commentInstagramMedia(prospect.latestMediaId, shortComment);
        } catch (error) {
          console.warn('Instagram like/comment failed', error);
        }
      }
      await sendInstagramMessage(username, text);
      return 'instagram';
    }
    if (prospect.channel === 'whatsapp') {
      if (!prospect.phone) {
        throw new Error('WhatsApp phone missing for prospect.');
      }
      await sendWhatsAppMessage(prospect.phone, text);
      return 'whatsapp';
    }
    throw new Error(`Unsupported outreach channel ${prospect.channel}`);
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

  private buildIgComment(dmText: string) {
    // Keep comment concise and CTA-driven.
    const firstLine = dmText.split('\n')[0]?.trim() ?? '';
    const base = firstLine.slice(0, 120);
    if (base.toLowerCase().includes('ai sales agent')) return base;
    return `${base} | Grab the Dott Media AI Sales Agent for more demos.`;
  }

  private skipReason(prospect: Prospect) {
    if (!['linkedin', 'instagram', 'whatsapp'].includes(prospect.channel)) {
      return 'unsupported_channel';
    }
    if (prospect.channel === 'linkedin' && !prospect.profileUrl) {
      return 'missing_linkedin_profile';
    }
    if (prospect.channel === 'instagram' && !this.resolveInstagramRecipient(prospect.profileUrl)) {
      return 'missing_instagram_profile';
    }
    if (prospect.channel === 'whatsapp' && !prospect.phone) {
      return 'missing_whatsapp_phone';
    }
    return null;
  }

  private async markSkipped(prospectId: string, reason: string) {
    await prospectsCollection.doc(prospectId).set(
      {
        status: 'skipped',
        notes: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  private resolveInstagramRecipient(profileUrl?: string) {
    if (!profileUrl) return null;
    const trimmed = profileUrl.trim();
    const match = trimmed.match(/instagram\.com\/([a-z0-9._]+)/i);
    if (match?.[1]) return match[1];
    if (/^[a-z0-9._]+$/i.test(trimmed)) return trimmed;
    return null;
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

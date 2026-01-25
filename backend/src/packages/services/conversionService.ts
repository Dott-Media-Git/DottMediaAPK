import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';
import { Prospect } from './prospectFinder';
import { LeadScoringService } from '../../services/leadScoringService';
import { classifyReply, ReplyClassification } from '../brain/nlu/replyClassifier';
import { incrementMetric } from '../../services/analyticsService';
import { OutboundCrmSyncService } from './crmSyncService';
import { QualificationAgent } from './qualificationAgent';
import { BookingAgent } from './bookingAgent';
import { NotificationService } from './notificationService';

const prospectsCollection = firestore.collection('prospects');
const leadsCollection = firestore.collection('leads');
const conversionsCollection = firestore.collection('analytics').doc('outbound').collection('conversions');

export type ProspectReplyPayload = {
  prospectId: string;
  channel: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export class ConversionService {
  private leadScoring = new LeadScoringService();
  private crmSync = new OutboundCrmSyncService();
  private qualificationAgent = new QualificationAgent();
  private bookingAgent = new BookingAgent();
  private notifier = new NotificationService();

  async handleReply(payload: ProspectReplyPayload) {
    const classification = await classifyReply(payload.text);
    return this.handleReplyWithClassification(payload, classification);
  }

  async handleReplyWithClassification(payload: ProspectReplyPayload, classification: ReplyClassification) {
    const result = await this.applyClassification(payload, classification);
    return { classification, ...result };
  }

  private async applyClassification(payload: ProspectReplyPayload, classification: ReplyClassification) {
    const snapshot = await prospectsCollection.doc(payload.prospectId).get();
    if (!snapshot.exists) {
      throw new Error(`Prospect ${payload.prospectId} not found`);
    }
    const data = snapshot.data() as Prospect;
    const prospect: Prospect = { ...data, id: snapshot.id };

    await this.logReply(prospect, payload, classification);

    if (classification.intent === 'NO_INTEREST' || classification.sentiment <= -0.4) {
      await prospectsCollection.doc(prospect.id).set(
        {
          status: 'not_interested',
          lastReplyAt: Date.now(),
        },
        { merge: true },
      );
      return { status: 'not_interested' as const };
    }

    // Convert or update lead
    const leadRecord = await this.convertToLead(prospect, payload.text, classification);
    const leadContext = { ...leadRecord, channel: prospect.channel as Prospect['channel'] };

    if (classification.intent === 'BOOK_DEMO') {
      const handled = await this.bookingAgent.handleReply(leadContext, payload.text);
      if (!handled) {
        await this.bookingAgent.autoPropose(leadContext, leadContext.channel, payload.metadata);
      }
    } else {
      await this.qualificationAgent.enqueue(leadRecord, classification);
    }

    return { status: 'converted' as const, lead: leadRecord };
  }

  private async convertToLead(prospect: Prospect, reply: string, classification: ReplyClassification) {
    const profile = {
      name: prospect.name,
      company: prospect.company,
      email: prospect.email,
      phone: prospect.phone,
      goal: prospect.notes,
    };
    const score = this.leadScoring.scoreLead({
      message: reply,
      profile,
      intent: classification.intent === 'BOOK_DEMO' ? 'Demo Booking' : 'Lead Inquiry',
      sentiment: classification.sentiment,
    });

    const leadRecord = {
      id: prospect.id,
      name: prospect.name,
      company: prospect.company,
      email: prospect.email,
      phoneNumber: prospect.phone,
      profileUrl: prospect.profileUrl,
      channel: prospect.channel,
      interest: prospect.industry,
      source: 'outbound',
      score: score.score,
      tier: score.tier,
      stage: classification.intent === 'BOOK_DEMO' ? 'DemoRequested' : 'New',
      lastReply: reply,
      lastIntent: classification.intent,
      recipient: resolveRecipient(prospect),
      createdAt: prospect.createdAt,
      updatedAt: Date.now(),
    };

    await firestore.runTransaction(async tx => {
      const leadRef = leadsCollection.doc(leadRecord.id);
      tx.set(leadRef, {
        ...leadRecord,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(
        prospectsCollection.doc(prospect.id),
        {
          status: 'converted',
          linkedLeadId: leadRecord.id,
          lastReplyAt: Date.now(),
          leadScore: leadRecord.score,
          leadTier: leadRecord.tier,
        },
        { merge: true },
      );

      tx.set(conversionsCollection.doc(leadRecord.id), {
        prospectId: prospect.id,
        leadId: leadRecord.id,
        stage: leadRecord.stage,
        score: leadRecord.score,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await incrementMetric('outbound_converted', 1, { industry: prospect.industry });
    await this.crmSync.mirrorLead(leadRecord);
    await this.notifier.notifyConversion(leadRecord);

    return leadRecord;
  }

  private async logReply(prospect: Prospect, payload: ProspectReplyPayload, classification: ReplyClassification) {
    const repliesCollection = firestore.collection('outreachReplies');
    await repliesCollection.add({
      channel: payload.channel,
      prospectId: prospect.id,
      text: payload.text,
      classification,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

function resolveRecipient(prospect: Prospect) {
  if (prospect.channel === 'whatsapp') return prospect.phone ?? undefined;
  if (prospect.channel === 'instagram') return prospect.profileUrl ? extractUsername(prospect.profileUrl) : undefined;
  if (prospect.channel === 'linkedin') return prospect.profileUrl ?? undefined;
  return prospect.email ?? prospect.phone ?? prospect.profileUrl ?? undefined;
}

function extractUsername(url: string) {
  const match = url.match(/instagram\.com\/([^/?]+)/i);
  return match?.[1] ?? url;
}

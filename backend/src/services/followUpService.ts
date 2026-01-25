import admin from 'firebase-admin';
import { firestore } from '../db/firestore';
import { ConversationRecord } from '../types/bot';
import { OpenAIService } from './openAIService';
import { OutboundMessenger } from './outboundMessenger';
import { config } from '../config';

export type FollowUpDoc = {
  id: string;
  conversationId: string;
  userId: string;
  platform: string;
  leadName?: string;
  leadTier?: string;
  goal?: string;
  scheduledFor: admin.firestore.Timestamp;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempt?: number;
  messagePreview?: string;
};

const followUpsCollection = firestore.collection('follow_ups');
const followUpLogsCollection = firestore.collection('follow_up_logs');

const DAY = 24 * 60 * 60 * 1000;

export class FollowUpService {
  private openAI = new OpenAIService();
  private messenger = new OutboundMessenger();

  async scheduleForConversation(conversation: ConversationRecord) {
    if (!config.followUps.enableAuto) return;
    if (!conversation.meta.isLead) return;
    if (conversation.meta.leadTier === 'cold') return;

    const offsets = [DAY, 3 * DAY, 7 * DAY];
    await Promise.all(
      offsets.map(async offset => {
        const docRef = followUpsCollection.doc();
        const payload: FollowUpDoc = {
          id: docRef.id,
          conversationId: conversation.conversationId,
          userId: conversation.user_id,
          platform: conversation.platform,
          leadName: conversation.meta.name,
          leadTier: conversation.meta.leadTier,
          goal: conversation.meta.goal,
          scheduledFor: admin.firestore.Timestamp.fromMillis(Date.now() + offset),
          status: 'pending',
          attempt: 0,
        };
        await docRef.set(payload);
      }),
    );
  }

  async runDueFollowUps(limit = 10) {
    const now = admin.firestore.Timestamp.now();
    const snapshot = await followUpsCollection
      .where('status', '==', 'pending')
      .where('scheduledFor', '<=', now)
      .orderBy('scheduledFor', 'asc')
      .limit(limit)
      .get();

    const results: FollowUpDoc[] = [];
    for (const doc of snapshot.docs) {
      const followUp = doc.data() as FollowUpDoc;
      try {
        await this.processFollowUp(followUp);
        results.push({ ...followUp, status: 'sent' });
      } catch (error) {
        await doc.ref.update({
          status: 'failed',
          error: (error as Error).message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        results.push({ ...followUp, status: 'failed' });
      }
    }
    return results;
  }

  private async processFollowUp(followUp: FollowUpDoc) {
    const message = await this.composeMessage(followUp);
    await this.messenger.send(followUp.platform as ConversationRecord['platform'], followUp.userId, message);
    await followUpsCollection.doc(followUp.id).update({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      messagePreview: message.slice(0, 140),
      attempt: admin.firestore.FieldValue.increment(1),
    });
    await followUpLogsCollection.add({
      followUpId: followUp.id,
      message,
      platform: followUp.platform,
      userId: followUp.userId,
      leadTier: followUp.leadTier,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  private async composeMessage(followUp: FollowUpDoc): Promise<string> {
    const context = [
      `Lead: ${followUp.leadName ?? 'there'}.`,
      `Goal: ${followUp.goal ?? 'AI automation'}.`,
      `Tier: ${followUp.leadTier ?? 'warm'}.`,
      'Prompt them to explore an AI CRM demo or share project next steps.',
      'Keep it friendly, confident, under 3 sentences.',
    ].join(' ');

    const response = await this.openAI.generateReply({
      platform: followUp.platform as ConversationRecord['platform'],
      intentCategory: 'Lead Inquiry',
      lead: {
        name: followUp.leadName,
        goal: followUp.goal,
      },
      message: `Compose a follow-up reminder for ${followUp.leadName ?? 'the lead'}. Context: ${context}`,
    });
    return response.reply;
  }
}

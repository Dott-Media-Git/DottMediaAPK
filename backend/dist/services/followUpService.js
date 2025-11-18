import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';
import { OpenAIService } from './openAIService';
import { OutboundMessenger } from './outboundMessenger';
import { config } from '../config';
const followUpsCollection = firestore.collection('follow_ups');
const followUpLogsCollection = firestore.collection('follow_up_logs');
const DAY = 24 * 60 * 60 * 1000;
export class FollowUpService {
    constructor() {
        this.openAI = new OpenAIService();
        this.messenger = new OutboundMessenger();
    }
    async scheduleForConversation(conversation) {
        if (!config.followUps.enableAuto)
            return;
        if (!conversation.meta.isLead)
            return;
        if (conversation.meta.leadTier === 'cold')
            return;
        const offsets = [DAY, 3 * DAY, 7 * DAY];
        await Promise.all(offsets.map(async (offset) => {
            const docRef = followUpsCollection.doc();
            const payload = {
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
        }));
    }
    async runDueFollowUps(limit = 10) {
        const now = admin.firestore.Timestamp.now();
        const snapshot = await followUpsCollection
            .where('status', '==', 'pending')
            .where('scheduledFor', '<=', now)
            .orderBy('scheduledFor', 'asc')
            .limit(limit)
            .get();
        const results = [];
        for (const doc of snapshot.docs) {
            const followUp = doc.data();
            try {
                await this.processFollowUp(followUp);
                results.push({ ...followUp, status: 'sent' });
            }
            catch (error) {
                await doc.ref.update({
                    status: 'failed',
                    error: error.message,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                results.push({ ...followUp, status: 'failed' });
            }
        }
        return results;
    }
    async processFollowUp(followUp) {
        const message = await this.composeMessage(followUp);
        await this.messenger.send(followUp.platform, followUp.userId, message);
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
    async composeMessage(followUp) {
        const context = [
            `Lead: ${followUp.leadName ?? 'there'}.`,
            `Goal: ${followUp.goal ?? 'AI automation'}.`,
            `Tier: ${followUp.leadTier ?? 'warm'}.`,
            'Prompt them to explore an AI CRM demo or share project next steps.',
            'Keep it friendly, confident, under 3 sentences.',
        ].join(' ');
        const response = await this.openAI.generateReply({
            platform: followUp.platform,
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

import { v4 as uuid } from 'uuid';
import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { classifyIntent, detectResponseType, extractKeywords, extractLeadProfile, scoreSentiment, } from '../utils/nlp.js';
import { OpenAIService } from './openAIService.js';
import { BotStatsService } from './botStatsService.js';
import { LeadScoringService } from './leadScoringService.js';
import { FollowUpService } from './followUpService.js';
import { KnowledgeBaseService } from './knowledgeBaseService.js';
const conversationsCollection = firestore.collection('conversations');
const messagesCollection = firestore.collection('messages');
const leadsCollection = firestore.collection('leads');
export class ConversationService {
    constructor() {
        this.openAI = new OpenAIService();
        this.stats = new BotStatsService();
        this.leadScoring = new LeadScoringService();
        this.followUps = new FollowUpService();
        this.knowledgeBase = new KnowledgeBaseService();
    }
    async handleMessage(payload) {
        const intentCategory = classifyIntent(payload.message);
        const sentimentScore = scoreSentiment(payload.message);
        const inferredLead = extractLeadProfile(payload.message, payload.profile?.name);
        const leadProfile = {
            ...inferredLead,
            name: inferredLead.name ?? payload.profile?.name,
            email: inferredLead.email ?? payload.profile?.email,
            company: inferredLead.company ?? payload.profile?.company,
            isLead: inferredLead.isLead || Boolean(payload.profile?.email),
        };
        const knowledge = await this.knowledgeBase.getRelevantSnippets(payload.message);
        const aiReply = await this.openAI.generateReply({
            message: payload.message,
            platform: payload.platform,
            intentCategory,
            lead: leadProfile,
            knowledge,
        });
        const leadScoreResult = this.leadScoring.scoreLead({
            message: payload.message,
            profile: leadProfile,
            intent: intentCategory,
            sentiment: sentimentScore,
        });
        const userMessage = {
            role: 'user',
            content: payload.message,
            timestamp: new Date(payload.timestamp).toISOString(),
        };
        const assistantMessage = {
            role: 'assistant',
            content: aiReply.reply,
            timestamp: new Date().toISOString(),
        };
        const conversationId = uuid();
        const conversation = {
            conversationId,
            user_id: payload.userId,
            channel_user_id: payload.channelUserId,
            platform: payload.platform,
            intent_category: intentCategory,
            response_type: aiReply.responseType ?? detectResponseType(aiReply.reply),
            sentiment_score: sentimentScore,
            created_at: userMessage.timestamp,
            updated_at: assistantMessage.timestamp,
            messages: [userMessage, assistantMessage],
            meta: {
                ...leadProfile,
                isLead: leadProfile.isLead ?? false,
                leadScore: leadScoreResult.score,
                leadTier: leadScoreResult.tier,
            },
        };
        await conversationsCollection.doc(conversationId).set({
            ...conversation,
            keywords: extractKeywords(payload.message),
        });
        await leadsCollection.doc(conversationId).set({
            conversationId,
            userId: payload.userId,
            platform: payload.platform,
            intent: intentCategory,
            sentiment: sentimentScore,
            leadScore: leadScoreResult.score,
            leadTier: leadScoreResult.tier,
            profile: {
                ...leadProfile,
            },
            goal: leadProfile.goal,
            budget: leadProfile.budget,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
        });
        const messageRef = await messagesCollection.add({
            messageId: payload.messageId,
            platform: payload.platform,
            intent: intentCategory,
            sentiment_score: sentimentScore,
            response_time_ms: Date.now() - payload.timestamp,
            keywords: extractKeywords(payload.message),
            user_id: payload.userId,
            lead_score: leadScoreResult.score,
            lead_tier: leadScoreResult.tier,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            replyStatus: 'pending',
        });
        await this.stats.recordSession({
            conversation,
            responseTimeMs: Date.now() - payload.timestamp,
            isLead: Boolean(leadProfile.isLead),
            leadScore: leadScoreResult.score,
            leadTier: leadScoreResult.tier,
        });
        if (leadProfile.isLead) {
            await this.stats.forwardLead({
                name: leadProfile.name,
                email: leadProfile.email,
                phoneNumber: leadProfile.phone ?? payload.channelUserId,
                company: leadProfile.company,
                intentCategory,
                interestCategory: leadProfile.interestCategory,
                platform: payload.platform,
                source: payload.platform,
                goal: leadProfile.goal,
                budget: leadProfile.budget,
                leadScore: leadScoreResult.score,
                leadTier: leadScoreResult.tier,
            });
            await this.followUps.scheduleForConversation(conversation);
        }
        return {
            reply: aiReply.reply,
            intentCategory,
            sentimentScore,
            conversation,
            messageDocId: messageRef.id,
        };
    }
    async updateReplyStatus(messageDocId, status, error) {
        if (!messageDocId)
            return;
        const update = {
            replyStatus: status,
            replyAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (error) {
            update.replyError = error;
        }
        try {
            await messagesCollection.doc(messageDocId).update(update);
        }
        catch (err) {
            console.warn('Failed to update reply status', err.message);
        }
    }
}

import OpenAI from 'openai';
import admin from 'firebase-admin';
import { firestore } from '../../../db/firestore.js';
import { config } from '../../../config.js';
import { sendLinkedInMessage } from './senders/linkedinSender.js';
import { sendInstagramMessage, likeInstagramMedia, commentInstagramMedia } from './senders/instagramSender.js';
import { sendWhatsAppMessage } from './senders/whatsappSender.js';
import { incrementMetric } from '../../../services/analyticsService.js';
const prospectsCollection = firestore.collection('prospects');
const outreachCollection = firestore.collection('outreach');
const leadsCollection = firestore.collection('leads');
const outboundLogsCollection = firestore.collection('logs').doc('outbound').collection('runs');
const SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
const complianceFooterCache = new Map();
const outboundChannels = ['linkedin', 'instagram', 'whatsapp'];
export class OutreachAgent {
    constructor() {
        this.client = new OpenAI({ apiKey: config.openAI.apiKey });
    }
    /**
     * Pulls up to 20 new prospects and sends the first-touch outreach.
     */
    async runDailyOutreach(seedProspects = [], options) {
        const userId = options?.userId;
        const perChannelCap = Math.max(0, Number(process.env.OUTBOUND_DAILY_CAP_PER_CHANNEL ?? 20));
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const sentToday = await this.getSentTodayCounts(startOfDay.getTime());
        const remainingCaps = outboundChannels.reduce((acc, channel) => {
            acc[channel] = Math.max(0, perChannelCap - (sentToday[channel] ?? 0));
            return acc;
        }, {});
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
        const errors = [];
        const skipped = [];
        const sendableByChannel = {
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
            const channel = prospect.channel;
            if (!outboundChannels.includes(channel)) {
                skipped.push({ prospectId: prospect.id, reason: 'unsupported_channel' });
                continue;
            }
            sendableByChannel[channel].push(prospect);
        }
        if (skipped.length) {
            await Promise.all(skipped.map(entry => this.markSkipped(entry.prospectId, entry.reason)));
        }
        const sendable = [];
        outboundChannels.forEach(channel => {
            const remaining = remainingCaps[channel] ?? 0;
            if (!remaining)
                return;
            const channelProspects = sendableByChannel[channel].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            sendable.push(...channelProspects.slice(0, remaining));
        });
        for (const prospect of sendable) {
            const analyticsScope = resolveAnalyticsScope(userId, prospect);
            try {
                const message = await this.generateFirstMessage(prospect, userId);
                const channelUsed = await this.dispatchMessage(prospect, message);
                await this.recordMessage(prospect, message, channelUsed);
                await incrementMetric('outbound_sent', 1, { industry: prospect.industry }, analyticsScope);
                sent += 1;
            }
            catch (error) {
                console.error('Outbound send failed', error);
                errors.push({ prospectId: prospect.id, error: error.message });
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
    async handleReply(payload) {
        const snapshot = await prospectsCollection.doc(payload.prospectId).get();
        if (!snapshot.exists)
            return;
        const prospect = snapshot.data();
        await outreachCollection.add({
            prospectId: payload.prospectId,
            text: payload.message,
            channel: payload.channel,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'reply',
            sentiment: payload.sentiment,
            direction: 'inbound',
        });
        await prospectsCollection.doc(payload.prospectId).set({
            status: payload.sentiment === 'positive' ? 'converted' : 'contacted',
            lastReplyAt: Date.now(),
        }, { merge: true });
        const analyticsScope = resolveAnalyticsScope(undefined, prospect, payload.metadata);
        await incrementMetric('outbound_reply', 1, { industry: prospect.industry }, analyticsScope);
        if (payload.sentiment === 'positive') {
            await this.createLeadFromProspect(prospect, payload);
            await incrementMetric('outbound_converted', 1, { industry: prospect.industry }, analyticsScope);
        }
    }
    async fetchUncontactedProspects(limit = 20) {
        const snap = await prospectsCollection.where('status', '==', 'new').limit(limit).get();
        return snap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
            };
        });
    }
    async getSentTodayCounts(startOfDayMs) {
        const counts = {
            linkedin: 0,
            instagram: 0,
            whatsapp: 0,
        };
        const snap = await outreachCollection.where('sentAt', '>=', startOfDayMs).get();
        snap.forEach(doc => {
            const data = doc.data();
            if (data.status !== 'sent')
                return;
            const channel = data.channel;
            if (!outboundChannels.includes(channel))
                return;
            counts[channel] += 1;
        });
        return counts;
    }
    async generateFirstMessage(prospect, userId) {
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
        }
        catch (error) {
            console.error('Failed to generate outreach copy', error);
            return this.appendComplianceFooter(this.fallbackMessage(prospect), userId);
        }
    }
    fallbackMessage(prospect) {
        return `Hi ${prospect.name ?? 'there'}! I'm Dotti with Dott Media. We build AI automations that help ${prospect.company ?? 'sales teams'} capture and convert more leads. Want a quick walkthrough?`;
    }
    async getComplianceFooter(userId) {
        if (!userId)
            return null;
        const now = Date.now();
        const cached = complianceFooterCache.get(userId);
        if (cached?.loaded && now - cached.fetchedAt < SETTINGS_CACHE_TTL_MS) {
            return cached.value || null;
        }
        try {
            const snap = await firestore.collection('assistant_settings').doc(userId).get();
            const value = snap.data()?.outreachComplianceFooter?.trim() ?? '';
            complianceFooterCache.set(userId, { value: value || '', fetchedAt: now, loaded: true });
            return value || null;
        }
        catch (error) {
            console.warn('Failed to load outreach compliance footer', error.message);
            complianceFooterCache.set(userId, { value: '', fetchedAt: now, loaded: true });
            return null;
        }
    }
    async appendComplianceFooter(message, userId) {
        const footer = await this.getComplianceFooter(userId);
        if (!footer)
            return message;
        if (message.toLowerCase().includes(footer.toLowerCase()))
            return message;
        return `${message}\n\n${footer}`;
    }
    async dispatchMessage(prospect, text) {
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
                }
                catch (error) {
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
    async recordMessage(prospect, message, channel) {
        const sentAt = Date.now();
        await outreachCollection.add({
            prospectId: prospect.id,
            text: message,
            channel,
            sentAt,
            status: 'sent',
        });
        await prospectsCollection.doc(prospect.id).set({
            status: 'contacted',
            lastContactedAt: sentAt,
            lastMessagePreview: message,
            lastChannel: channel,
        }, { merge: true });
    }
    buildIgComment(dmText) {
        // Keep comment concise and CTA-driven.
        const firstLine = dmText.split('\n')[0]?.trim() ?? '';
        const base = firstLine.slice(0, 120);
        if (base.toLowerCase().includes('ai sales agent'))
            return base;
        return `${base} | Grab the Dott Media AI Sales Agent for more demos.`;
    }
    skipReason(prospect) {
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
    async markSkipped(prospectId, reason) {
        await prospectsCollection.doc(prospectId).set({
            status: 'skipped',
            notes: reason,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    resolveInstagramRecipient(profileUrl) {
        if (!profileUrl)
            return null;
        const trimmed = profileUrl.trim();
        const match = trimmed.match(/instagram\.com\/([a-z0-9._]+)/i);
        if (match?.[1])
            return match[1];
        if (/^[a-z0-9._]+$/i.test(trimmed))
            return trimmed;
        return null;
    }
    async createLeadFromProspect(prospect, payload) {
        await leadsCollection.doc(prospect.id).set({
            name: prospect.name,
            company: prospect.company,
            email: prospect.email,
            phoneNumber: prospect.phone,
            channel: prospect.channel,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            origin: 'outbound',
            sentiment: payload.sentiment,
            lastMessage: payload.message,
        }, { merge: true });
    }
}
function resolveAnalyticsScope(userId, prospect, metadata) {
    const scopeId = pickScopeId(metadata?.orgId, metadata?.workspaceId, metadata?.ownerId, metadata?.userId, prospect?.orgId, prospect?.ownerId, prospect?.userId, userId);
    return scopeId ? { scopeId } : undefined;
}
function pickScopeId(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed)
                return trimmed;
        }
    }
    return undefined;
}
export const outreachAgent = new OutreachAgent();

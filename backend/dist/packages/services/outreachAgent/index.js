import OpenAI from 'openai';
import admin from 'firebase-admin';
import { firestore } from '../../../db/firestore.js';
import { config } from '../../../config.js';
import { sendLinkedInMessage } from './senders/linkedinSender.js';
import { sendInstagramMessage, likeInstagramMedia, commentInstagramMedia } from './senders/instagramSender.js';
import { sendWhatsAppMessage } from './senders/whatsappSender.js';
import { sendXDirectMessage } from './senders/xSender.js';
import { incrementMetric } from '../../../services/analyticsService.js';
import { canUsePrimarySocialDefaults } from '../../../utils/socialAccess.js';
const prospectsCollection = firestore.collection('prospects');
const outreachCollection = firestore.collection('outreach');
const leadsCollection = firestore.collection('leads');
const suppressionCollection = firestore.collection('outreachSuppression');
const outboundLogsCollection = firestore.collection('logs').doc('outbound').collection('runs');
const SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
const complianceFooterCache = new Map();
const outboundChannels = ['linkedin', 'instagram', 'whatsapp', 'x'];
const X_DAILY_CAP_HARD_LIMIT = 299;
const X_OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'remove me', 'no dm', 'no message'];
const X_OPT_IN_TAGS = ['x_opt_in', 'dm_opt_in', 'opted_in_dm', 'requested_dm', 'inbound_opt_in'];
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
        const runContext = await this.buildRunContext(userId, perChannelCap);
        const perChannelCaps = this.resolvePerChannelCaps(perChannelCap, runContext.xPolicy.dailyCap);
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const sentToday = await this.getSentTodayCounts(startOfDay.getTime(), userId);
        const remainingCaps = outboundChannels.reduce((acc, channel) => {
            const configuredCap = perChannelCaps[channel] ?? 0;
            acc[channel] = Math.max(0, configuredCap - (sentToday[channel] ?? 0));
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
                userId: userId ?? null,
                perChannelCap,
                perChannelCaps,
                sentToday,
                remainingCaps,
                limitReached: true,
            });
            return { messagesSent: 0, skipped: 0, errors: [] };
        }
        const totalConfiguredCap = outboundChannels.reduce((sum, channel) => sum + (perChannelCaps[channel] ?? 0), 0);
        const targetPool = Math.min(Math.max(50, totalConfiguredCap * 2), 2000);
        const alreadyQueued = new Map(seedProspects.map(prospect => [prospect.id, prospect]));
        const queued = await this.fetchUncontactedProspects(targetPool, userId);
        queued.forEach(prospect => {
            if (!alreadyQueued.has(prospect.id)) {
                alreadyQueued.set(prospect.id, prospect);
            }
        });
        const candidates = Array.from(alreadyQueued.values())
            .filter(prospect => prospect.status === 'new')
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, Math.max(targetPool, totalConfiguredCap));
        let sent = 0;
        const errors = [];
        const skipped = [];
        const sendableByChannel = {
            linkedin: [],
            instagram: [],
            whatsapp: [],
            x: [],
        };
        for (const prospect of candidates) {
            const reason = this.skipReason(prospect, runContext);
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
                const message = await this.generateFirstMessage(prospect, runContext);
                const channelUsed = await this.dispatchMessage(prospect, message, runContext);
                await this.recordMessage(prospect, message, channelUsed, userId);
                await incrementMetric('outbound_sent', 1, { industry: prospect.industry }, analyticsScope);
                sent += 1;
                if (channelUsed === 'x' && runContext.xPolicy.minDelayMs > 0) {
                    await this.sleep(runContext.xPolicy.minDelayMs);
                }
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
            userId: userId ?? null,
            perChannelCap,
            perChannelCaps,
            sentToday,
            remainingCaps,
            candidatePool: targetPool,
            xRequireOptIn: runContext.xPolicy.requireOptIn,
            xMinDelayMs: runContext.xPolicy.minDelayMs,
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
        const firstResponder = !prospect.lastReplyAt;
        const userId = this.extractUserId(payload.metadata, prospect);
        await outreachCollection.add({
            prospectId: payload.prospectId,
            text: payload.message,
            channel: payload.channel,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'reply',
            sentiment: payload.sentiment,
            direction: 'inbound',
            ...(userId ? { userId } : {}),
        });
        await prospectsCollection.doc(payload.prospectId).set({
            status: payload.sentiment === 'positive' ? 'converted' : 'contacted',
            lastReplyAt: Date.now(),
        }, { merge: true });
        const analyticsScope = resolveAnalyticsScope(undefined, prospect, payload.metadata);
        if (firstResponder) {
            await incrementMetric('outbound_responder', 1, { industry: prospect.industry }, analyticsScope);
        }
        await incrementMetric('outbound_reply', 1, { industry: prospect.industry }, analyticsScope);
        if (payload.channel === 'x' && this.isXOptOutMessage(payload.message)) {
            await this.suppressXProspect(prospect, userId, 'recipient_opt_out');
            return;
        }
        if (payload.sentiment === 'positive') {
            await this.createLeadFromProspect(prospect, payload);
            await incrementMetric('outbound_converted', 1, { industry: prospect.industry }, analyticsScope);
        }
    }
    async fetchUncontactedProspects(limit = 20, userId) {
        const normalizeRows = (rows) => rows.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
            };
        });
        if (userId) {
            const scoped = await prospectsCollection.where('status', '==', 'new').where('ownerId', '==', userId).limit(limit).get();
            if (!scoped.empty) {
                return normalizeRows(scoped);
            }
        }
        const snap = await prospectsCollection.where('status', '==', 'new').limit(limit).get();
        return normalizeRows(snap);
    }
    async getSentTodayCounts(startOfDayMs, userId) {
        const counts = {
            linkedin: 0,
            instagram: 0,
            whatsapp: 0,
            x: 0,
        };
        let query = outreachCollection.where('sentAt', '>=', startOfDayMs);
        if (userId) {
            query = query.where('userId', '==', userId);
        }
        const snap = await query.get();
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
    async generateFirstMessage(prospect, context) {
        if (prospect.channel === 'x') {
            const template = this.generateXOutreachMessage(prospect, context.isSportsBrand);
            const withOptOut = this.appendXComplianceLine(template);
            return this.appendComplianceFooter(withOptOut, context.userId);
        }
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
            return this.appendComplianceFooter(base, context.userId);
        }
        catch (error) {
            console.error('Failed to generate outreach copy', error);
            return this.appendComplianceFooter(this.fallbackMessage(prospect), context.userId);
        }
    }
    fallbackMessage(prospect) {
        return `Hi ${prospect.name ?? 'there'}! I'm Dotti with Dott Media. We build AI automations that help ${prospect.company ?? 'sales teams'} capture and convert more leads. Want a quick walkthrough?`;
    }
    generateXOutreachMessage(prospect, sportsBrand) {
        const firstName = prospect.name?.trim()?.split(' ')[0] ?? 'there';
        if (sportsBrand) {
            const templates = [
                `Hi ${firstName}! Thanks for engaging with our football updates. We share daily match insights, value picks, and timing alerts. More info: www.bwinbetug.info | Bets: www.bwinbetug.com`,
                `Hi ${firstName}, great to connect! We post curated football insights and smart bet angles across major leagues. For full details visit www.bwinbetug.info, then place your bet at www.bwinbetug.com`,
                `Hi ${firstName}! If you want structured football tips (form, odds context, and key fixtures), we can share today's board. Info: www.bwinbetug.info | Place bets: www.bwinbetug.com`,
            ];
            const seed = `${prospect.id}:${new Date().toISOString().slice(0, 10)}`;
            return templates[this.hashSeed(seed) % templates.length];
        }
        const templates = [
            `Hi ${firstName}! We help teams automate outreach, responses, and lead follow-up. Happy to share a fast walkthrough tailored to your workflow.`,
            `Hi ${firstName}, great to connect. We build practical AI automation for sales and social workflows. Want a quick demo?`,
            `Hi ${firstName}! If scaling replies and lead conversion is a priority, we can share a simple automation blueprint for your team.`,
        ];
        const seed = `${prospect.id}:${prospect.channel}:${new Date().toISOString().slice(0, 10)}`;
        return templates[this.hashSeed(seed) % templates.length];
    }
    appendXComplianceLine(message) {
        if (message.toLowerCase().includes('reply stop to opt out'))
            return message;
        return `${message}\n\nReply STOP to opt out.`;
    }
    hashSeed(seed) {
        let hash = 0;
        for (let index = 0; index < seed.length; index += 1) {
            hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
        }
        return hash;
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
    async dispatchMessage(prospect, text, context) {
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
        if (prospect.channel === 'x') {
            const recipient = this.resolveXRecipient(prospect.profileUrl);
            if (!recipient) {
                throw new Error('X recipient missing for prospect.');
            }
            if (!context.xCredentials) {
                throw new Error('X credentials are not configured for this user.');
            }
            await sendXDirectMessage(recipient, text, context.xCredentials);
            return 'x';
        }
        throw new Error(`Unsupported outreach channel ${prospect.channel}`);
    }
    async recordMessage(prospect, message, channel, userId) {
        const sentAt = Date.now();
        await outreachCollection.add({
            prospectId: prospect.id,
            text: message,
            channel,
            sentAt,
            status: 'sent',
            ...(userId ? { userId } : {}),
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
    skipReason(prospect, context) {
        if (!['linkedin', 'instagram', 'whatsapp', 'x'].includes(prospect.channel)) {
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
        if (prospect.channel === 'x') {
            const recipient = this.resolveXRecipient(prospect.profileUrl);
            if (!recipient) {
                return 'missing_x_profile';
            }
            if (!context.xCredentials) {
                return 'missing_x_credentials';
            }
            const handle = this.resolveXHandle(prospect.profileUrl);
            if (handle && context.xSuppressedHandles.has(handle)) {
                return 'x_recipient_opted_out';
            }
            if (context.xPolicy.requireOptIn && !this.hasExplicitXOptIn(prospect)) {
                return 'x_opt_in_required';
            }
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
    resolveXRecipient(profileUrl) {
        if (!profileUrl)
            return null;
        const trimmed = profileUrl.trim();
        if (/^\d+$/.test(trimmed))
            return trimmed;
        const urlMatch = trimmed.match(/(?:x|twitter)\.com\/([a-z0-9_]{1,15})/i);
        if (urlMatch?.[1])
            return urlMatch[1];
        const handleMatch = trimmed.match(/^@?([a-z0-9_]{1,15})$/i);
        if (handleMatch?.[1])
            return handleMatch[1];
        return null;
    }
    resolveXHandle(profileUrl) {
        const recipient = this.resolveXRecipient(profileUrl);
        if (!recipient)
            return null;
        if (/^\d+$/.test(recipient))
            return null;
        return recipient.toLowerCase();
    }
    async buildRunContext(userId, perChannelCap) {
        const xPolicy = this.resolveXPolicy(perChannelCap);
        const [xCredentials, xSuppressedHandles, isSportsBrand] = await Promise.all([
            this.resolveXCredentials(userId),
            this.loadSuppressedXHandles(userId),
            this.resolveSportsBrandContext(userId),
        ]);
        return {
            userId,
            xCredentials,
            xSuppressedHandles,
            xPolicy,
            isSportsBrand,
        };
    }
    resolvePerChannelCaps(perChannelCap, xDailyCap) {
        const base = Math.max(0, perChannelCap);
        return {
            linkedin: base,
            instagram: base,
            whatsapp: base,
            x: xDailyCap,
        };
    }
    resolveXPolicy(perChannelCap) {
        const requestedCap = Number(process.env.OUTBOUND_DAILY_CAP_X ?? perChannelCap);
        const dailyCap = Math.min(Math.max(Number.isFinite(requestedCap) ? requestedCap : perChannelCap, 0), X_DAILY_CAP_HARD_LIMIT);
        const requestedDelaySeconds = Number(process.env.OUTBOUND_X_MIN_SECONDS_BETWEEN_DMS ?? 4);
        const safeDelaySeconds = Math.min(Math.max(Number.isFinite(requestedDelaySeconds) ? requestedDelaySeconds : 4, 0), 300);
        const requireOptIn = process.env.OUTBOUND_X_REQUIRE_OPT_IN !== 'false';
        return { dailyCap, requireOptIn, minDelayMs: safeDelaySeconds * 1000 };
    }
    hasExplicitXOptIn(prospect) {
        const tags = (prospect.tags ?? []).map(value => value.toLowerCase());
        if (tags.some(tag => X_OPT_IN_TAGS.includes(tag)))
            return true;
        const notes = (prospect.notes ?? '').toLowerCase();
        if (notes && (notes.includes('opt in') || notes.includes('opt-in') || notes.includes('consent'))) {
            return true;
        }
        if (prospect.status === 'replied' && prospect.lastChannel === 'x') {
            return true;
        }
        return false;
    }
    isXOptOutMessage(message) {
        const text = message.toLowerCase();
        return X_OPT_OUT_KEYWORDS.some(keyword => text.includes(keyword));
    }
    async loadSuppressedXHandles(userId) {
        let query = suppressionCollection.where('channel', '==', 'x');
        if (userId) {
            query = query.where('userId', '==', userId);
        }
        const snap = await query.limit(2000).get();
        const handles = new Set();
        snap.forEach(doc => {
            const data = doc.data();
            const handle = (data.handle ?? '').trim().replace(/^@/, '').toLowerCase();
            if (handle)
                handles.add(handle);
        });
        return handles;
    }
    async suppressXProspect(prospect, userId, reason) {
        const handle = this.resolveXHandle(prospect.profileUrl);
        if (!handle)
            return;
        const docId = userId ? `${userId}:x:${handle}` : `x:${handle}`;
        await suppressionCollection.doc(docId).set({
            channel: 'x',
            handle,
            reason,
            prospectId: prospect.id,
            userId: userId ?? null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    async resolveSportsBrandContext(userId) {
        if (!userId)
            return false;
        try {
            const userDoc = await firestore.collection('users').doc(userId).get();
            const data = userDoc.data();
            const email = (data?.email ?? '').toLowerCase();
            const companyName = (data?.crmData?.companyName ?? '').toLowerCase();
            return email.includes('bwinbet') || companyName.includes('bwinbet') || email.includes('sports');
        }
        catch {
            return false;
        }
    }
    async resolveXCredentials(userId) {
        if (!userId)
            return null;
        const userDoc = await firestore.collection('users').doc(userId).get();
        const data = userDoc.data();
        const twitter = data?.socialAccounts?.twitter;
        if (!twitter?.accessToken || !twitter?.accessSecret)
            return null;
        const allowDefaults = canUsePrimarySocialDefaults({ email: data?.email ?? null });
        const appKey = twitter.appKey ??
            twitter.consumerKey ??
            (allowDefaults ? process.env.TWITTER_API_KEY ?? process.env.TWITTER_CONSUMER_KEY : undefined);
        const appSecret = twitter.appSecret ??
            twitter.consumerSecret ??
            (allowDefaults ? process.env.TWITTER_API_SECRET ?? process.env.TWITTER_CONSUMER_SECRET : undefined);
        if (!appKey || !appSecret)
            return null;
        return {
            appKey,
            appSecret,
            accessToken: twitter.accessToken,
            accessSecret: twitter.accessSecret,
        };
    }
    extractUserId(metadata, prospect) {
        const values = [
            metadata?.userId,
            metadata?.ownerId,
            metadata?.orgId,
            prospect?.ownerId,
            prospect?.userId,
            prospect?.orgId,
        ];
        for (const value of values) {
            if (typeof value === 'string' && value.trim())
                return value.trim();
        }
        return undefined;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

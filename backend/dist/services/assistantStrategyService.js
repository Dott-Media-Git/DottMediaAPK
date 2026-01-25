import admin from 'firebase-admin';
import { firestore } from '../db/firestore.js';
import { AnalyticsService } from './analyticsService.js';
import { SocialAnalyticsService } from '../packages/services/socialAnalyticsService.js';
import { resolveAnalyticsScopeKey } from './analyticsScope.js';
import { autoPostService } from './autoPostService.js';
import { outreachAgent } from '../packages/services/outreachAgent/index.js';
import { contentGenerationService } from '../packages/services/contentGenerationService.js';
import { socialSchedulingService } from '../packages/services/socialSchedulingService.js';
import { sendMonthlyPerformanceReportEmail } from './emailService.js';
const strategiesCollection = firestore.collection('assistant_strategies');
const settingsCollection = firestore.collection('assistant_settings');
const DEFAULT_ANALYSIS_DAYS = 7;
const DEFAULT_PLAN_DAYS = 30;
const SupportedChannels = [
    'instagram',
    'instagram_reels',
    'facebook',
    'linkedin',
    'threads',
    'x',
    'twitter',
    'tiktok',
    'youtube',
    'whatsapp',
    'web',
];
const CHANNEL_ALIASES = [
    { channel: 'instagram', aliases: ['instagram', 'insta', 'ig'] },
    { channel: 'instagram_reels', aliases: ['reels', 'instagram reels', 'ig reels'] },
    { channel: 'facebook', aliases: ['facebook', 'fb'] },
    { channel: 'linkedin', aliases: ['linkedin'] },
    { channel: 'threads', aliases: ['threads'] },
    { channel: 'x', aliases: [' x ', 'twitter', 'x.com'] },
    { channel: 'twitter', aliases: ['twitter'] },
    { channel: 'tiktok', aliases: ['tiktok', 'tik tok'] },
    { channel: 'youtube', aliases: ['youtube', 'yt'] },
    { channel: 'whatsapp', aliases: ['whatsapp', 'wa'] },
    { channel: 'web', aliases: ['web', 'website', 'site'] },
];
const toDateKey = (date) => date.toISOString().slice(0, 10);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sumField = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
const averageField = (rows, key) => {
    if (!rows.length)
        return 0;
    return sumField(rows, key) / rows.length;
};
const formatRate = (value) => `${Math.round(value * 100)}%`;
const filterByCutoff = (rows, days) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(days - 1, 0));
    const cutoffKey = toDateKey(cutoff);
    return rows.filter(row => `${row.date ?? ''}` >= cutoffKey);
};
const normalizeChannel = (value) => {
    if (!value)
        return null;
    const lower = value.toLowerCase().trim();
    return SupportedChannels.includes(lower) ? lower : null;
};
export class AssistantStrategyService {
    constructor() {
        this.analyticsService = new AnalyticsService();
        this.socialAnalytics = new SocialAnalyticsService();
    }
    parsePeriodDays(question) {
        const normalized = question.toLowerCase();
        const match = normalized.match(/(\d+)\s*(day|days|week|weeks|month|months)/);
        if (match) {
            const value = Number(match[1]);
            const unit = match[2];
            if (unit.startsWith('week'))
                return clamp(value * 7, 7, 180);
            if (unit.startsWith('month'))
                return clamp(value * 30, 30, 365);
            return clamp(value, 7, 180);
        }
        if (normalized.includes('quarter'))
            return 90;
        if (normalized.includes('monthly') || normalized.includes('month'))
            return 30;
        if (normalized.includes('weekly') || normalized.includes('week'))
            return 7;
        return DEFAULT_PLAN_DAYS;
    }
    parseChannels(question, connectedChannels) {
        const normalized = question.toLowerCase();
        const mentioned = new Set();
        CHANNEL_ALIASES.forEach(({ channel, aliases }) => {
            aliases.forEach(alias => {
                if (normalized.includes(alias)) {
                    mentioned.add(channel);
                }
            });
        });
        if (mentioned.size > 0) {
            return Array.from(mentioned);
        }
        const normalizedConnected = (connectedChannels ?? [])
            .map(item => normalizeChannel(item))
            .filter(Boolean);
        if (normalizedConnected.length)
            return normalizedConnected;
        return ['instagram', 'facebook', 'linkedin'];
    }
    buildComplianceChecklist() {
        return [
            'Honor platform terms, rate limits, and daily caps.',
            'Include opt-out language for outbound outreach (CAN-SPAM, CASL).',
            'Respect privacy and data rules (GDPR, CCPA/CPRA) and avoid sensitive targeting.',
            'Avoid misleading claims, prohibited content, or engagement bait.',
            'Respect quiet hours and consent rules for WhatsApp/SMS by region.',
        ];
    }
    buildAutoReplyPrompt(focus) {
        return [
            'Reply in 1-2 sentences, friendly, confident, and helpful.',
            'Include a clear CTA to book a demo or learn more about the offer.',
            'Keep claims factual and avoid guarantees.',
            'If they ask to stop, acknowledge and confirm opt-out immediately.',
            `Focus: ${focus}.`,
        ].join(' ');
    }
    buildAutoPostPrompt(company, focus, channels) {
        const channelLine = channels.length ? `Channels: ${channels.join(', ')}.` : '';
        return [
            `Create social content for ${company ?? 'the brand'} focused on ${focus}.`,
            'Highlight real outcomes, client wins, and clear next steps.',
            'Use concise hooks, a single CTA, and value-first messaging.',
            channelLine,
        ]
            .filter(Boolean)
            .join(' ');
    }
    resolvePostsPerWeek(metrics) {
        if (metrics.social.posted < 3)
            return 4;
        if (metrics.social.posted >= 5)
            return 5;
        return 4;
    }
    resolveOutreachCap(metrics) {
        const replyRate = metrics.outbound.replyRate;
        if (replyRate <= 0.06)
            return 10;
        if (replyRate <= 0.12)
            return 16;
        return 22;
    }
    determineFocus(metrics) {
        const focusAreas = [];
        if (metrics.social.posted < 3)
            focusAreas.push('Consistency and awareness');
        if (metrics.outbound.replyRate < 0.1)
            focusAreas.push('Outbound personalization');
        if (metrics.engagement.conversionRate < 0.05)
            focusAreas.push('Engagement to lead capture');
        if (metrics.inbound.conversionRate < 0.05)
            focusAreas.push('Inbound qualification');
        if (!focusAreas.length)
            focusAreas.push('Scale top-performing channels');
        return focusAreas.slice(0, 2).join(' + ');
    }
    async fetchDailyRows(collectionName, userId, limit) {
        if (process.env.ALLOW_MOCK_AUTH === 'true') {
            return [];
        }
        const scopeKey = resolveAnalyticsScopeKey({ userId });
        const collectionRef = firestore.collection('analytics').doc(scopeKey).collection(collectionName);
        try {
            const snap = await collectionRef.orderBy('date', 'desc').limit(limit).get();
            return snap.docs.map(doc => doc.data());
        }
        catch (error) {
            console.warn(`Failed to load ${collectionName}`, error.message);
            return [];
        }
    }
    async buildPeriodMetrics(userId, days) {
        const allowMock = process.env.ALLOW_MOCK_AUTH === 'true';
        const [summary, socialRows, inboundRows, outboundRows, engagementRows, followupRows] = await Promise.all([
            this.analyticsService.getSummary(userId),
            allowMock
                ? Promise.resolve([])
                : this.socialAnalytics.getDailySummary(userId, Math.max(days * 2, 14)).catch(error => {
                    console.warn('Failed to load social analytics', error.message);
                    return [];
                }),
            this.fetchDailyRows('inboundDaily', userId, Math.max(days * 2, 14)),
            this.fetchDailyRows('outboundDaily', userId, Math.max(days * 2, 14)),
            this.fetchDailyRows('engagementDaily', userId, Math.max(days * 2, 14)),
            this.fetchDailyRows('followupsDaily', userId, Math.max(days * 2, 14)),
        ]);
        const history = Array.isArray(summary.history) ? summary.history : [];
        const historySorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
        const historyWindow = filterByCutoff(historySorted, days);
        const crmLeads = historyWindow.length ? sumField(historyWindow, 'leads') : summary.leads ?? 0;
        const crmConversions = historyWindow.length ? sumField(historyWindow, 'conversions') : summary.conversions ?? 0;
        const crmEngagementAvg = historyWindow.length
            ? Number(averageField(historyWindow, 'engagement').toFixed(1))
            : summary.engagement ?? 0;
        const crmFeedbackAvg = historyWindow.length
            ? Number(averageField(historyWindow, 'feedbackScore').toFixed(1))
            : summary.feedbackScore ?? 0;
        const socialWindow = filterByCutoff(socialRows, days);
        const socialAttempted = sumField(socialWindow, 'postsAttempted');
        const socialPosted = sumField(socialWindow, 'postsPosted');
        const socialFailed = sumField(socialWindow, 'postsFailed');
        const socialSkipped = sumField(socialWindow, 'postsSkipped');
        const inboundWindow = filterByCutoff(inboundRows, days);
        const inboundMessages = sumField(inboundWindow, 'messages');
        const inboundLeads = sumField(inboundWindow, 'leads');
        const inboundSentimentTotal = sumField(inboundWindow, 'sentimentTotal');
        const inboundSentimentSamples = sumField(inboundWindow, 'sentimentSamples');
        const inboundAvgSentiment = inboundSentimentSamples
            ? Number((inboundSentimentTotal / inboundSentimentSamples).toFixed(2))
            : 0;
        const outboundWindow = filterByCutoff(outboundRows, days);
        const outboundProspects = sumField(outboundWindow, 'prospectsFound');
        const outboundMessages = sumField(outboundWindow, 'messagesSent');
        const outboundReplies = sumField(outboundWindow, 'replies');
        const outboundPositive = sumField(outboundWindow, 'positiveReplies');
        const outboundConversions = sumField(outboundWindow, 'conversions');
        const outboundDemos = sumField(outboundWindow, 'demosBooked');
        const outboundTopIndustry = outboundWindow.find(row => row.topIndustry)?.topIndustry;
        const engagementWindow = filterByCutoff(engagementRows, days);
        const engagementComments = sumField(engagementWindow, 'commentsDetected');
        const engagementReplies = sumField(engagementWindow, 'repliesSent');
        const engagementConversions = sumField(engagementWindow, 'conversions');
        const followupWindow = filterByCutoff(followupRows, days);
        const followupSent = sumField(followupWindow, 'sent');
        const followupReplies = sumField(followupWindow, 'replies');
        const followupConversions = sumField(followupWindow, 'conversions');
        return {
            crm: {
                leads: Math.round(crmLeads),
                engagementAvg: crmEngagementAvg,
                conversions: Math.round(crmConversions),
                feedbackScoreAvg: crmFeedbackAvg,
            },
            social: {
                attempted: Math.round(socialAttempted),
                posted: Math.round(socialPosted),
                failed: Math.round(socialFailed),
                skipped: Math.round(socialSkipped),
            },
            inbound: {
                messages: Math.round(inboundMessages),
                leads: Math.round(inboundLeads),
                avgSentiment: inboundAvgSentiment,
                conversionRate: inboundMessages ? Number((inboundLeads / inboundMessages).toFixed(2)) : 0,
            },
            engagement: {
                comments: Math.round(engagementComments),
                replies: Math.round(engagementReplies),
                conversions: Math.round(engagementConversions),
                conversionRate: engagementComments ? Number((engagementConversions / engagementComments).toFixed(2)) : 0,
            },
            followups: {
                sent: Math.round(followupSent),
                replies: Math.round(followupReplies),
                conversions: Math.round(followupConversions),
                replyRate: followupSent ? Number((followupReplies / followupSent).toFixed(2)) : 0,
                conversionRate: followupSent ? Number((followupConversions / followupSent).toFixed(2)) : 0,
            },
            outbound: {
                prospectsFound: Math.round(outboundProspects),
                messagesSent: Math.round(outboundMessages),
                replies: Math.round(outboundReplies),
                positiveReplies: Math.round(outboundPositive),
                conversions: Math.round(outboundConversions),
                demosBooked: Math.round(outboundDemos),
                replyRate: outboundMessages ? Number((outboundReplies / outboundMessages).toFixed(2)) : 0,
                conversionRate: outboundMessages ? Number((outboundConversions / outboundMessages).toFixed(2)) : 0,
                topIndustry: outboundTopIndustry,
            },
        };
    }
    buildStrategyActions(metrics, channels, company) {
        const focus = this.determineFocus(metrics);
        const postsPerWeek = this.resolvePostsPerWeek(metrics);
        const intervalHours = Math.max(Math.round(168 / postsPerWeek), 12);
        const reelsIntervalHours = Math.max(intervalHours, 24);
        const businessType = company ? `${company} marketing` : 'Marketing';
        const autoPostPlatforms = channels.filter(channel => ['instagram', 'instagram_reels', 'facebook', 'linkedin', 'threads', 'x', 'twitter', 'tiktok', 'youtube'].includes(channel));
        const autoPostPrompt = this.buildAutoPostPrompt(company, focus, autoPostPlatforms);
        const outboundChannels = channels.filter(channel => ['linkedin', 'instagram', 'whatsapp'].includes(channel));
        const compliance = this.buildComplianceChecklist();
        const outreachCap = this.resolveOutreachCap(metrics);
        const complianceFooter = 'Reply STOP to opt out. We follow CAN-SPAM, CASL, GDPR, and platform terms.';
        const actions = {
            autoPost: {
                platforms: autoPostPlatforms,
                prompt: autoPostPrompt,
                businessType,
                intervalHours,
                reelsIntervalHours,
                postsPerWeek,
            },
            autoReply: {
                prompt: this.buildAutoReplyPrompt(focus),
            },
            outreach: outboundChannels.length
                ? {
                    channels: outboundChannels,
                    dailyCap: outreachCap,
                    complianceFooter,
                    focusNote: focus,
                }
                : undefined,
            scheduleKickoff: {
                enabled: true,
                platforms: channels.filter(channel => ['instagram', 'facebook', 'linkedin', 'threads', 'x', 'twitter'].includes(channel)),
            },
        };
        return { focus, actions, compliance };
    }
    formatStrategyMessage(plan) {
        const metrics = plan.metrics;
        const social = `Social: ${metrics.social.posted} posted, ${metrics.social.failed} failed.`;
        const outbound = `Outreach: ${metrics.outbound.messagesSent} sent, ${metrics.outbound.replies} replies, ${metrics.outbound.conversions} conversions.`;
        const inbound = `Auto-replies: ${metrics.inbound.messages} inbound, ${metrics.inbound.leads} leads (CR ${formatRate(metrics.inbound.conversionRate)}).`;
        const focusLine = `Primary focus: ${plan.focus}.`;
        const channelsLine = `Channels: ${plan.channels.join(', ')}.`;
        const cadenceLine = plan.actions.autoPost
            ? `Auto-post cadence: ${plan.actions.autoPost.postsPerWeek} posts/week (about every ${plan.actions.autoPost.intervalHours}h).`
            : 'Auto-post cadence: not configured.';
        const outreachLine = plan.actions.outreach
            ? `Outreach cadence: up to ${plan.actions.outreach.dailyCap}/day per channel with personalization.`
            : 'Outreach cadence: no outbound channels connected.';
        const complianceLine = `Compliance: ${plan.compliance.join(' ')}`;
        return [
            `Marketing strategy (${plan.periodDays} days) ready.`,
            focusLine,
            channelsLine,
            `Weekly snapshot: ${social} ${outbound} ${inbound}`,
            cadenceLine,
            outreachLine,
            'Auto-replies: add clearer CTA + opt-out handling and compliance guardrails.',
            complianceLine,
            `Implementation includes: schedule posts, update auto-reply prompts, and run outreach sequences.`,
            `Strategy ID: ${plan.displayId}. Reply "approve ${plan.displayId}" to implement, or tell me which channels to change.`,
            'You can also say "email monthly report" anytime to get a full performance recap.',
        ].join('\n');
    }
    formatMonthlyReport(metrics, company) {
        const header = `Monthly performance report${company ? ` for ${company}` : ''}`;
        const crmLine = `CRM: ${metrics.crm.leads} leads, ${metrics.crm.conversions} conversions, engagement avg ${metrics.crm.engagementAvg}%.`;
        const socialLine = `Social: ${metrics.social.posted} posts, ${metrics.social.failed} failures, ${metrics.social.skipped} skipped.`;
        const outboundLine = `Outreach: ${metrics.outbound.messagesSent} sent, ${metrics.outbound.replies} replies, ${metrics.outbound.conversions} conversions (CR ${formatRate(metrics.outbound.conversionRate)}).`;
        const inboundLine = `Auto-replies: ${metrics.inbound.messages} inbound, ${metrics.inbound.leads} leads (CR ${formatRate(metrics.inbound.conversionRate)}).`;
        const engagementLine = `Engagement: ${metrics.engagement.comments} comments, ${metrics.engagement.replies} replies, ${metrics.engagement.conversions} conversions (CR ${formatRate(metrics.engagement.conversionRate)}).`;
        const followupLine = `Follow-ups: ${metrics.followups.sent} sent, ${metrics.followups.replies} replies, ${metrics.followups.conversions} conversions.`;
        return [
            header,
            '',
            crmLine,
            socialLine,
            outboundLine,
            inboundLine,
            engagementLine,
            followupLine,
            '',
            'Next month focus:',
            '- Keep weekly strategy reviews and adjust cadence based on reply rates.',
            '- Refresh top-performing content themes and rotate CTAs.',
            '- Tighten outreach targeting and ensure opt-out compliance.',
        ].join('\n');
    }
    async resolveReportRecipient(userId, fallbackEmail) {
        try {
            const profileSnap = await firestore.collection('profiles').doc(userId).get();
            const crmEmail = profileSnap.data()?.crmData?.email;
            if (crmEmail && crmEmail.trim()) {
                return crmEmail.trim();
            }
        }
        catch (error) {
            console.warn('Failed to load profile email', error.message);
        }
        try {
            const userSnap = await firestore.collection('users').doc(userId).get();
            const userEmail = userSnap.data()?.email;
            if (userEmail && userEmail.trim()) {
                return userEmail.trim();
            }
        }
        catch (error) {
            console.warn('Failed to load user email', error.message);
        }
        return fallbackEmail?.trim() || null;
    }
    async draftStrategy(input) {
        const analysisDays = DEFAULT_ANALYSIS_DAYS;
        const periodDays = this.parsePeriodDays(input.question);
        const channels = this.parseChannels(input.question, input.connectedChannels);
        const metrics = await this.buildPeriodMetrics(input.userId, analysisDays);
        const { focus, actions, compliance } = this.buildStrategyActions(metrics, channels, input.company);
        const docRef = strategiesCollection.doc();
        const displayId = `STRAT-${docRef.id.slice(-6).toUpperCase()}`;
        const plan = {
            id: docRef.id,
            displayId,
            userId: input.userId,
            periodDays,
            analysisDays,
            channels,
            focus,
            metrics,
            actions,
            compliance,
            status: 'draft',
            createdAt: admin.firestore.Timestamp.now(),
        };
        await docRef.set({
            ...plan,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
            plan,
            message: this.formatStrategyMessage(plan),
        };
    }
    async findStrategyByDisplayId(userId, displayId) {
        const snap = await strategiesCollection
            .where('userId', '==', userId)
            .where('displayId', '==', displayId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (snap.empty)
            return null;
        return snap.docs[0];
    }
    async findLatestDraft(userId) {
        const snap = await strategiesCollection
            .where('userId', '==', userId)
            .where('status', '==', 'draft')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (snap.empty)
            return null;
        return snap.docs[0];
    }
    async applyStrategy(userId, displayId) {
        const doc = displayId ? await this.findStrategyByDisplayId(userId, displayId) : await this.findLatestDraft(userId);
        if (!doc) {
            return { message: 'No pending strategy found. Ask me to draft one first.' };
        }
        const plan = doc.data();
        const appliedActions = [];
        const skippedActions = [];
        if (plan.actions.autoPost && plan.actions.autoPost.platforms.length) {
            await autoPostService.start({
                userId,
                platforms: plan.actions.autoPost.platforms,
                prompt: plan.actions.autoPost.prompt,
                businessType: plan.actions.autoPost.businessType,
                reelsIntervalHours: plan.actions.autoPost.reelsIntervalHours,
            });
            await firestore.collection('autopostJobs').doc(userId).set({
                intervalHours: plan.actions.autoPost.intervalHours,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            appliedActions.push('Auto-post cadence updated');
        }
        else {
            skippedActions.push('Auto-post skipped (no social channels selected)');
        }
        if (plan.actions.autoReply?.prompt) {
            await settingsCollection.doc(userId).set({
                autoReplyPrompt: plan.actions.autoReply.prompt,
                outreachComplianceFooter: plan.actions.outreach?.complianceFooter ?? null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            appliedActions.push('Auto-reply prompt updated');
        }
        if (plan.actions.scheduleKickoff?.enabled && plan.actions.scheduleKickoff.platforms.length) {
            try {
                const generated = await contentGenerationService.generateContent({
                    prompt: plan.actions.autoPost?.prompt ?? 'High-performing social post for lead generation',
                    businessType: plan.actions.autoPost?.businessType ?? 'Marketing',
                    imageCount: 1,
                });
                if (generated.images.length) {
                    const scheduleDate = new Date();
                    scheduleDate.setDate(scheduleDate.getDate() + 1);
                    scheduleDate.setHours(10, 0, 0, 0);
                    const platforms = plan.actions.scheduleKickoff.platforms;
                    const caption = generated.caption_instagram || generated.caption_linkedin || generated.caption_x || 'New update';
                    const hashtags = generated.hashtags_instagram || generated.hashtags_generic || '';
                    await socialSchedulingService.schedulePosts({
                        userId,
                        platforms: platforms.filter(platform => ['instagram', 'facebook', 'linkedin', 'threads', 'x', 'twitter'].includes(platform)),
                        images: generated.images,
                        caption,
                        hashtags,
                        scheduledFor: scheduleDate.toISOString(),
                        timesPerDay: 1,
                    });
                    appliedActions.push('Kickoff post scheduled');
                }
                else {
                    skippedActions.push('Kickoff post skipped (no images generated)');
                }
            }
            catch (error) {
                skippedActions.push(`Kickoff post skipped (${error.message})`);
            }
        }
        if (plan.actions.outreach?.channels?.length) {
            try {
                if (process.env.DISABLE_OUTBOUND_AUTOMATION === 'true') {
                    skippedActions.push('Outreach skipped (disabled by configuration)');
                }
                else {
                    await outreachAgent.runDailyOutreach([], { userId });
                    appliedActions.push('Outreach sequence triggered');
                }
            }
            catch (error) {
                skippedActions.push(`Outreach skipped (${error.message})`);
            }
        }
        else {
            skippedActions.push('Outreach skipped (no outbound channels connected)');
        }
        await doc.ref.set({
            status: 'applied',
            appliedAt: admin.firestore.FieldValue.serverTimestamp(),
            appliedActions,
            skippedActions,
        }, { merge: true });
        const appliedLine = appliedActions.length ? `Applied: ${appliedActions.join(', ')}.` : '';
        const skippedLine = skippedActions.length ? `Skipped: ${skippedActions.join(', ')}.` : '';
        return {
            message: ['Strategy applied.', appliedLine, skippedLine].filter(Boolean).join(' '),
        };
    }
    async sendMonthlyReport(input) {
        const recipient = await this.resolveReportRecipient(input.userId, input.email ?? null);
        if (!recipient) {
            return { message: 'I do not have an email address for this account yet.' };
        }
        const metrics = await this.buildPeriodMetrics(input.userId, 30);
        const reportText = this.formatMonthlyReport(metrics, input.company);
        await sendMonthlyPerformanceReportEmail(recipient, input.company ?? 'your team', reportText);
        return { message: `Monthly performance report emailed to ${recipient}.` };
    }
}

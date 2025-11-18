const today = new Date();
const buildDate = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
};
const platformMix = ['whatsapp', 'instagram', 'facebook', 'threads', 'linkedin', 'web'];
const platformStatsTemplate = (messages, leads) => ({
    messages,
    leads,
    responseTimeTotalMs: messages * 1100,
    responseSamples: messages,
    sentimentTotal: messages * 4.2,
    sentimentSamples: messages,
    conversionCount: leads,
});
export const sampleStats = Array.from({ length: 7 }).map((_, index) => {
    const base = 60 + index * 4;
    const leads = 10 + (index % 4);
    const activeUsers = 25 + index * 3;
    const date = buildDate(6 - index);
    const platformBreakdown = platformMix.reduce((acc, platform, idx) => {
        const platformMessages = Math.round(base * (0.15 + idx * 0.1));
        const platformLeads = Math.max(1, Math.round(leads * (0.2 + idx * 0.1)));
        acc[platform] = platformStatsTemplate(platformMessages, platformLeads);
        return acc;
    }, {});
    return {
        date,
        totalMessagesToday: base,
        newLeadsToday: leads,
        mostCommonCategory: (['Lead Inquiry', 'Demo Booking', 'Support'][index % 3] ?? 'General Chat'),
        avgResponseTime: 38 + index * 1.8,
        conversionRate: Number((leads / base).toFixed(2)),
        activeUsers,
        platformBreakdown,
        categoryCounts: {
            'Lead Inquiry': base * 0.42,
            Support: base * 0.22,
            'Demo Booking': base * 0.24,
            'General Chat': base * 0.12,
        },
        responseTypeCounts: {
            Pricing: base * 0.32,
            Onboarding: base * 0.18,
            Demo: base * 0.28,
            Support: base * 0.14,
            General: base * 0.08,
        },
    };
});
export const sampleConversations = [
    {
        conversationId: 'sample-convo-1',
        user_id: '2348012345678',
        channel_user_id: '2348012345678',
        platform: 'whatsapp',
        sentiment_score: 4.6,
        intent_category: 'Lead Inquiry',
        response_type: 'Pricing',
        created_at: buildDate(1),
        updated_at: buildDate(1),
        meta: {
            name: 'Adaobi',
            company: 'GrowthLabs',
            email: 'adaobi@growthlabs.io',
            interestCategory: 'AI CRM',
            isLead: true,
            leadScore: 88,
            leadTier: 'hot',
        },
        messages: [
            {
                role: 'user',
                content: 'Hi, I need pricing for your AI CRM for GrowthLabs. Email me at adaobi@growthlabs.io',
                timestamp: buildDate(1),
            },
            {
                role: 'assistant',
                content: 'Hi Adaobi! Our AI CRM plans start at $499/mo and include lead capture automations. Want me to pencil a demo?',
                timestamp: buildDate(1),
            },
        ],
    },
    {
        conversationId: 'sample-convo-2',
        user_id: '447700900123',
        channel_user_id: '447700900123',
        platform: 'linkedin',
        sentiment_score: 3.8,
        intent_category: 'Demo Booking',
        response_type: 'Demo',
        created_at: buildDate(2),
        updated_at: buildDate(2),
        meta: {
            name: 'Marcus',
            company: 'Brightline Media',
            email: 'marcus@brightline.agency',
            interestCategory: 'Lead Generation',
            isLead: true,
            leadScore: 72,
            leadTier: 'warm',
        },
        messages: [
            {
                role: 'user',
                content: 'Can we book a demo this week to see how your chatbot handles cold leads?',
                timestamp: buildDate(2),
            },
            {
                role: 'assistant',
                content: 'Absolutely! I can hold a 20-min demo slot for you. Are you free Thursday at 10am GMT?',
                timestamp: buildDate(2),
            },
        ],
    },
];

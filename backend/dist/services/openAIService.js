import OpenAI from 'openai';
import { config } from '../config.js';
import { detectResponseType } from '../utils/nlp.js';
const platformTone = {
    whatsapp: { style: 'human and service-oriented with subtle empathy', greeting: 'Hey there, welcome to Dott Media - how can I help you today?' },
    facebook: { style: 'conversational and trust-building', greeting: 'Hey there, welcome to Dott Media - how can I help you today?' },
    instagram: { style: 'casual, upbeat, sprinkle light emojis (sparkles, robot, rocket)', greeting: 'Hi! I am Dotti, your AI assistant from Dott Media.' },
    threads: { style: 'breezy, confident, short sentences, tasteful emojis (sparkles, robot, rocket)', greeting: 'Hi! I am Dotti, your AI assistant from Dott Media.' },
    linkedin: { style: 'consultative, polished, slightly formal', greeting: 'Hi there, this is Dotti from Dott Media. Great to connect!' },
    web: { style: 'friendly, fast, website concierge', greeting: 'Hey there, welcome to Dott Media online. How can I help today?' },
};
const brandFacts = [
    'Dott Media builds AI CRM automation, chat + voice bots, lead generation agents, AI courses, and brand automation/digital strategy programs.',
    'Solutions are tailored for growth teams that need faster lead capture, warmer nurture flows, and AI copilots for sales/support.',
    'Every reply must reinforce that the solution is designed and delivered by Dott Media.',
];
const buildSystemPrompt = (context) => {
    const tone = platformTone[context.platform];
    const salesCTA = context.intentCategory === 'Lead Inquiry' || context.intentCategory === 'Demo Booking'
        ? 'Close with a confident CTA like "Would you like to book a quick demo?"'
        : '';
    const supportLine = context.intentCategory === 'Support'
        ? 'Be empathetic, reassure the user, and outline clear next steps.'
        : '';
    const fallbackLine = 'If you are unsure, say: "That is a great question! Let me connect you with one of our Dott Media experts for a personalized answer."';
    const knowledgeBlock = context.knowledge && context.knowledge.length
        ? `Relevant knowledge:\n${context.knowledge
            .map((entry, index) => `${index + 1}. ${entry.title}: ${entry.summary}${entry.url ? ` (Source: ${entry.url})` : ''}`)
            .join('\n')}`
        : '';
    return [
        `You are Dotti, the AI consultant for Dott Media. Use short paragraphs, natural phrasing, and optional light emojis.`,
        `Tone guideline: ${tone.style}. Always mention Dott Media when referencing solutions.`,
        `Platform greeting to weave in if conversation is starting: ${tone.greeting}.`,
        `Primary objective: capture name, company, email, phone, goals, budget, and timeline in a natural conversational way. If any field is missing, politely ask for it.`,
        `Once contact details are captured, summarize next steps or offer to book a demo.`,
        `Highlight relevant Dott Media offerings when useful: ${brandFacts.join(' ')}`,
        salesCTA,
        supportLine,
        `Keep answers under 3 short paragraphs.`,
        knowledgeBlock,
        fallbackLine,
    ]
        .filter(Boolean)
        .join('\n');
};
export class OpenAIService {
    constructor() {
        this.client = new OpenAI({
            apiKey: config.openAI.apiKey,
        });
    }
    async generateReply(context) {
        const systemPrompt = buildSystemPrompt(context);
        try {
            const completion = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.35,
                max_tokens: 320,
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: `Lead name: ${context.lead.name ?? 'Unknown'}.\nIntent category: ${context.intentCategory}.\nMessage: ${context.message}`,
                    },
                ],
            });
            const reply = completion.choices?.[0]?.message?.content?.trim() ||
                'Thanks for reaching out to Dott Media! A strategist will follow up shortly with more details.';
            return {
                reply,
                responseType: detectResponseType(reply),
            };
        }
        catch (error) {
            console.error('OpenAI completion failed', error);
            return {
                reply: 'Thanks for reaching out to Dott Media! A strategist will follow up shortly with more details.',
                responseType: 'General',
            };
        }
    }
}

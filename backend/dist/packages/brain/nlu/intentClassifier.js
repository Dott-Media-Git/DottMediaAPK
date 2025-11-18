import OpenAI from 'openai';
import { config } from '../../../config';
const DEFAULT_CLASSIFICATION = {
    intent: 'GENERAL',
    sentiment: 0,
    confidence: 0.4,
    keywords: [],
};
const openai = new OpenAI({ apiKey: config.openAI.apiKey });
/**
 * Lightweight intent detector shared by inbound + engagement funnels.
 */
export async function classifyIntentText(text) {
    if (!text?.trim())
        return DEFAULT_CLASSIFICATION;
    const prompt = `
You are an enterprise intent classifier.
Return JSON only: {"intent":"LEAD_INQUIRY|GENERAL|SUPPORT|BOOK_DEMO|REFERRAL|FOLLOW_UP","sentiment":-1..1,"confidence":0..1,"keywords":["..."]}.
Text: """${text.trim()}"""
`.trim();
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: 'You classify inbound go-to-market messages for Dott Media.' },
                { role: 'user', content: prompt },
            ],
        });
        const content = completion.choices?.[0]?.message?.content;
        if (!content)
            return DEFAULT_CLASSIFICATION;
        const parsed = JSON.parse(content);
        return {
            intent: normalizeIntent(parsed.intent),
            sentiment: clamp(parsed.sentiment, -1, 1),
            confidence: clamp(parsed.confidence, 0, 1),
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 8) : [],
        };
    }
    catch (error) {
        console.error('Intent classification failed', error);
        return DEFAULT_CLASSIFICATION;
    }
}
function clamp(value, min, max) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return min;
    return Math.max(min, Math.min(max, value));
}
function normalizeIntent(intent) {
    const upper = intent?.toUpperCase() ?? '';
    if (upper.includes('DEMO'))
        return 'BOOK_DEMO';
    if (upper.includes('LEAD') || upper.includes('INQUIRY'))
        return 'LEAD_INQUIRY';
    if (upper.includes('SUPPORT') || upper.includes('HELP'))
        return 'SUPPORT';
    if (upper.includes('REFERR'))
        return 'REFERRAL';
    if (upper.includes('FOLLOW'))
        return 'FOLLOW_UP';
    return 'GENERAL';
}

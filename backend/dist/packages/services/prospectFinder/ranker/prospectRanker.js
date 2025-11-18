import OpenAI from 'openai';
import { config } from '../../../../config';
let cachedClient = null;
const titleSignals = ['manager', 'director', 'founder', 'chief', 'lead'];
/**
 * Applies rule-based scoring with optional semantic re-ranking via GPT.
 */
export async function scoreProspects(prospects, context = {}) {
    const baseline = prospects.map(prospect => ({
        ...prospect,
        score: scoreProspect(prospect, context),
    }));
    if (!shouldUseSemanticRanking(baseline)) {
        return baseline;
    }
    try {
        const adjustments = await semanticAdjustments(baseline, context);
        return baseline.map(prospect => ({
            ...prospect,
            score: clampScore(adjustments.get(prospect.id) ?? prospect.score),
        }));
    }
    catch (error) {
        console.warn('Semantic ranking failed, keeping baseline order', error);
        return baseline;
    }
}
/**
 * Deterministic scoring heuristic.
 */
export function scoreProspect(prospect, context = {}) {
    let score = 40;
    if (prospect.industry && context.targetIndustry && prospect.industry.toLowerCase() === context.targetIndustry.toLowerCase()) {
        score += 30;
    }
    if (prospect.location && context.targetCountry && prospect.location.toLowerCase().includes(context.targetCountry.toLowerCase())) {
        score += 20;
    }
    if (prospect.company && prospect.companyDomain && prospect.companySize && prospect.companySummary) {
        score += 10;
    }
    if (prospect.position && titleSignals.some(signal => prospect.position?.toLowerCase().includes(signal))) {
        score += 10;
    }
    return clampScore(score);
}
function clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
}
function shouldUseSemanticRanking(prospects) {
    return process.env.ENABLE_OUTBOUND_SEMANTIC_RANKING !== 'false' && prospects.length >= 5;
}
async function semanticAdjustments(prospects, context) {
    const client = getClient();
    if (!client)
        return new Map();
    const candidates = prospects.slice(0, 10);
    const payload = candidates
        .map(prospect => `ID: ${prospect.id}\nName: ${prospect.name}\nCompany: ${prospect.company ?? 'n/a'}\nTitle: ${prospect.position ?? 'n/a'}\nIndustry: ${prospect.industry ?? 'n/a'}\nLocation: ${prospect.location ?? 'n/a'}\nScore: ${prospect.score}`)
        .join('\n---\n');
    const target = `Ideal: industry=${context.targetIndustry ?? 'any'}, country=${context.targetCountry ?? 'any'}, automation fit + budget.`;
    const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: 'You are ranking B2B prospects for AI sales outreach. Return JSON { "scores": [{ "id": "prospectId", "score": 0-100 }] }. Only include provided IDs.',
            },
            {
                role: 'user',
                content: `Context: ${target}\nProspects:\n${payload}`,
            },
        ],
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content)
        return new Map();
    try {
        const parsed = JSON.parse(content);
        const map = new Map();
        parsed.scores?.forEach(entry => map.set(entry.id, clampScore(entry.score)));
        return map;
    }
    catch (error) {
        console.warn('Failed to parse semantic ranking response', error, content);
        return new Map();
    }
}
function getClient() {
    if (!config.openAI.apiKey)
        return null;
    if (cachedClient)
        return cachedClient;
    cachedClient = new OpenAI({ apiKey: config.openAI.apiKey });
    return cachedClient;
}

import OpenAI from 'openai';
import { config } from '../../../config';

export interface ReplyClassification {
  sentiment: number; // -1 to +1
  intent: 'INTERESTED' | 'CURIOUS' | 'BUSY' | 'NO_INTEREST' | 'BOOK_DEMO' | 'SUPPORT';
  confidence: number; // 0-1
  raw?: string;
}

const DEFAULT_CLASSIFICATION: ReplyClassification = {
  sentiment: 0,
  intent: 'CURIOUS',
  confidence: 0.4,
};

const client = new OpenAI({
  apiKey: config.openAI.apiKey,
});

/**
 * Uses GPT-based reasoning to classify inbound replies for sentiment + intent.
 * TODO: swap to structured output API once GPT-5 endpoints are available.
 */
export async function classifyReply(text: string): Promise<ReplyClassification> {
  if (!text?.trim()) {
    return DEFAULT_CLASSIFICATION;
  }

  const prompt = `
Classify the following business reply.
Respond ONLY in JSON: {"sentiment": number between -1 and 1, "intent": string, "confidence": number between 0 and 1}.
Allowed intents: INTERESTED, CURIOUS, BUSY, NO_INTEREST, BOOK_DEMO, SUPPORT.
Text: """${text.trim()}"""
`.trim();

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a precise sales assistant helping to triage outbound replies.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return DEFAULT_CLASSIFICATION;
    const parsed = JSON.parse(content) as ReplyClassification;
    return {
      ...DEFAULT_CLASSIFICATION,
      ...parsed,
      sentiment: clamp(parsed.sentiment, -1, 1),
      confidence: clamp(parsed.confidence, 0, 1),
      intent: normalizeIntent(parsed.intent),
      raw: content,
    };
  } catch (error) {
    console.error('Reply classification failed', error);
    return DEFAULT_CLASSIFICATION;
  }
}

function clamp(value: number | undefined, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeIntent(intent: string | undefined): ReplyClassification['intent'] {
  const upper = intent?.toUpperCase() ?? '';
  if (upper === 'INTERESTED') return 'INTERESTED';
  if (upper === 'CURIOUS') return 'CURIOUS';
  if (upper === 'BUSY') return 'BUSY';
  if (upper === 'NO_INTEREST') return 'NO_INTEREST';
  if (upper === 'BOOK_DEMO') return 'BOOK_DEMO';
  if (upper === 'SUPPORT') return 'SUPPORT';
  if (upper.includes('DEMO')) return 'BOOK_DEMO';
  if (upper.includes('NO') || upper.includes('NOT INTEREST')) return 'NO_INTEREST';
  if (upper.includes('BUSY') || upper.includes('LATER')) return 'BUSY';
  return 'CURIOUS';
}

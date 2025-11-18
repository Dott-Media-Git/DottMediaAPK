import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openAI.apiKey });

type AssistantContext = {
  company?: string;
  currentScreen?: string;
  analytics?: {
    leads?: number;
    engagement?: number;
    conversions?: number;
    feedbackScore?: number;
  };
};

export class AssistantService {
  async answer(question: string, context: AssistantContext) {
    const prompt = [
      'You are Dott, an AI assistant inside the Dott Media CRM mobile app.',
      'Help the user navigate the app, summarize their performance metrics, and provide actionable suggestions.',
      'Keep answers under 120 words, use friendly but professional tone, and reference available metrics if useful.',
      context.company ? `Company: ${context.company}` : '',
      context.currentScreen ? `User is viewing: ${context.currentScreen}` : '',
      context.analytics
        ? `Metrics: leads=${context.analytics.leads ?? 'n/a'}, engagement=${context.analytics.engagement ?? 'n/a'}, conversions=${context.analytics.conversions ?? 'n/a'}, feedback=${context.analytics.feedbackScore ?? 'n/a'}`
        : '',
      `Question: ${question}`,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: prompt,
      max_output_tokens: 350,
    });
    const text = response.output_text?.[0]?.trim();
    return text && text.length > 0 ? text : 'I could not generate a helpful response right now. Please try again in a moment.';
  }
}

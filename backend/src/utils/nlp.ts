import {
  IntentCategories,
  IntentCategory,
  InterestCategories,
  InterestCategory,
  LeadProfile,
  ResponseType,
  ResponseTypes,
} from '../types/bot';

const normalize = (value?: string) => value?.toLowerCase() ?? '';

const intentKeywordMap: Record<IntentCategory, string[]> = {
  'Lead Inquiry': ['pricing', 'cost', 'plan', 'package', 'lead', 'crm'],
  Support: ['issue', 'help', 'support', 'bug', 'error'],
  'Demo Booking': ['demo', 'walkthrough', 'show', 'tour', 'presentation'],
  'General Chat': ['hello', 'hi', 'thanks', 'thank you', 'update'],
};

const interestKeywordMap: Record<InterestCategory, string[]> = {
  'AI CRM': ['crm', 'pipeline', 'sales', 'hubspot'],
  Chatbot: ['chatbot', 'bot', 'conversation', 'automation'],
  'Lead Generation': ['lead', 'prospect', 'acquisition', 'outreach'],
};

const responseKeywordMap: Record<ResponseType, string[]> = {
  Pricing: ['price', 'pricing', 'cost', 'plan'],
  Onboarding: ['onboard', 'setup', 'start', 'integrate'],
  Demo: ['demo', 'call', 'meeting', 'schedule'],
  Support: ['issue', 'bug', 'error', 'fix'],
  General: [],
};

export const classifyIntent = (message: string): IntentCategory => {
  const text = normalize(message);
  for (const intent of IntentCategories) {
    if (intentKeywordMap[intent].some(keyword => text.includes(keyword))) {
      return intent;
    }
  }
  return 'General Chat';
};

export const guessInterestCategory = (message: string): InterestCategory => {
  const text = normalize(message);
  for (const category of InterestCategories) {
    if (interestKeywordMap[category].some(keyword => text.includes(keyword))) {
      return category;
    }
  }
  return 'Lead Generation';
};

export const detectResponseType = (message: string): ResponseType => {
  const text = normalize(message);
  for (const responseType of ResponseTypes) {
    if (responseKeywordMap[responseType].some(keyword => text.includes(keyword))) {
      return responseType;
    }
  }
  return 'General';
};

export const scoreSentiment = (message: string): number => {
  const text = normalize(message);
  let score = 0.1;
  if (text.match(/\b(thank|great|love|awesome|perfect|excited|amazing)\b/)) score += 0.4;
  if (text.match(/\b(frustrated|angry|terrible|bad|upset|cancel|complain)\b/)) score -= 0.6;
  if (text.match(/\b(issue|problem|delay|slow|stuck)\b/)) score -= 0.3;
  return Math.min(1, Math.max(-1, Number(score.toFixed(2))));
};

export const extractLeadProfile = (message: string, fallbackName?: string): LeadProfile & { isLead: boolean } => {
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const companyMatch = message.match(/\b(?:at|from|with)\s+([A-Z][A-Za-z0-9& ]{2,})/);
  const interestCategory = guessInterestCategory(message);
  const nameMatch = message.match(/(?:name\s*is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  const phoneMatch = message.match(/(\+?\d[\d\s().-]{7,})/);
  const goalMatch = message.match(/(?:goal|need|looking\s+to|want(?:\s+to)?|trying\s+to)\s+([^.,]{5,120})/i);
  const budgetMatch = message.match(/(?:budget|cost|spend)\s*(?:is|around|about|~)?\s*((?:\$|usd|eur|gbp)?\s?\d{2,}(?:k|m)?)/i);

  const profile: LeadProfile & { isLead: boolean } = {
    name: nameMatch?.[1] ?? fallbackName,
    company: companyMatch?.[1]?.trim(),
    email: email?.toLowerCase(),
    interestCategory,
    phone: phoneMatch?.[1]?.trim(),
    goal: goalMatch?.[1]?.trim(),
    budget: budgetMatch?.[1]?.trim(),
    isLead: Boolean(email || companyMatch || phoneMatch),
  };

  return profile;
};

const stopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'what',
  'your',
  'about',
  'need',
  'want',
  'when',
  'how',
  'can',
  'you',
  'our',
]);

export const extractKeywords = (message: string, limit = 5): string[] => {
  return Array.from(
    new Set(
      message
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && !stopWords.has(token) && token.length > 3),
    ),
  ).slice(0, limit);
};

import { LeadProfile, IntentCategory } from '../types/bot';
import { extractKeywords } from '../utils/nlp';

const positiveSignals = ['budget', 'urgent', 'launch', 'scale', 'need crm', 'automation', 'ai crm', 'demo', 'proposal'];
const urgencySignals = ['asap', 'this week', 'immediately', 'today', 'now', 'deadline'];

type LeadScoreResult = {
  score: number;
  tier: 'hot' | 'warm' | 'cold';
};

export class LeadScoringService {
  scoreLead(input: {
    message: string;
    profile: LeadProfile;
    intent: IntentCategory;
    sentiment: number;
  }): LeadScoreResult {
    let score = 40;
    if (input.profile.email) score += 10;
    if (input.profile.phone) score += 8;
    if (input.profile.company) score += 6;
    if (input.profile.goal) score += 8;
    if (input.profile.budget) score += 12;

    if (input.intent === 'Lead Inquiry') score += 15;
    if (input.intent === 'Demo Booking') score += 18;
    if (input.intent === 'Support') score -= 5;

    score += input.sentiment * 10;

    const keywords = extractKeywords(input.message, 10);
    const keywordString = keywords.join(' ');
    positiveSignals.forEach(signal => {
      if (keywordString.includes(signal.replace(/\s+/g, ''))) score += 6;
    });
    urgencySignals.forEach(signal => {
      if (input.message.toLowerCase().includes(signal)) score += 5;
    });

    score = Math.max(0, Math.min(100, Math.round(score)));
    const tier: LeadScoreResult['tier'] = score >= 80 ? 'hot' : score >= 55 ? 'warm' : 'cold';
    return { score, tier };
  }
}

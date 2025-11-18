import { firestore } from '../lib/firebase';
import { Platform } from '../types/bot';
import { OutboundMessenger } from './outboundMessenger';
import { OpenAIService } from './openAIService';

type ProspectSearchInput = {
  platform: Extract<Platform, 'linkedin' | 'instagram'>;
  query: string;
  limit?: number;
};

export type ProspectRecord = {
  platform: Platform;
  profileId: string;
  name: string;
  headline?: string;
  lastActivity?: string;
  relevanceScore: number;
};

type OutreachRequest = {
  platform: Platform;
  profileId: string;
  name: string;
  headline?: string;
  goal?: string;
};

const outreachCollection = firestore.collection('outreach_logs');

export class PredictiveOutreachService {
  private messenger = new OutboundMessenger();
  private openAI = new OpenAIService();

  async findProspects(input: ProspectSearchInput): Promise<ProspectRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 5, 25));
    const now = Date.now();
    return Array.from({ length: limit }).map((_, idx) => ({
      platform: input.platform,
      profileId: `${input.platform}-${idx}-${Buffer.from(input.query).toString('hex').slice(0, 6)}`,
      name: `${input.platform === 'linkedin' ? 'LinkedIn' : 'IG'} Prospect ${idx + 1}`,
      headline: input.platform === 'linkedin' ? 'Growth Lead - AI Automation' : '#aiautomation #growth',
      lastActivity: new Date(now - idx * 3600 * 1000).toISOString(),
      relevanceScore: Number((0.9 - idx * 0.05).toFixed(2)),
    }));
  }

  async sendOutreach(request: OutreachRequest) {
    const prompt = await this.openAI.generateReply({
      platform: request.platform,
      intentCategory: 'Lead Inquiry',
      lead: {
        name: request.name,
        company: request.headline,
        goal: request.goal,
      },
      message: `Compose a friendly first-touch outreach for ${request.name ?? 'prospect'} about ${request.goal ?? 'AI automation'}.`,
    });

    const logRef = outreachCollection.doc();
    const logPayload = {
      id: logRef.id,
      platform: request.platform,
      profileId: request.profileId,
      name: request.name,
      headline: request.headline,
      goal: request.goal,
      message: prompt.reply,
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
    };

    await logRef.set(logPayload);

    try {
      if (request.platform !== 'web') {
        await this.messenger.send(request.platform, request.profileId, prompt.reply);
      }
      await logRef.update({ status: 'sent', sentAt: new Date().toISOString() });
    } catch (error) {
      await logRef.update({ status: 'failed', error: (error as Error).message });
      throw error;
    }

    return { ...logPayload, status: 'sent' };
  }
}

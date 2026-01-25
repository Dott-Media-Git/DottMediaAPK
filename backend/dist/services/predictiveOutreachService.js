import { firestore } from '../db/firestore.js';
import { OutboundMessenger } from './outboundMessenger.js';
import { OpenAIService } from './openAIService.js';
const outreachCollection = firestore.collection('outreach_logs');
export class PredictiveOutreachService {
    constructor() {
        this.messenger = new OutboundMessenger();
        this.openAI = new OpenAIService();
    }
    async findProspects(input) {
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
    async sendOutreach(request) {
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
            status: 'draft',
            createdAt: new Date().toISOString(),
        };
        await logRef.set(logPayload);
        try {
            if (request.platform !== 'web') {
                await this.messenger.send(request.platform, request.profileId, prompt.reply);
            }
            await logRef.update({ status: 'sent', sentAt: new Date().toISOString() });
        }
        catch (error) {
            await logRef.update({ status: 'failed', error: error.message });
            throw error;
        }
        return { ...logPayload, status: 'sent' };
    }
}

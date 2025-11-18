import { BotStatsService } from '../services/botStatsService';
export class BotController {
    constructor() {
        this.stats = new BotStatsService();
        this.getStats = async (_req, res, next) => {
            try {
                const payload = await this.stats.getStats();
                res.json(payload);
            }
            catch (error) {
                next(error);
            }
        };
        this.getLeadStats = async (_req, res, next) => {
            try {
                const payload = await this.stats.getLeadInsights();
                res.json(payload);
            }
            catch (error) {
                next(error);
            }
        };
        this.forwardLead = async (req, res, next) => {
            try {
                const payload = req.body;
                if (!payload?.phoneNumber || !payload.intentCategory) {
                    return res.status(400).json({ message: 'phoneNumber and intentCategory are required' });
                }
                await this.stats.forwardLead({
                    name: payload.name,
                    email: payload.email,
                    phoneNumber: payload.phoneNumber,
                    company: payload.company,
                    intentCategory: payload.intentCategory,
                    interestCategory: payload.interestCategory,
                    platform: payload.platform ?? 'app',
                    source: 'app',
                    goal: payload.goal,
                    budget: payload.budget,
                    leadScore: payload.leadScore,
                    leadTier: payload.leadTier,
                });
                res.status(202).json({ ok: true });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

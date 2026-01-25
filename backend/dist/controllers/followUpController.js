import { FollowUpService } from '../services/followUpService.js';
const followUps = new FollowUpService();
export class FollowUpController {
    constructor() {
        this.run = async (req, res, next) => {
            try {
                const { limit } = req.body;
                const results = await followUps.runDueFollowUps(limit ?? 10);
                res.json({ processed: results.length, results });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

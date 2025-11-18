import { PredictiveOutreachService } from '../services/predictiveOutreachService';
const outreach = new PredictiveOutreachService();
export class OutreachController {
    constructor() {
        this.search = async (req, res, next) => {
            try {
                const { platform, query, limit } = req.body;
                if (!platform || !query) {
                    return res.status(400).json({ message: 'platform and query are required' });
                }
                const prospects = await outreach.findProspects({ platform, query, limit });
                res.json({ prospects });
            }
            catch (error) {
                next(error);
            }
        };
        this.send = async (req, res, next) => {
            try {
                const { platform, profileId, name, headline, goal } = req.body;
                if (!platform || !profileId || !name) {
                    return res.status(400).json({ message: 'platform, profileId, and name are required' });
                }
                const result = await outreach.sendOutreach({ platform, profileId, name, headline, goal });
                res.status(202).json({ outreach: result });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

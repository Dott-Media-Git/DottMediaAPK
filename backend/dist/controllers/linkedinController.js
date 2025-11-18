import { LinkedInService } from '../services/linkedinService';
export class LinkedInController {
    constructor() {
        this.service = new LinkedInService();
        this.handle = async (req, res, next) => {
            try {
                const processed = await this.service.handleWebhook(req.body);
                res.json({ processed });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

import { config } from '../config.js';
import { FacebookService } from '../services/facebookService.js';
export class FacebookController {
    constructor() {
        this.service = new FacebookService();
        this.verify = (req, res) => {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            if (mode === 'subscribe' && token === config.channels.metaVerifyToken) {
                return res.status(200).send(challenge);
            }
            return res.status(403).send('Forbidden');
        };
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

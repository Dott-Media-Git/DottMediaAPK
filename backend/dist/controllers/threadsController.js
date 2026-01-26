import { config } from '../config';
import { ThreadsService } from '../services/threadsService';
export class ThreadsController {
    constructor() {
        this.service = new ThreadsService();
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

import { config } from '../config.js';
import { WhatsAppService } from '../services/whatsappService.js';
export class WhatsAppController {
    constructor() {
        this.service = new WhatsAppService();
        this.verify = (req, res) => {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
                return res.status(200).send(challenge);
            }
            return res.status(403).send('Forbidden');
        };
        this.handle = async (req, res, next) => {
            try {
                const payload = req.body;
                const messages = payload.entry?.flatMap(entry => entry.changes?.flatMap(change => change.value?.messages ?? []) ?? []) ?? [];
                const profileName = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;
                if (!messages.length) {
                    return res.status(200).json({ status: 'noop' });
                }
                const result = await this.service.handleMessages(messages, profileName);
                res.json({ processed: result.length });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

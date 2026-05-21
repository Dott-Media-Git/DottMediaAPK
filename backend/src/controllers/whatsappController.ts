import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { WhatsAppService } from '../services/whatsappService';
import { WhatsAppWebhookPayload } from '../types/bot';

export class WhatsAppController {
  private service = new WhatsAppService();

  verify = (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  };

  handle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as WhatsAppWebhookPayload;
      const messages =
        payload.entry?.flatMap(entry =>
          entry.changes?.flatMap(change => change.value?.messages ?? []) ?? [],
        ) ?? [];
      const profileName =
        payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;
      const phoneNumberId =
        payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

      if (!messages.length) {
        return res.status(200).json({ status: 'noop' });
      }

      const result = await this.service.handleMessages(messages, profileName, phoneNumberId);
      res.json({ processed: result.length });
    } catch (error) {
      next(error);
    }
  };
}

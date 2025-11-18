import { config } from '../config';
import { MakeLeadPayload } from '../types/bot';
import { MakeClient } from './makeClient';

export class CRMSyncService {
  private makeClient = new MakeClient();

  async syncLead(payload: MakeLeadPayload & { leadScore?: number; leadTier?: string }) {
    try {
      await this.makeClient.sendWebhook({
        ...payload,
        source: payload.source ?? payload.platform ?? 'app',
        crm: {
          leadScore: payload.leadScore,
          leadTier: payload.leadTier,
          makeScenario: config.make.templateId,
        },
      });
    } catch (error) {
      console.warn('CRM sync failed', error);
    }
  }
}

import { config } from '../config.js';
import { MakeClient } from './makeClient.js';
export class CRMSyncService {
    constructor() {
        this.makeClient = new MakeClient();
    }
    async syncLead(payload) {
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
        }
        catch (error) {
            console.warn('CRM sync failed', error);
        }
    }
}

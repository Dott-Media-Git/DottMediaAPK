import axios from 'axios';
import { config } from '../config.js';
const ensureConfigured = () => {
    if (!config.make.apiKey || !config.make.webhookUrl || !config.make.baseUrl || !config.make.templateId) {
        throw new Error('Make integration is disabled (missing API key/webhook/template).');
    }
};
const createHttp = () => axios.create({
    baseURL: config.make.baseUrl,
    headers: {
        Authorization: `Token ${config.make.apiKey}`,
        'Content-Type': 'application/json',
    },
});
export class MakeClient {
    async sendWebhook(payload) {
        ensureConfigured();
        await axios.post(config.make.webhookUrl, payload, { headers: { 'Content-Type': 'application/json' } });
    }
    async cloneScenario(name) {
        ensureConfigured();
        const http = createHttp();
        const { data } = await http.post(`/v2/scenarios/${config.make.templateId}/clone`, { name });
        return data.id;
    }
    async enableScenario(scenarioId) {
        ensureConfigured();
        const http = createHttp();
        await http.post(`/v2/scenarios/${scenarioId}/enable`);
    }
    async getScenarioStatus(scenarioId) {
        ensureConfigured();
        const http = createHttp();
        const { data } = await http.get(`/v2/scenarios/${scenarioId}`);
        return data.state;
    }
}

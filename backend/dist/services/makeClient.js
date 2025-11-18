import axios from 'axios';
import { config } from '../config';
const http = axios.create({
    baseURL: config.make.baseUrl,
    headers: {
        Authorization: `Token ${config.make.apiKey}`,
        'Content-Type': 'application/json',
    },
});
export class MakeClient {
    async sendWebhook(payload) {
        await axios.post(config.make.webhookUrl, payload, { headers: { 'Content-Type': 'application/json' } });
    }
    async cloneScenario(name) {
        const { data } = await http.post(`/v2/scenarios/${config.make.templateId}/clone`, { name });
        return data.id;
    }
    async enableScenario(scenarioId) {
        await http.post(`/v2/scenarios/${scenarioId}/enable`);
    }
    async getScenarioStatus(scenarioId) {
        const { data } = await http.get(`/v2/scenarios/${scenarioId}`);
        return data.state;
    }
}

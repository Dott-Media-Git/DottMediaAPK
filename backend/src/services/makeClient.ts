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
  async sendWebhook(payload: unknown) {
    await axios.post(config.make.webhookUrl, payload, { headers: { 'Content-Type': 'application/json' } });
  }

  async cloneScenario(name: string) {
    const { data } = await http.post(`/v2/scenarios/${config.make.templateId}/clone`, { name });
    return data.id as string;
  }

  async enableScenario(scenarioId: string) {
    await http.post(`/v2/scenarios/${scenarioId}/enable`);
  }

  async getScenarioStatus(scenarioId: string) {
    const { data } = await http.get(`/v2/scenarios/${scenarioId}`);
    return data.state;
  }
}

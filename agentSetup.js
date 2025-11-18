/**
 * Quickly initialize the Dott Media lead agent from any Node environment.
 * Example:
 *   import { initLeadAgent } from './agentSetup';
 *   const agent = initLeadAgent({ apiUrl: 'https://api.dott.media', widgetSecret: 'abc' });
 *   await agent.configure({ goal: '20 demos/mo', budget: '$3k' });
 */
export const initLeadAgent = ({ apiUrl, widgetSecret }) => {
  const base = apiUrl?.replace(/\/$/, '');
  if (!base) {
    throw new Error('apiUrl is required');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Widget-Token': widgetSecret ?? ''
  };

  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Agent request failed: ${err}`);
    }
    return response.json();
  };

  return {
    configure: (payload) => post('/webhook/widget', { userId: 'agent-setup', message: payload.goal ?? 'Configure agent', profile: payload }),
    generateOffer: (conversationId, options) => post('/api/offers', { conversationId, ...options }),
    runFollowUps: () => post('/api/followups/run', { limit: 10 })
  };
};

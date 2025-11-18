import { env } from '@services/env';
import { getIdToken } from '@services/firebase';
import type { CRMAnalytics } from '@models/crm';

type AssistantContextPayload = {
  userId: string;
  company?: string;
  analytics?: CRMAnalytics;
  currentScreen?: string;
};

const buildLocalResponse = (question: string, context: AssistantContextPayload) => {
  const metrics = context.analytics;
  const performanceLine = metrics
    ? `Here is the latest snapshot: leads ${metrics.leads}, engagement ${metrics.engagement}%, conversions ${metrics.conversions} and customer feedback ${metrics.feedbackScore}/5.`
    : 'I will keep an eye on your metrics once data is available.';

  let guidance = 'Tap Dashboard for trends or Controls to tweak automation settings.';
  if (context.currentScreen === 'Dashboard') {
    guidance = 'Review the charts up top, then open Controls to adjust campaigns.';
  } else if (context.currentScreen === 'Controls') {
    guidance = 'Scroll to Automation Controls to pause/resume or edit prompts.';
  } else if (context.currentScreen === 'Support') {
    guidance = 'You can reach support here; head back to Dashboard anytime for KPI insights.';
  }

  return `${performanceLine} ${guidance} ${question ? "Let's revisit that question once I'm connected." : ''}`.trim();
};

const buildApiUrl = (path: string) => {
  const base = env.apiUrl?.replace(/\/$/, '') ?? '';
  if (!base) return '';
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

const authHeader = async (userId: string) => {
  const token = await getIdToken();
  if (token) return `Bearer ${token}`;
  if (userId) return `Bearer mock-${userId}`;
  return null;
};

export const askAssistant = async (question: string, context: AssistantContextPayload) => {
  const endpoint = buildApiUrl('/api/assistant/chat');
  if (!endpoint) {
    return buildLocalResponse(question, context);
  }

  try {
    const authorization = await authHeader(context.userId);
    if (!authorization) {
      throw new Error('Missing auth token for assistant request');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization
      },
      body: JSON.stringify({
        question,
        context: {
          company: context.company,
          currentScreen: context.currentScreen,
          analytics: context.analytics
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Assistant API failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data?.answer) {
      throw new Error('Assistant API returned no answer');
    }

    return data.answer as string;
  } catch (error) {
    console.warn('Assistant request failed, falling back locally', error);
    return buildLocalResponse(question, context);
  }
};

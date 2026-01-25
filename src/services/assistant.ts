import { env } from '@services/env';
import { getIdToken } from '@services/firebase';
import type { CRMAnalytics } from '@models/crm';
import { translate, type Locale } from '@constants/i18n';

type AssistantContextPayload = {
  userId: string;
  company?: string;
  analytics?: CRMAnalytics;
  currentScreen?: string;
  subscriptionStatus?: string;
  connectedChannels?: string[];
  locale?: Locale;
};

const buildLocalResponse = (question: string, context: AssistantContextPayload) => {
  const locale = context.locale ?? 'en';
  const metrics = context.analytics;
  const performanceLine = metrics
    ? translate(
        locale,
        'Here is the latest snapshot: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} and customer feedback {{feedback}}/5.',
        {
          leads: metrics.leads,
          engagement: metrics.engagement,
          conversions: metrics.conversions,
          feedback: metrics.feedbackScore
        }
      )
    : translate(locale, 'I will keep an eye on your metrics once data is available.');

  const channels = context.connectedChannels?.length
    ? context.connectedChannels.join(', ')
    : translate(locale, 'none linked yet');
  const plan = context.subscriptionStatus ? context.subscriptionStatus.toUpperCase() : translate(locale, 'unknown');
  const summary = translate(locale, 'Plan: {{plan}}. Connected channels: {{channels}}.', { plan, channels });

  let guidance = translate(locale, 'Tap Dashboard for trends or Controls to tweak automation settings.');
  if (context.currentScreen === 'Dashboard') {
    guidance = translate(locale, 'Review the charts up top, then open Controls to adjust campaigns.');
  } else if (context.currentScreen === 'Controls') {
    guidance = translate(locale, 'Scroll to Automation Controls to pause/resume or edit prompts.');
  } else if (context.currentScreen === 'Support') {
    guidance = translate(locale, 'You can reach support here; head back to Dashboard anytime for KPI insights.');
  }

  const followUp = question ? translate(locale, "Let's revisit that question once I'm connected.") : '';
  return `${performanceLine} ${summary} ${guidance} ${followUp}`.trim();
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
          analytics: context.analytics,
          subscriptionStatus: context.subscriptionStatus,
          connectedChannels: context.connectedChannels,
          locale: context.locale
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

    if (typeof data.answer === 'string') {
      return data.answer;
    }

    if (typeof data.answer === 'object' && typeof data.answer.text === 'string') {
      return data.answer.text;
    }

    throw new Error('Assistant API returned an unsupported answer format');
  } catch (error) {
    console.warn('Assistant request failed, falling back locally', error);
    return buildLocalResponse(question, context);
  }
};

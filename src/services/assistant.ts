import { env } from '@services/env';
import { getIdToken } from '@services/firebase';
import type { CRMAnalytics } from '@models/crm';
import { translate, type Locale } from '@constants/i18n';

type AssistantContextPayload = {
  userId: string;
  company?: string;
  orgId?: string;
  businessGoals?: string;
  targetAudience?: string;
  accountSnapshot?: string;
  analytics?: CRMAnalytics;
  currentScreen?: string;
  subscriptionStatus?: string;
  connectedChannels?: string[];
  locale?: Locale;
};

const buildLocalResponse = (question: string, context: AssistantContextPayload) => {
  const locale = context.locale ?? 'en';
  const performanceLine = translate(
    locale,
    'I can summarize your account performance, connected channels, and growth opportunities as soon as live data is available.'
  );

  const channels = context.connectedChannels?.length
    ? context.connectedChannels.join(', ')
    : translate(locale, 'none linked yet');
  const plan = context.subscriptionStatus ? context.subscriptionStatus.toUpperCase() : translate(locale, 'unknown');
  const summary = translate(locale, 'Plan: {{plan}}. Connected channels: {{channels}}.', { plan, channels });

  const businessContext = [
    context.company ? translate(locale, 'Business: {{value}}.', { value: context.company }) : '',
    context.businessGoals ? translate(locale, 'Goals: {{value}}.', { value: context.businessGoals }) : '',
    context.targetAudience ? translate(locale, 'Audience: {{value}}.', { value: context.targetAudience }) : '',
  ]
    .filter(Boolean)
    .join(' ');

  let guidance = translate(
    locale,
    'Ask about your account performance, posting activity, connected channels, or the next strategy for your business.'
  );
  if (context.currentScreen === 'Dashboard') {
    guidance = translate(locale, 'Review the dashboard trends, then ask for a performance summary or a growth strategy.');
  } else if (context.currentScreen === 'Controls') {
    guidance = translate(locale, 'Use Controls to adjust automation settings, then ask me what should be optimized next.');
  } else if (context.currentScreen === 'Support') {
    guidance = translate(locale, 'Support is here if needed, but I can only answer questions about your account and business.');
  }

  const followUp = question
    ? translate(locale, "I only handle questions about your account, business, channels, and performance inside Dott.")
    : '';
  return `${performanceLine} ${summary} ${businessContext} ${guidance} ${followUp}`.trim();
};

const buildApiUrl = (path: string) => {
  const base = env.apiUrl?.replace(/\/$/, '') ?? '';
  if (!base) return '';
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

const buildEffectiveQuestion = (question: string, context: AssistantContextPayload) => {
  const accountSnapshot = context.accountSnapshot?.trim();
  const rules = [
    'You are Dott Assistant for this authenticated Dott account.',
    'Answer only about this account, its business, connected channels, analytics, automation, growth strategy, and actions available inside Dott.',
    'If the request is unrelated, say briefly that you only handle the user account and business inside Dott.',
    'Use the account snapshot below as the source of truth when summarizing performance or recommending actions.',
    'When the user asks for growth or strategy advice, give concrete steps tied to the current account data.',
    'If the user clearly approves a strategy, explain the exact action to implement next inside Dott.',
  ].join(' ');

  if (!accountSnapshot) {
    return `${rules}\n\nUser question: ${question}`;
  }

  return `${rules}\n\nAccount snapshot:\n${accountSnapshot}\n\nUser question: ${question}`;
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
  const effectiveQuestion = buildEffectiveQuestion(question, context);

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
        question: effectiveQuestion,
        context: {
          company: context.company,
          orgId: context.orgId,
          businessGoals: context.businessGoals,
          targetAudience: context.targetAudience,
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

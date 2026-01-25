import { env } from '@services/env';

type MakeEvent =
  | 'crm.setup'
  | 'crm.toggle'
  | 'crm.promptUpdate'
  | 'subscription.activated';

const postToMake = async (event: MakeEvent, data: Record<string, unknown>) => {
  if (!env.makeWebhookUrl) {
    console.warn('MAKE webhook URL is not configured, skipping request', { event });
    return;
  }

  try {
    const response = await fetch(env.makeWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const message = await response.text();
      console.warn('MAKE webhook request failed', { event, status: response.status, message });
    }
  } catch (error) {
    console.warn('Failed to send MAKE webhook request', { event, error });
  }
};

export type CRMSetupPayload = {
  uid: string;
  companyName: string;
  email: string;
  phone: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  targetAudience?: string;
  businessGoals?: string;
  crmPrompt: string;
};

export const sendCRMSetup = async (payload: CRMSetupPayload) => {
  await postToMake('crm.setup', payload);
};

export const sendCRMToggle = async ({ uid, isActive }: { uid: string; isActive: boolean }) => {
  await postToMake('crm.toggle', { uid, isActive });
};

export const sendCRMPromptUpdate = async ({ uid, prompt }: { uid: string; prompt: string }) => {
  await postToMake('crm.promptUpdate', { uid, prompt });
};

export const sendSubscriptionActivated = async ({
  uid,
  email,
  name
}: {
  uid: string;
  email: string;
  name: string;
}) => {
  await postToMake('subscription.activated', { uid, email, name });
};

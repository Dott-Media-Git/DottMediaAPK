import createHttpError from 'http-errors';

export type MtnMode = 'sandbox' | 'production';
export type MtnConfig = {
  mode: MtnMode;
  baseUrl: string;
  target: 'sandbox' | 'mtnuganda';
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  usdToUgx: number;
  testers: string[];
};

const sandboxUrl = 'https://sandbox.momodeveloper.mtn.com';
const liveUrls = ['https://momoapi.momo.africa', 'https://proxy.momoapi.mtn.com'];

export function mtnConfig(env = process.env): MtnConfig | null {
  if (env.ALLOW_MOCK_AUTH === 'true') return null;
  const mode = env.MTN_MOMO_MODE?.trim();
  if (mode !== 'sandbox' && mode !== 'production') return null;
  const baseUrl = mode === 'sandbox' ? sandboxUrl : env.MTN_MOMO_BASE_URL?.trim().replace(/\/$/, '') ?? '';
  const subscriptionKey = env.MTN_MOMO_SUBSCRIPTION_KEY?.trim();
  const apiUser = env.MTN_MOMO_API_USER?.trim();
  const apiKey = env.MTN_MOMO_API_KEY?.trim();
  const usdToUgx = Number(env.MTN_MOMO_USD_TO_UGX);
  const testers = (env.MTN_MOMO_SANDBOX_TEST_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  if (!subscriptionKey || !apiUser || !apiKey || !Number.isFinite(usdToUgx) || usdToUgx <= 0) return null;
  if (mode === 'production' && !liveUrls.includes(baseUrl)) return null;
  if (mode === 'sandbox' && !testers.length) return null;
  return { mode, baseUrl, target: mode === 'sandbox' ? 'sandbox' : 'mtnuganda', subscriptionKey, apiUser, apiKey, usdToUgx, testers };
}

export function normalizeMtnPayer(input: string, mode: MtnMode) {
  const digits = input.trim().replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (mode === 'sandbox' && /^46733123\d{3}$/.test(digits)) return digits;
  const ugandan = /^0\d{9}$/.test(digits) ? '256' + digits.slice(1) : digits;
  if (!/^2567\d{8}$/.test(ugandan)) {
    throw createHttpError(400, mode === 'sandbox' ? 'Use an MTN sandbox test number.' : 'Enter a valid Ugandan mobile number.');
  }
  return ugandan;
}

export type MtnPaymentStatus = {
  status?: string;
  amount?: string;
  currency?: string;
  externalId?: string;
  financialTransactionId?: string;
};

export function classifyMtnPayment(payment: MtnPaymentStatus | null, expected: { id: string; amount: number; currency: string }) {
  if (payment?.status === 'FAILED') return 'failed';
  if (payment?.status !== 'SUCCESSFUL') return 'pending';
  if (payment.externalId !== expected.id || payment.currency !== expected.currency ||
      !/^\d+(?:\.0+)?$/.test(String(payment.amount ?? '')) || Number(payment.amount) !== expected.amount ||
      !String(payment.financialTransactionId ?? '').trim()) return 'review';
  return 'successful';
}

export function createMtnClient(config: MtnConfig, transport = fetch) {
  const headers = {
    'Ocp-Apim-Subscription-Key': config.subscriptionKey,
    'X-Target-Environment': config.target,
  };
  let token: { value: string; expires: number } | undefined;

  const call = (path: string, options: RequestInit) => transport(config.baseUrl + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(8_000),
  });

  const authorize = async () => {
    if (token && token.expires > Date.now()) return 'Bearer ' + token.value;
    const basic = Buffer.from(config.apiUser + ':' + config.apiKey).toString('base64');
    const response = await call('/collection/token/', { method: 'POST', headers: { ...headers, Authorization: 'Basic ' + basic } });
    if (!response.ok) throw createHttpError(503, 'MTN MoMo authorization is temporarily unavailable.');
    const body = await response.json();
    if (typeof body.access_token !== 'string' || !body.access_token) throw createHttpError(502, 'MTN MoMo returned an invalid response.');
    token = { value: body.access_token, expires: Date.now() + Math.max(0, Number(body.expires_in || 0) - 60) * 1_000 };
    return 'Bearer ' + token.value;
  };

  return {
    authorize,
    async requestPayment(payment: { id: string; amount: number; currency: string; phone: string; planName: string }, authorization: string) {
      const response = await call('/collection/v1_0/requesttopay', {
        method: 'POST',
        headers: { ...headers, Authorization: authorization, 'X-Reference-Id': payment.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: String(payment.amount), currency: payment.currency, externalId: payment.id,
          payer: { partyIdType: 'MSISDN', partyId: payment.phone },
          payerMessage: 'Dotti ' + payment.planName + ' plan',
          payeeNote: 'Dotti plan payment',
        }),
      });
      if (response.status === 202 || response.status === 409) return 'accepted';
      if (response.status === 400 || response.status === 422) return 'rejected';
      return 'uncertain';
    },
    async checkPayment(id: string): Promise<MtnPaymentStatus | null> {
      const response = await call('/collection/v1_0/requesttopay/' + encodeURIComponent(id), {
        method: 'GET', headers: { ...headers, Authorization: await authorize() },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        if (response.status === 401) token = undefined;
        throw createHttpError(503, 'MTN MoMo status is temporarily unavailable.');
      }
      return response.json();
    },
  };
}

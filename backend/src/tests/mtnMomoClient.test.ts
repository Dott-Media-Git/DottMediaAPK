import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMtnPayment, createMtnClient, mtnConfig, normalizeMtnPayer } from '../services/billing/mtnMomoClient';

const env = {
  MTN_MOMO_MODE: 'sandbox',
  MTN_MOMO_SUBSCRIPTION_KEY: 'fake-subscription',
  MTN_MOMO_API_USER: 'fake-user',
  MTN_MOMO_API_KEY: 'fake-key',
  MTN_MOMO_USD_TO_UGX: '3800',
  MTN_MOMO_SANDBOX_TEST_USER_IDS: 'test-user',
};
const reference = 'd7389517-5fd4-415b-8465-214161596707';

test('MTN configuration requires deliberate sandbox or live credentials', () => {
  assert.equal(mtnConfig({}), null);
  assert.equal(mtnConfig({ ...env, MTN_MOMO_SANDBOX_TEST_USER_IDS: '' }), null);
  assert.equal(mtnConfig({ ...env, MTN_MOMO_MODE: 'production', MTN_MOMO_BASE_URL: 'https://example.com' }), null);
  assert.equal(mtnConfig({ ...env, MTN_MOMO_MODE: 'production', MTN_MOMO_BASE_URL: 'https://momoapi.momo.africa' })?.target, 'mtnuganda');
});

test('MTN normalizes Ugandan and sandbox test numbers', () => {
  assert.equal(normalizeMtnPayer('0772 123456', 'production'), '256772123456');
  assert.equal(normalizeMtnPayer('+256 772 123 456', 'production'), '256772123456');
  assert.equal(normalizeMtnPayer('46733123451', 'sandbox'), '46733123451');
  assert.throws(() => normalizeMtnPayer('0772 123456', 'sandbox'), /sandbox test number/);
  assert.throws(() => normalizeMtnPayer('46733123451', 'production'));
});

test('MTN confirmation checks exact reference, currency, amount and settlement ID', () => {
  const expected = { id: reference, amount: 155000, currency: 'UGX' };
  const verified = { externalId: reference, currency: 'UGX', amount: '155000.00', financialTransactionId: 'example', status: 'SUCCESSFUL' };
  assert.equal(classifyMtnPayment(verified, expected), 'successful');
  assert.equal(classifyMtnPayment({ ...verified, currency: 'EUR' }, expected), 'review');
  assert.equal(classifyMtnPayment({ ...verified, amount: '155001' }, expected), 'review');
  assert.equal(classifyMtnPayment({ ...verified, externalId: 'other' }, expected), 'review');
  assert.equal(classifyMtnPayment({ ...verified, financialTransactionId: undefined }, expected), 'review');
  assert.equal(classifyMtnPayment({ status: 'FAILED' }, expected), 'failed');
  assert.equal(classifyMtnPayment(null, expected), 'pending');
});

test('MTN submits and checks the same sandbox reference using the Collections contract', async () => {
  const calls: Array<{ url: string; request?: RequestInit }> = [];
  const transport: typeof fetch = async (url, request) => {
    calls.push({ url: String(url), request });
    if (String(url).endsWith('/token/')) return Response.json({ access_token: 'fake-access', expires_in: 300 });
    if (request?.method === 'POST') return new Response(null, { status: 202 });
    return Response.json({ status: 'SUCCESSFUL', currency: 'EUR', amount: '1', externalId: reference, financialTransactionId: 'sample' });
  };
  const client = createMtnClient(mtnConfig(env)!, transport);
  const authorization = await client.authorize();
  const outcome = await client.requestPayment({
    id: reference, amount: 1, currency: 'EUR', phone: '46733123451', planName: 'Creator',
  }, authorization);
  assert.equal(outcome, 'accepted');
  assert.equal(calls[1].url, 'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay');
  assert.equal(new Headers(calls[1].request?.headers).get('X-Reference-Id'), reference);
  assert.equal(new Headers(calls[1].request?.headers).get('X-Target-Environment'), 'sandbox');
  assert.equal(JSON.parse(String(calls[1].request?.body)).amount, '1');
  const verified = await client.checkPayment(reference);
  assert.equal(classifyMtnPayment(verified, { id: reference, amount: 1, currency: 'EUR' }), 'successful');
  assert.equal(calls.length, 3);
  assert.ok(calls[2].url.endsWith('/requesttopay/' + reference));
});

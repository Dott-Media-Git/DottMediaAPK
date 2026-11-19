import assert from 'node:assert/strict';
import { test } from 'node:test';
import { meterConnectionUsage } from '../utils/connectionUsage';

test('normal connection usage is metered', async () => {
  assert.equal(await meterConnectionUsage(async () => ({}), () => false, true), 'metered');
});

test('Firestore quota failure permits connection only with durable fallback configured', async () => {
  const error = { code: 8 };
  const consume = async () => { throw error; };
  const isQuota = (value: unknown) => value === error;
  assert.equal(await meterConnectionUsage(consume, isQuota, true), 'quota_unavailable');
  await assert.rejects(meterConnectionUsage(consume, isQuota, false), value => value === error);
});

test('plan limits and other failures are never bypassed', async () => {
  const error = new Error('Plan limit reached');
  await assert.rejects(meterConnectionUsage(async () => { throw error; }, () => false, true), value => value === error);
});

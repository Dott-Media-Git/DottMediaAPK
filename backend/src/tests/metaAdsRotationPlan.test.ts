import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSharedBudgetRotationPlan, getCarMarketRotationDay } from '../services/metaAdsRotationPlan.js';

test('closes the last eligible day at Kampala midnight and rejects new campaigns from day eleven', () => {
  const start = '2026-11-24';
  const end = Date.parse('2026-12-04T00:00:00+03:00');
  assert.deepEqual(getCarMarketRotationDay(start, end - 1), {
    status: 'scheduled', date: '2026-12-03', dayEnd: end, pairIndex: 4,
  });
  assert.deepEqual(getCarMarketRotationDay(start, end), { status: 'rotation_finished' });
});

const input = {
  facebookPost: { id: '123_456', platform: 'facebook' as const },
  instagramPost: { id: '789', platform: 'instagram' as const },
  dailyBudgetCents: 100,
  startTime: new Date('2026-11-24T09:00:00Z'),
};

test('uses one daily capped budget and two paused posts for exactly 24 hours', () => {
  const plan = createSharedBudgetRotationPlan(input);
  assert.deepEqual(plan.campaign, { status: 'PAUSED', lifetime_budget: 100 });
  assert.equal(plan.endTime, '2026-11-25T09:00:00.000Z');
  assert.deepEqual(plan.ads.map(ad => [ad.platform, ad.postId, ad.status]), [
    ['facebook', '123_456', 'PAUSED'], ['instagram', '789', 'PAUSED'],
  ]);
});

test('rejects missing posts, invalid budgets and invalid timestamps before any API call', () => {
  assert.throws(() => createSharedBudgetRotationPlan({ ...input, dailyBudgetCents: 0 }));
  assert.throws(() => createSharedBudgetRotationPlan({ ...input, dailyBudgetCents: 100.5 }));
  assert.throws(() => createSharedBudgetRotationPlan({ ...input, instagramPost: { ...input.instagramPost, id: '' } }));
  assert.throws(() => createSharedBudgetRotationPlan({ ...input, startTime: new Date('invalid') }));
});

test('two consecutive day plans can reuse the same post pair with separate $1 caps', () => {
  const first = createSharedBudgetRotationPlan(input);
  const second = createSharedBudgetRotationPlan({ ...input, startTime: new Date(first.endTime) });
  assert.deepEqual(first.ads, second.ads);
  assert.equal(first.campaign.lifetime_budget + second.campaign.lifetime_budget, 200);
  assert.equal(second.endTime, '2026-11-26T09:00:00.000Z');
});

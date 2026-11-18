import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { optedInAfter, replyIsAfterOptIn } from '../services/threadsReplyEligibility';

test('new accounts need an explicit enabled setting with a valid activation time', () => {
  assert.equal(optedInAfter(null), null);
  assert.equal(optedInAfter({ payload: { enabled: false }, received_at: '2026-11-18T16:00:00Z' }), null);
  assert.equal(optedInAfter({ payload: { enabled: true }, received_at: 'invalid' }), null);
  assert.equal(optedInAfter({ payload: { enabled: true }, received_at: '2026-11-18T16:00:00Z' }), '2026-11-18T16:00:00Z');
});

test('only replies strictly after opt-in are eligible for a newly enabled account', () => {
  const since = '2026-11-18T16:00:00Z';
  assert.equal(replyIsAfterOptIn('2026-11-18T15:59:59Z', since), false);
  assert.equal(replyIsAfterOptIn('2026-11-18T16:00:00Z', since), false);
  assert.equal(replyIsAfterOptIn(undefined, since), false);
  assert.equal(replyIsAfterOptIn('2026-11-18T16:00:01Z', since), true);
});

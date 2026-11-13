import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { replyWithDeadline } from '../services/replyWithDeadline';

test('uses the generated reply when it is ready', async () => {
  assert.equal(await replyWithDeadline(Promise.resolve('Hello'), 'Fallback', 50), 'Hello');
});

test('uses a fallback when reply generation hangs or fails', async () => {
  assert.equal(await replyWithDeadline(new Promise(() => {}), 'Fallback', 10), 'Fallback');
  assert.equal(await replyWithDeadline(Promise.reject(new Error('unavailable')), 'Fallback', 50), 'Fallback');
});

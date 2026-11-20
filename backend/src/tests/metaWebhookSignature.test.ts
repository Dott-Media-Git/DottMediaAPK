import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyMetaWebhookSignature } from '../utils/metaWebhookSignature';

test('accepts only a valid signature over the exact webhook bytes', () => {
  const body = Buffer.from('{"object":"page"}');
  const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.equal(verifyMetaWebhookSignature(body, signature, 'secret'), true);
  assert.equal(verifyMetaWebhookSignature(Buffer.from('{"object": "page"}'), signature, 'secret'), false);
  assert.equal(verifyMetaWebhookSignature(body, signature, 'wrong'), false);
  assert.equal(verifyMetaWebhookSignature(body, 'sha256=bad', 'secret'), false);
  assert.equal(verifyMetaWebhookSignature(body, undefined, 'secret'), false);
  assert.equal(verifyMetaWebhookSignature(body, signature, undefined), false);
});

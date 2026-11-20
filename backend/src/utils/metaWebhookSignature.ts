import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyMetaWebhookSignature(raw: Buffer | undefined, signature: string | undefined, secret: string | undefined): boolean {
  if (!Buffer.isBuffer(raw) || !secret || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const actual = Buffer.from(signature.slice(7), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

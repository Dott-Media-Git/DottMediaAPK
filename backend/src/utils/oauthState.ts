import { createHmac, randomBytes } from 'crypto';
import { config } from '../config';

const STATE_TTL_MS = 15 * 60 * 1000;

type StatePayload = {
  userId: string;
  nonce: string;
  ts: number;
};

const base64UrlEncode = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
};

const sign = (payload: string) =>
  createHmac('sha256', config.widget.sharedSecret).update(payload).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export const createSignedState = (userId: string) => {
  const payload: StatePayload = {
    userId,
    nonce: randomBytes(16).toString('hex'),
    ts: Date.now(),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
};

export const verifySignedState = (state: string): StatePayload | null => {
  if (!state || !state.includes('.')) return null;
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (expected !== signature) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as StatePayload;
    if (!payload.userId || !payload.nonce || !payload.ts) return null;
    if (Date.now() - payload.ts > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
};

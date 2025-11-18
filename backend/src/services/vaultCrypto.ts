import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const algorithm = 'aes-256-gcm';

export const getEncryptionKey = () => {
  const keyB64 = process.env.ENCRYPTION_KEY;
  if (!keyB64) throw new Error('Missing ENCRYPTION_KEY env for vault operations');
  const buf = Buffer.from(keyB64, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)');
  return buf;
};

export const encryptValueRaw = (plain: string, key: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, ciphertext, authTag };
};

export const decryptValueRaw = (payload: { iv: Buffer; ciphertext: Buffer; authTag: Buffer }, key: Buffer) => {
  const decipher = createDecipheriv(algorithm, key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8');
};

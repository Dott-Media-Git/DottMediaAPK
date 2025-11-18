import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';
import { decryptValueRaw, encryptValueRaw, getEncryptionKey } from './vaultCrypto';

const vaultCollection = firestore.collection('vault');
const secretsCollection = firestore.collection('secrets');
const encryptionKey = getEncryptionKey();

export async function putSecret(orgId: string, key: string, value: string) {
  const { iv, ciphertext, authTag } = encryptValueRaw(value, encryptionKey);
  const vaultPath = `${orgId}_${key}`;
  await vaultCollection.doc(vaultPath).set(
    {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await secretsCollection.doc(orgId).set(
    {
      refs: {
        [key]: `vault/${vaultPath}`,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getSecret(orgId: string, key: string, options: { decrypt?: boolean } = {}) {
  const doc = await secretsCollection.doc(orgId).get();
  const refs = (doc.data()?.refs as Record<string, string> | undefined) ?? {};
  const refPath = refs[key];
  if (!refPath) return null;
  const vaultDocId = refPath.replace('vault/', '');
  const vaultSnap = await vaultCollection.doc(vaultDocId).get();
  if (!vaultSnap.exists) return null;
  const data = vaultSnap.data() as {
    iv: string;
    authTag: string;
    ciphertext: string;
    updatedAt?: admin.firestore.Timestamp;
  };
  if (!options.decrypt) {
    return {
      key,
      ref: refPath,
      updatedAt: data.updatedAt?.toDate().toISOString(),
      masked: '***',
    };
  }
  const decrypted = decryptValueRaw(
    {
      iv: Buffer.from(data.iv, 'base64'),
      authTag: Buffer.from(data.authTag, 'base64'),
      ciphertext: Buffer.from(data.ciphertext, 'base64'),
    },
    encryptionKey,
  );
  return {
    key,
    value: decrypted,
    updatedAt: data.updatedAt?.toDate().toISOString(),
  };
}

export { encryptValueRaw as encryptValue, decryptValueRaw as decryptValue };

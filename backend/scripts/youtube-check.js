import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const userArg = args.find(arg => arg.startsWith('--userId='));
const userId = userArg ? userArg.split('=')[1] : '';

const callbackPath = '/integrations/youtube/callback';
const normalizeBaseUrl = value => value.replace(/\/+$/, '');

const computeBaseUrl = () => {
  const envBase = process.env.BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? process.env.API_URL;
  if (envBase) return normalizeBaseUrl(envBase);
  const port = process.env.PORT ?? 4000;
  return `http://localhost:${port}`;
};

const computeRedirectUri = () => `${computeBaseUrl()}${callbackPath}`;

const loadServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().length > 0) {
    return JSON.parse(raw);
  }
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (filePath) {
    const resolved = path.resolve(filePath);
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }
  return null;
};

const initFirestore = () => {
  const credentials = loadServiceAccount();
  if (!credentials) return null;
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.cert(credentials) });
  }
  return admin.firestore();
};

const hasEnv = value => (value ? 'configured' : 'missing');

const main = async () => {
  const baseUrl = computeBaseUrl();
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI || computeRedirectUri();
  const connectUrl = `${baseUrl}/integrations/youtube/connect`;

  console.log('YouTube Integration Check');
  console.log('--------------------------');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Computed redirect URI: ${computeRedirectUri()}`);
  console.log(`Configured redirect URI: ${redirectUri}`);
  console.log(`Connect URL: ${connectUrl}`);
  console.log('');
  console.log(`YOUTUBE_CLIENT_ID: ${hasEnv(process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID)}`);
  console.log(`YOUTUBE_CLIENT_SECRET: ${hasEnv(process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET)}`);
  console.log(`YOUTUBE_REDIRECT_URI: ${hasEnv(process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI)}`);
  console.log(`ENCRYPTION_KEY: ${hasEnv(process.env.ENCRYPTION_KEY)}`);

  if (userId) {
    const firestore = initFirestore();
    if (!firestore) {
      console.log('Firestore not configured; cannot check integration status.');
      return;
    }
    const docId = `${userId}_youtube`;
    const snap = await firestore.collection('socialIntegrations').doc(docId).get();
    console.log('');
    console.log(`Integration for user ${userId}: ${snap.exists ? 'found' : 'not found'}`);
  } else {
    console.log('');
    console.log('Pass --userId=UID to check integration presence.');
  }
};

main().catch(error => {
  console.error('youtube-check failed', error);
  process.exitCode = 1;
});

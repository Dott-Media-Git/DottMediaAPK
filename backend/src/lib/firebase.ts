import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

type ServiceAccount = admin.ServiceAccount & {
  project_id?: string;
};

const readServiceAccount = (): ServiceAccount | null => {
  const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const fallbackPaths = [
    explicitPath,
    path.resolve(process.cwd(), 'serviceAccountKey.json'),
    path.resolve(process.cwd(), 'backend', 'serviceAccountKey.json')
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of fallbackPaths) {
    if (fs.existsSync(candidate)) {
      const contents = fs.readFileSync(candidate, 'utf8');
      try {
        return JSON.parse(contents) as ServiceAccount;
      } catch (error) {
        throw new Error(`Failed to parse Firebase service account JSON at ${candidate}: ${(error as Error).message}`);
      }
    }
  }

  return null;
};

const serviceAccount = readServiceAccount();
const envCredentials: ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

const credentialSource = serviceAccount ?? envCredentials;

const app = admin.apps.length
  ? admin.app()
  : admin.initializeApp({
      credential: admin.credential.cert(credentialSource),
      projectId: credentialSource.projectId ?? credentialSource.project_id,
    });

export const firebaseApp = app;
export const firestore = app.firestore();

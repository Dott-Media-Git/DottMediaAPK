import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

type ServiceAccount = admin.ServiceAccount & { project_id?: string };

const buildMockFirestore = () =>
  ({
    collection: () => ({
      doc: () => ({
        set: () => Promise.resolve(),
        update: () => Promise.resolve(),
        get: () => Promise.resolve({ exists: false, data: () => ({}) }),
        collection: () => ({}),
      }),
      add: () => Promise.resolve({ id: `mock-${Date.now()}` }),
      where: () => ({
        get: () => Promise.resolve({ docs: [] }),
      }),
      orderBy: () => ({
        limit: () => ({
          get: () => Promise.resolve({ docs: [] }),
        }),
      }),
    }),
    runTransaction: <T>(fn: () => Promise<T>) => fn(),
  }) as unknown as admin.firestore.Firestore;

const loadServiceAccount = (): ServiceAccount => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().length > 0) {
    try {
      return JSON.parse(raw) as ServiceAccount;
    } catch (error) {
      throw new Error(`Unable to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${(error as Error).message}`);
    }
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (filePath) {
    try {
      const resolved = path.resolve(filePath);
      const contents = fs.readFileSync(resolved, 'utf8');
      return JSON.parse(contents) as ServiceAccount;
    } catch (error) {
      throw new Error(`Unable to read FIREBASE_SERVICE_ACCOUNT file: ${(error as Error).message}`);
    }
  }

  if (process.env.ALLOW_MOCK_AUTH === 'true') {
    console.warn('[firestore] FIREBASE_SERVICE_ACCOUNT_JSON missing, running with mock Firestore');
    return {} as ServiceAccount;
  }

  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT env var');
};

const initFirestore = (): { firebaseApp: admin.app.App | null; firestore: admin.firestore.Firestore } => {
  if (process.env.ALLOW_MOCK_AUTH === 'true') {
    console.warn('[firestore] mock mode enabled; using in-memory Firestore');
    return { firebaseApp: null, firestore: buildMockFirestore() };
  }

  const credentials = loadServiceAccount();
  const projectId = credentials.projectId ?? credentials.project_id;
  if (!projectId) {
    throw new Error('Firestore credentials missing projectId');
  }

  const app =
    admin.apps.length > 0
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert(credentials),
          projectId,
        });

  return { firebaseApp: app, firestore: app.firestore() };
};

const { firebaseApp, firestore } = initFirestore();

export { firebaseApp, firestore };

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
dotenv.config();

type ServiceAccount = admin.ServiceAccount & { project_id?: string };

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

  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT env var');
};

const initFirebase = () => {
  if (admin.apps.length) return admin.app();
  const serviceAccount = loadServiceAccount();
  const projectId = serviceAccount.projectId ?? serviceAccount.project_id;
  const clientEmail = (serviceAccount as any).client_email ?? (serviceAccount as any).clientEmail;
  const privateKey = (serviceAccount as any).private_key ?? (serviceAccount as any).privateKey;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Service account missing projectId, client_email, or private_key.');
  }
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.findIndex(arg => arg === flag);
    if (index === -1) return undefined;
    return args[index + 1];
  };
  return {
    email: get('--email'),
    uid: get('--uid'),
    orgId: get('--orgId'),
  };
};

const deleteCollection = async (collection: FirebaseFirestore.CollectionReference, label: string) => {
  const batchSize = 200;
  let total = 0;
  while (true) {
    const snap = await collection.limit(batchSize).get();
    if (snap.empty) break;
    const batch = collection.firestore.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    total += snap.size;
  }
  if (total > 0) {
    console.log(`Cleared ${total} docs from ${label}.`);
  }
};

const clearAnalyticsScope = async (scopeId: string) => {
  const root = admin.firestore().collection('analytics').doc(scopeId);
  const subcollections = [
    'daily',
    'inboundDaily',
    'outboundDaily',
    'engagementDaily',
    'followupsDaily',
    'webLeadsDaily',
    'summaries',
  ];

  for (const sub of subcollections) {
    await deleteCollection(root.collection(sub), `analytics/${scopeId}/${sub}`);
  }

  await root.delete();
  console.log(`Reset analytics scope ${scopeId}.`);
};

const resolveUser = async (email?: string, uid?: string) => {
  const firestore = admin.firestore();
  const usersCollection = firestore.collection('users');
  if (uid) {
    const doc = await usersCollection.doc(uid).get();
    return doc.exists ? { uid, ...doc.data() } : null;
  }
  if (!email) return null;
  const snap = await usersCollection.where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { uid: doc.id, ...doc.data() };
};

const resolveOrgId = async (uid?: string, userData?: Record<string, any>) => {
  if (userData?.orgId) return userData.orgId as string;
  if (!uid) return undefined;
  const snap = await admin.firestore().collection('orgUsers').where('uid', '==', uid).limit(1).get();
  if (snap.empty) return undefined;
  return snap.docs[0].data().orgId as string | undefined;
};

const main = async () => {
  initFirebase();
  const { email, uid, orgId } = parseArgs();
  const user = await resolveUser(email, uid);
  const resolvedUid = user?.uid ?? uid;
  const resolvedOrgId = orgId ?? (await resolveOrgId(resolvedUid, user as Record<string, any> | undefined));

  const scopes = new Set<string>();
  if (resolvedOrgId) scopes.add(resolvedOrgId);
  if (resolvedUid) scopes.add(resolvedUid);

  if (scopes.size === 0) {
    throw new Error('No analytics scope found. Provide --uid or --orgId or --email.');
  }

  for (const scope of scopes) {
    await clearAnalyticsScope(scope);
  }

  console.log('Analytics reset complete.');
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});

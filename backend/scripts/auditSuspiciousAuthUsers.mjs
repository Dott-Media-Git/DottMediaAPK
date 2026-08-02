import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required');
const credential = JSON.parse(raw);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(credential) });
}

const pattern = /(tester|codex|outbound|hao)/i;
const matches = [];
let pageToken;
do {
  const page = await admin.auth().listUsers(1000, pageToken);
  page.users.forEach(user => {
    const haystack = [user.email, user.displayName, user.uid].filter(Boolean).join(' ');
    if (!pattern.test(haystack)) return;
    matches.push({
      uid: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      disabled: user.disabled,
      createdAt: user.metadata.creationTime,
      lastSignInAt: user.metadata.lastSignInTime ?? null,
      providers: user.providerData.map(provider => provider.providerId),
    });
  });
  pageToken = page.pageToken;
} while (pageToken);

console.log(JSON.stringify({ count: matches.length, matches }, null, 2));

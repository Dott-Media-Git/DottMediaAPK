import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required');
const credential = JSON.parse(raw);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(credential) });
}

const confirmedTestUserIds = [
  'F11OOVzWW7R5vcGU9uUVzeBI42I3',
  'HAo6YtFvhKgSySa8EoERKYYq2IV2',
  'codex-admin-verify',
  'codex-oauth-flow-check',
  'jh8adYmLZaTNQDGoaH0spcMQVwg2',
  'outbound-restriction-test-user',
  'outbound-restriction-test-user-2',
  'q71oPYl9exUM29gWRQXXlbVH0OD2',
];

const pattern = /(tester|codex|outbound|hao)/i;
const listMatches = async () => {
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
  return matches;
};

const before = await listMatches();
console.log(JSON.stringify({ phase: 'before', count: before.length, matches: before }, null, 2));

if (String(process.env.DELETE_CONFIRMED_TEST_USERS).toLowerCase() === 'true') {
  const unexpected = before.filter(user => !confirmedTestUserIds.includes(user.uid));
  if (unexpected.length) {
    throw new Error(`Audit returned non-allowlisted matches; refusing cleanup: ${unexpected.map(user => user.uid).join(', ')}`);
  }

  const existingIds = before.map(user => user.uid);
  const deletion = await admin.auth().deleteUsers(existingIds);
  if (deletion.failureCount) {
    throw new Error(`Firebase Auth failed to delete ${deletion.failureCount} confirmed test users`);
  }

  const db = admin.firestore();
  await Promise.all(
    existingIds.flatMap(uid => [
      db.collection('users').doc(uid).delete(),
      db.collection('profiles').doc(uid).delete(),
    ]),
  );

  const after = await listMatches();
  console.log(JSON.stringify({
    phase: 'after',
    deletedAuthUsers: deletion.successCount,
    deletedUserAndProfileDocs: existingIds.length * 2,
    remainingMatches: after,
  }, null, 2));
}

import 'dotenv/config';
import admin from 'firebase-admin';
import { firestore } from '../src/db/firestore';

const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() ?? '';

const primaryEmails = new Set(
  (process.env.PRIMARY_SOCIAL_EMAILS ?? 'brasioxirin@gmail.com')
    .split(',')
    .map(entry => normalizeEmail(entry))
    .filter(Boolean),
);

const isDryRun = process.env.DRY_RUN === 'true';

async function run() {
  const snap = await firestore.collection('users').get();
  let inspected = 0;
  let cleared = 0;

  for (const doc of snap.docs) {
    inspected += 1;
    const data = doc.data() as { email?: string | null; socialAccounts?: Record<string, unknown> };
    const email = normalizeEmail(data.email);
    if (email && primaryEmails.has(email)) {
      continue;
    }
    if (!data.socialAccounts || Object.keys(data.socialAccounts).length === 0) {
      continue;
    }
    if (isDryRun) {
      console.log(`[dry-run] would clear socialAccounts for ${email || doc.id}`);
      cleared += 1;
      continue;
    }
    await doc.ref.set({ socialAccounts: admin.firestore.FieldValue.delete() }, { merge: true });
    console.log(`cleared socialAccounts for ${email || doc.id}`);
    cleared += 1;
  }

  console.log(
    `${isDryRun ? 'dry-run complete' : 'cleanup complete'}: inspected ${inspected}, cleared ${cleared}`,
  );
}

run().catch(error => {
  console.error('cleanup failed', error);
  process.exit(1);
});

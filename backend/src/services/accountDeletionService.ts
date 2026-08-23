import admin from 'firebase-admin';
import { firestore, firebaseApp } from '../db/firestore';
import { supabaseFallbackService } from './supabaseFallbackService';
import { cancelBillingForAccountDeletion } from './billing/billingService';

const keyedCollections = [
  'users', 'profiles', 'loginPasswords', 'autopostJobs', 'socialIntegrations',
  'assistant_settings', 'assistant_strategies', 'secrets', 'outreachConsent',
  'creditBalances', 'metaAdsPolicies', 'metaAdsMcpConnections',
];

const ownedCollections = [
  'scheduledPosts', 'socialLimits', 'socialLogs', 'notifications', 'youtubeJobs',
  'usageDaily', 'usageMonthly', 'leads', 'conversations', 'messages', 'follow_ups',
  'follow_up_logs', 'outreach_logs', 'scheduler_bookings', 'bookings', 'offers',
  'prospects', 'outreach', 'engagements', 'qualificationSessions', 'bookingOffers',
  'adRuns', 'adCandidates', 'metaAdsApprovals', 'metaAdsAudit', 'orgUsers',
];

const deleteQuery = async (collection: string, field: string, userId: string) => {
  let deleted = 0;
  for (;;) {
    const snap = await firestore.collection(collection).where(field, '==', userId).limit(200).get();
    if (snap.empty) break;
    const batch = firestore.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 200) break;
  }
  return deleted;
};

const deleteVaultEntries = async (userId: string) => {
  const snap = await firestore.collection('vault')
    .where(admin.firestore.FieldPath.documentId(), '>=', `${userId}_`)
    .where(admin.firestore.FieldPath.documentId(), '<', `${userId}_\uf8ff`)
    .get();
  if (snap.empty) return 0;
  const batch = firestore.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
};

export async function deleteDottiAccount(userId: string) {
  if (!firebaseApp) throw new Error('Firebase is not initialized');

  // Prevent a paid subscription from renewing after the account disappears.
  await cancelBillingForAccountDeletion(userId);

  // Supabase is the primary data store in production. Do not delete the login
  // identity unless its user rows have been removed successfully.
  await supabaseFallbackService.deleteUserData(userId);

  for (const collection of ownedCollections) {
    await deleteQuery(collection, 'userId', userId);
  }
  await deleteVaultEntries(userId);

  for (const collection of keyedCollections) {
    const ref = firestore.collection(collection).doc(userId);
    await firestore.recursiveDelete(ref).catch(async () => ref.delete());
  }

  // Analytics and automation documents can contain nested collections.
  for (const collection of ['analytics', 'automations']) {
    const ref = firestore.collection(collection).doc(userId);
    await firestore.recursiveDelete(ref).catch(async () => ref.delete());
  }

  // Authentication is removed last so a failed data deletion remains retryable.
  await firebaseApp.auth().revokeRefreshTokens(userId);
  await firebaseApp.auth().deleteUser(userId);
  return { ok: true };
}

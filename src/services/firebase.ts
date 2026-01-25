import { v4 as uuid } from 'uuid';
import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut as firebaseSignOut,
  User as FirebaseUser,
  onAuthStateChanged,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { env } from '@services/env';
import type { AuthUser, CRMAnalytics, CRMData, Profile, SubscriptionStatus } from '@models/crm';

type Credentials = {
  user: AuthUser;
};

type ProfileDoc = {
  user?: AuthUser;
  subscriptionStatus?: SubscriptionStatus;
  crmData?: CRMData;
  onboardingComplete?: boolean;
};

const firebaseConfig: FirebaseOptions = {
  apiKey: env.firebaseApiKey || undefined,
  authDomain: env.firebaseAuthDomain || undefined,
  projectId: env.firebaseProjectId || undefined,
  appId: env.firebaseAppId || undefined,
  storageBucket: env.firebaseStorageBucket || undefined,
  messagingSenderId: env.firebaseMessagingSenderId || undefined,
  measurementId: env.firebaseMeasurementId || undefined
};

const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const allowMockAuth = env.offline;
const firebaseApp = firebaseEnabled
  ? getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig)
  : null;
const auth = firebaseApp ? getAuth(firebaseApp) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;
const useFirebase = Boolean(auth && db);

const mockDatabase: Record<string, Profile> = {};

const createAnalytics = (): CRMAnalytics => ({
  leads: 0,
  engagement: 0,
  conversions: 0,
  feedbackScore: 0
});

const delay = (ms = 650) => new Promise(resolve => setTimeout(resolve, ms));

const mapFirebaseUser = (user: FirebaseUser): AuthUser => ({
  uid: user.uid,
  email: user.email ?? 'member@dott-media.com',
  name: user.displayName ?? user.email ?? 'Dott Media Member',
  photoURL: user.photoURL ?? undefined
});

const mockSignUp = async (name: string, email: string): Promise<Credentials> => {
  await delay();
  const uid = uuid();
  const user: AuthUser = { uid, email, name };
  mockDatabase[uid] = {
    user,
    subscriptionStatus: 'active',
    onboardingComplete: true
  };
  return { user };
};

const mockSignIn = async (email: string): Promise<Credentials> => {
  await delay();
  const existingEntry = Object.values(mockDatabase).find(profile => profile.user.email === email);
  if (existingEntry) {
    return { user: existingEntry.user };
  }
  const uid = uuid();
  const user: AuthUser = {
    uid,
    email,
    name: 'Dott Media Member'
  };
  mockDatabase[uid] = {
    user,
    subscriptionStatus: 'trial',
    crmData: {
      companyName: 'Demo Company',
      email,
      phone: '+2348000000000',
      crmPrompt: 'Drive leads for demo campaign',
      isActive: true,
      analytics: createAnalytics()
    },
    onboardingComplete: true
  };
  return { user };
};

const mockPasswordReset = async (email: string): Promise<void> => {
  await delay(400);
  console.log(`Reset link sent to ${email}`);
};

const mockFetchProfile = async (uid: string): Promise<Profile> => {
  await delay(350);
  const profile = mockDatabase[uid];
  if (!profile) {
    const fallbackUser: AuthUser = { uid, email: 'member@dott-media.com', name: 'Dott Media Member' };
    mockDatabase[uid] = {
      user: fallbackUser,
      subscriptionStatus: 'trial',
      crmData: {
        companyName: 'Fallback Inc',
        email: fallbackUser.email,
        phone: '+2348000000000',
        crmPrompt: 'Scale AI content workflows',
        isActive: true,
        analytics: createAnalytics()
      },
      onboardingComplete: true
    };
    return mockDatabase[uid];
  }
  if (profile.crmData) {
    profile.crmData.analytics = createAnalytics();
  }
  return profile;
};

const mockPersistCRMData = async (uid: string, data: CRMData): Promise<void> => {
  await delay(300);
  const profile = mockDatabase[uid];
  if (!profile) {
    throw new Error('User profile not found');
  }
  profile.crmData = data;
  profile.onboardingComplete = true;
};

const mockUpdateSubscription = (uid: string, status: SubscriptionStatus) => {
  const profile = mockDatabase[uid];
  if (profile) {
    profile.subscriptionStatus = status;
  }
};

const profileRef = (uid: string) => {
  if (!db) {
    throw new Error('Firestore not initialized');
  }
  return doc(db, 'profiles', uid);
};

const defaultUser = (uid: string): AuthUser => {
  if (auth?.currentUser && auth.currentUser.uid === uid) {
    return mapFirebaseUser(auth.currentUser);
  }
  return { uid, email: 'member@dott-media.com', name: 'Dott Media Member' };
};

const normalizeProfile = (data: ProfileDoc | undefined, fallbackUser: AuthUser): Profile => ({
  user: data?.user ?? fallbackUser,
  subscriptionStatus: data?.subscriptionStatus ?? 'none',
  crmData: data?.crmData,
  onboardingComplete: data?.onboardingComplete ?? Boolean(data?.crmData)
});

const ensureProfileDoc = async (
  uid: string,
  user: AuthUser,
  options?: { subscriptionStatus?: SubscriptionStatus; onboardingComplete?: boolean }
) => {
  if (!useFirebase) return;
  const payload: Record<string, unknown> = {
    user,
    lastLoginAt: serverTimestamp()
  };
  if (options?.subscriptionStatus !== undefined) {
    payload.subscriptionStatus = options.subscriptionStatus;
  }
  if (typeof options?.onboardingComplete === 'boolean') {
    payload.onboardingComplete = options.onboardingComplete;
  }
  await setDoc(
    profileRef(uid),
    payload,
    { merge: true }
  );
};

const userRef = (uid: string) => {
  if (!db) {
    throw new Error('Firestore not initialized');
  }
  return doc(db, 'users', uid);
};

const upsertUserRecord = async (user: AuthUser, provider: string, isNew: boolean) => {
  if (!useFirebase) return;
  const payload: Record<string, unknown> = {
    uid: user.uid,
    name: user.name,
    email: user.email,
    photoURL: user.photoURL ?? null,
    authProvider: provider,
    lastLoginAt: serverTimestamp()
  };
  if (isNew) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(userRef(user.uid), payload, { merge: true });
};

const requireFirebaseAuth = () => {
  if (useFirebase || allowMockAuth) return;
  throw new Error('Firebase authentication is not configured.');
};

export const signUp = async (name: string, email: string, password: string): Promise<Credentials> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth) {
    return mockSignUp(name, email);
  }
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (credential.user && credential.user.displayName !== name) {
    await updateProfile(credential.user, { displayName: name }).catch(() => undefined);
  }
  const mappedUser = mapFirebaseUser(credential.user);
  const user = { ...mappedUser, name: name.trim() || mappedUser.name };
  await ensureProfileDoc(user.uid, user, { subscriptionStatus: 'active', onboardingComplete: true });
  await upsertUserRecord(user, 'password', true);
  return { user };
};

export const signIn = async (email: string, password: string): Promise<Credentials> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth) {
    return mockSignIn(email);
  }
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const user = mapFirebaseUser(credential.user);
  await ensureProfileDoc(user.uid, user);
  await upsertUserRecord(user, 'password', false);
  return { user };
};

type SocialProvider = 'google' | 'facebook';

const makeProvider = (provider: SocialProvider) => {
  switch (provider) {
    case 'google':
      return new GoogleAuthProvider();
    case 'facebook':
      return new FacebookAuthProvider();
    default:
      throw new Error('Unsupported provider');
  }
};

export const signInWithSocial = async (provider: SocialProvider): Promise<Credentials> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth) {
    return mockSignIn(`${provider}@dott-media.com`);
  }
  // Web-only guard; native uses mock for now.
  if (typeof window === 'undefined' || typeof signInWithPopup !== 'function') {
    return mockSignIn(`${provider}@dott-media.com`);
  }
  const credential = await signInWithPopup(auth, makeProvider(provider));
  const user = mapFirebaseUser(credential.user);
  await ensureProfileDoc(user.uid, user);
  const meta = credential.user.metadata;
  const isNew = Boolean(meta?.creationTime && meta?.lastSignInTime && meta.creationTime === meta.lastSignInTime);
  await upsertUserRecord(user, provider, isNew);
  return { user };
};

export const sendPasswordReset = async (email: string): Promise<void> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth) {
    await mockPasswordReset(email);
    return;
  }
  await sendPasswordResetEmail(auth, email);
};

export const fetchProfile = async (uid: string): Promise<Profile> => {
  requireFirebaseAuth();
  if (!useFirebase) {
    return mockFetchProfile(uid);
  }
  const fallback = defaultUser(uid);
  const snapshot = await getDoc(profileRef(uid));
  if (!snapshot.exists()) {
    const profile = normalizeProfile(undefined, fallback);
    await setDoc(profileRef(uid), profile, { merge: true });
    return profile;
  }
  return normalizeProfile(snapshot.data() as ProfileDoc, fallback);
};

export const persistCRMData = async (uid: string, data: CRMData): Promise<void> => {
  requireFirebaseAuth();
  if (!useFirebase) {
    await mockPersistCRMData(uid, data);
    return;
  }
  await setDoc(
    profileRef(uid),
    {
      crmData: data,
      onboardingComplete: true
    },
    { merge: true }
  );
};

export const updateSubscription = async (uid: string, status: SubscriptionStatus): Promise<void> => {
  requireFirebaseAuth();
  if (!useFirebase) {
    mockUpdateSubscription(uid, status);
    return;
  }
  await updateDoc(profileRef(uid), { subscriptionStatus: status });
};

export const signOutUser = async () => {
  requireFirebaseAuth();
  if (!useFirebase || !auth) {
    return;
  }
  await firebaseSignOut(auth);
};

export const realtimeDb = db;
export const isFirebaseEnabled = useFirebase;

export const observeAuthState = (
  handler: (user: AuthUser | null) => void
): (() => void) => {
  if (!useFirebase || !auth) {
    if (!allowMockAuth) {
      handler(null);
    }
    return () => undefined;
  }
  return onAuthStateChanged(auth, user => handler(user ? mapFirebaseUser(user) : null));
};

export const getIdToken = async (): Promise<string | null> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth?.currentUser) {
    return null;
  }
  return auth.currentUser.getIdToken();
};

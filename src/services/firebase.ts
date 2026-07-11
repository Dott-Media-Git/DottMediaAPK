import { v4 as uuid } from 'uuid';
import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  reload,
  updateProfile,
  signOut as firebaseSignOut,
  User as FirebaseUser,
  onAuthStateChanged,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
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
  isAdmin?: boolean;
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
let authBootstrapPromise: Promise<void> | null = null;
const mockDatabase: Record<string, Profile> = {};

const createAnalytics = (): CRMAnalytics => ({
  leads: 0,
  engagement: 0,
  conversions: 0,
  feedbackScore: 0
});

const delay = (ms = 650) => new Promise(resolve => setTimeout(resolve, ms));

const mapFirebaseUser = (user: FirebaseUser): AuthUser => {
  const photoURL = typeof user.photoURL === 'string' ? user.photoURL.trim() : '';
  return {
    uid: user.uid,
    email: user.email ?? 'member@dott-media.com',
    name: user.displayName ?? user.email ?? 'Dott Media Member',
    emailVerified: user.emailVerified,
    phoneNumber: user.phoneNumber ?? undefined,
    phoneVerified: Boolean(user.phoneNumber),
    ...(photoURL ? { photoURL } : {})
  };
};

const sanitizeAuthUser = (user: AuthUser): AuthUser => {
  const photoURL = typeof user.photoURL === 'string' ? user.photoURL.trim() : '';
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    ...(typeof user.emailVerified === 'boolean' ? { emailVerified: user.emailVerified } : {}),
    ...(typeof user.phoneNumber === 'string' ? { phoneNumber: user.phoneNumber } : {}),
    ...(typeof user.phoneVerified === 'boolean' ? { phoneVerified: user.phoneVerified } : {}),
    ...(photoURL ? { photoURL } : {}),
    ...(user.isAdmin ? { isAdmin: true } : {})
  };
};

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
  user: sanitizeAuthUser({
    ...(data?.user ?? fallbackUser),
    ...(typeof fallbackUser.emailVerified === 'boolean'
      ? { emailVerified: fallbackUser.emailVerified }
      : {}),
    ...(data?.isAdmin ? { isAdmin: true } : {})
  }),
  subscriptionStatus: data?.subscriptionStatus ?? 'none',
  ...(data?.crmData ? { crmData: data.crmData } : {}),
  onboardingComplete: data?.onboardingComplete ?? Boolean(data?.crmData)
});

const ensureProfileDoc = async (
  uid: string,
  user: AuthUser,
  options?: { subscriptionStatus?: SubscriptionStatus; onboardingComplete?: boolean }
) => {
  if (!useFirebase) return;
  const payload: Record<string, unknown> = {
    user: sanitizeAuthUser(user),
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
  await requestBrandedVerificationEmail();
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
    const payload: Record<string, unknown> = {
      user: sanitizeAuthUser(profile.user),
      subscriptionStatus: profile.subscriptionStatus,
      onboardingComplete: profile.onboardingComplete
    };
    if (profile.crmData) {
      payload.crmData = profile.crmData;
    }
    await setDoc(profileRef(uid), payload, { merge: true });
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

export const resendVerificationEmail = async (): Promise<void> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth?.currentUser) return;
  await reload(auth.currentUser);
  if (auth.currentUser.emailVerified) return;
  await requestBrandedVerificationEmail();
};

const requestBrandedVerificationEmail = async (): Promise<void> => {
  if (!auth?.currentUser) throw new Error('Sign in before requesting verification.');
  const token = await auth.currentUser.getIdToken();
  const baseUrl = env.apiUrl || 'https://dottmediaapk.onrender.com';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/send-verification-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || 'Unable to send verification email.');
  }
};

export const refreshVerifiedUser = async (): Promise<AuthUser | null> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth?.currentUser) return null;
  await reload(auth.currentUser);
  return mapFirebaseUser(auth.currentUser);
};

export const startPhoneVerification = async (phoneNumber: string): Promise<void> => {
  requireFirebaseAuth();
  if (!auth?.currentUser) throw new Error('Sign in before verifying your phone.');
  const trimmedPhone = phoneNumber.trim();
  const token = await auth.currentUser.getIdToken();
  const baseUrl = env.apiUrl || 'https://dottmediaapk.onrender.com';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/send-phone-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: trimmedPhone }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || 'Unable to send the SMS verification code.');
  }
};

export const confirmPhoneVerification = async (code: string): Promise<AuthUser> => {
  requireFirebaseAuth();
  if (!auth?.currentUser) throw new Error('Sign in before verifying your phone.');
  const token = await auth.currentUser.getIdToken();
  const baseUrl = env.apiUrl || 'https://dottmediaapk.onrender.com';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/confirm-phone-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  });
  const body = await response.json().catch(() => ({})) as {
    message?: string;
    phoneNumber?: string;
    phoneVerified?: boolean;
  };
  if (!response.ok) {
    throw new Error(body.message || 'Unable to verify that code.');
  }
  await reload(auth.currentUser);
  return {
    ...mapFirebaseUser(auth.currentUser),
    ...(body.phoneNumber ? { phoneNumber: body.phoneNumber } : {}),
    phoneVerified: body.phoneVerified ?? true,
  };
};

export type EditableAccountProfile = {
  name: string;
  photoURL?: string;
  companyName: string;
  contactEmail: string;
  phone: string;
  website?: string;
  businessAddress?: string;
  jobTitle?: string;
  bio?: string;
};

export const uploadProfileImage = async (uid: string, uri: string): Promise<string> => {
  requireFirebaseAuth();
  void uid;
  if (!uri.startsWith('data:image/')) {
    throw new Error('The selected profile image could not be encoded.');
  }
  if (uri.length > 700_000) {
    throw new Error('Profile image is too large. Choose an image under 500 KB.');
  }
  return uri;
};

export const saveAccountProfile = async (
  uid: string,
  currentUser: AuthUser,
  currentCRM: CRMData | undefined,
  input: EditableAccountProfile,
): Promise<{ user: AuthUser; crmData: CRMData }> => {
  requireFirebaseAuth();
  const user: AuthUser = sanitizeAuthUser({
    ...currentUser,
    name: input.name.trim(),
    ...(input.photoURL?.trim() ? { photoURL: input.photoURL.trim() } : {}),
  });
  const crmData: CRMData = {
    ...(currentCRM ?? {}),
    companyName: input.companyName.trim(),
    email: input.contactEmail.trim(),
    phone: input.phone.trim(),
    crmPrompt: currentCRM?.crmPrompt ?? '',
    isActive: currentCRM?.isActive ?? true,
    analytics: currentCRM?.analytics ?? createAnalytics(),
    website: input.website?.trim() ?? '',
    businessAddress: input.businessAddress?.trim() ?? '',
    jobTitle: input.jobTitle?.trim() ?? '',
    bio: input.bio?.trim() ?? '',
  };

  if (!useFirebase) {
    mockDatabase[uid] = {
      ...(mockDatabase[uid] ?? { subscriptionStatus: 'trial', onboardingComplete: true }),
      user,
      crmData,
    };
    return { user, crmData };
  }

  if (auth?.currentUser?.uid === uid) {
    await updateProfile(auth.currentUser, {
      displayName: user.name,
      ...(user.photoURL?.startsWith('data:') ? {} : { photoURL: user.photoURL ?? null }),
    });
  }
  await Promise.all([
    setDoc(profileRef(uid), { user, crmData, updatedAt: serverTimestamp() }, { merge: true }),
    setDoc(
      userRef(uid),
      {
        name: user.name,
        photoURL: user.photoURL ?? null,
        companyName: crmData.companyName,
        contactEmail: crmData.email,
        phone: crmData.phone,
        website: crmData.website ?? '',
        businessAddress: crmData.businessAddress ?? '',
        jobTitle: crmData.jobTitle ?? '',
        bio: crmData.bio ?? '',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ),
  ]);
  return { user, crmData };
};

const waitForAuthBootstrap = async (timeoutMs = 3000) => {
  if (!useFirebase || !auth || auth.currentUser) {
    return;
  }

  if (!authBootstrapPromise) {
    authBootstrapPromise = new Promise(resolve => {
      let resolved = false;
      const finalize = () => {
        if (resolved) return;
        resolved = true;
        authBootstrapPromise = null;
        resolve();
      };
      const unsubscribe = onAuthStateChanged(
        auth,
        () => {
          unsubscribe();
          finalize();
        },
        () => {
          unsubscribe();
          finalize();
        },
      );
      setTimeout(() => {
        unsubscribe();
        finalize();
      }, timeoutMs);
    });
  }

  await authBootstrapPromise;
};

export const getIdToken = async (): Promise<string | null> => {
  requireFirebaseAuth();
  if (!useFirebase || !auth) {
    return null;
  }
  if (!auth.currentUser) {
    await waitForAuthBootstrap();
  }
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
};

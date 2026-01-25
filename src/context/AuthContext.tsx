import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import {
  signIn as authSignIn,
  signUp as authSignUp,
  sendPasswordReset as authPasswordReset,
  fetchProfile,
  persistCRMData,
  updateSubscription,
  signOutUser,
  observeAuthState
} from '@services/firebase';
import {
  sendCRMSetup,
  sendCRMToggle,
  sendCRMPromptUpdate,
  sendSubscriptionActivated
} from '@services/make';
import { scheduleWelcomeNotification } from '@services/notifications';
import type { AuthUser, CRMAnalytics, CRMData, SubscriptionStatus } from '@models/crm';
import { signInWithSocial } from '@services/firebase';

export type { AuthUser, CRMAnalytics, CRMData, SubscriptionStatus } from '@models/crm';

type AuthState = {
  user: AuthUser | null;
  subscriptionStatus: SubscriptionStatus;
  crmData?: CRMData;
  onboardingComplete: boolean;
  loading: boolean;
};

type SignInPayload = {
  user: AuthUser;
  subscriptionStatus: SubscriptionStatus;
  crmData?: CRMData;
  onboardingComplete: boolean;
};

type AuthAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SIGN_IN'; payload: SignInPayload }
  | { type: 'SIGN_OUT' }
  | { type: 'UPDATE_SUBSCRIPTION'; payload: SubscriptionStatus }
  | { type: 'UPDATE_CRM_DATA'; payload: Partial<CRMData> & { onboardingComplete?: boolean } }
  | { type: 'UPDATE_ANALYTICS'; payload: CRMAnalytics }
  | { type: 'TOGGLE_CRM'; payload: boolean };

const initialAnalytics: CRMAnalytics = {
  leads: 0,
  engagement: 0,
  conversions: 0,
  feedbackScore: 0
};

const initialState: AuthState = {
  user: null,
  subscriptionStatus: 'none',
  crmData: undefined,
  onboardingComplete: false,
  loading: false
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthContextValue = {
  state: AuthState;
  isAuthenticated: boolean;
  needsSubscription: boolean;
  needsOnboarding: boolean;
  orgId?: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => void;
  startSubscription: () => Promise<void>;
  submitCRMSetup: (data: Omit<CRMData, 'crmPrompt' | 'analytics' | 'isActive'> & { crmPrompt: string }) => Promise<void>;
  toggleCRM: (isActive: boolean) => Promise<void>;
  updateCRMPrompt: (prompt: string) => Promise<void>;
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SIGN_IN':
      return {
        ...state,
        user: action.payload.user,
        subscriptionStatus: action.payload.subscriptionStatus,
        crmData: action.payload.crmData,
        onboardingComplete: action.payload.onboardingComplete,
        loading: false
      };
    case 'SIGN_OUT':
      return initialState;
    case 'UPDATE_SUBSCRIPTION':
      return { ...state, subscriptionStatus: action.payload };
    case 'UPDATE_CRM_DATA': {
      const updatedData = { ...state.crmData, ...action.payload } as CRMData;
      const onboardingComplete = action.payload.onboardingComplete ?? state.onboardingComplete;
      return { ...state, crmData: updatedData, onboardingComplete };
    }
    case 'UPDATE_ANALYTICS':
      return state.crmData
        ? { ...state, crmData: { ...state.crmData, analytics: action.payload } }
        : state;
    case 'TOGGLE_CRM':
      return state.crmData ? { ...state, crmData: { ...state.crmData, isActive: action.payload } } : state;
    default:
      return state;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const unsubscribe = observeAuthState(async authUser => {
      if (!authUser) {
        dispatch({ type: 'SIGN_OUT' });
        return;
      }
      try {
        const profile = await fetchProfile(authUser.uid);
        dispatch({
          type: 'SIGN_IN',
          payload: {
            user: profile.user,
            subscriptionStatus: profile.subscriptionStatus,
            crmData: profile.crmData,
            onboardingComplete: profile.onboardingComplete
          }
        });
      } catch (error) {
        console.warn('Failed to hydrate auth profile', error);
        dispatch({
          type: 'SIGN_IN',
          payload: {
            user: authUser,
            subscriptionStatus: 'active',
            onboardingComplete: true
          }
        });
      }
    });
    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const credentials = await authSignIn(email, password);
      let profile: {
        user: AuthUser;
        subscriptionStatus: SubscriptionStatus;
        crmData?: CRMData;
        onboardingComplete: boolean;
      };
      try {
        profile = await fetchProfile(credentials.user.uid);
      } catch (error) {
        console.warn('Failed to load profile after sign-in', error);
        profile = {
          user: credentials.user,
          subscriptionStatus: 'active',
          onboardingComplete: true
        };
      }
      dispatch({
        type: 'SIGN_IN',
        payload: {
          user: profile.user,
          subscriptionStatus: profile.subscriptionStatus,
          crmData: profile.crmData,
          onboardingComplete: profile.onboardingComplete
        }
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const signUp = async (name: string, email: string, password: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const credentials = await authSignUp(name, email, password);
      await scheduleWelcomeNotification(credentials.user.name);
      let profile: {
        user: AuthUser;
        subscriptionStatus: SubscriptionStatus;
        crmData?: CRMData;
        onboardingComplete: boolean;
      };
      try {
        profile = await fetchProfile(credentials.user.uid);
      } catch (error) {
        console.warn('Failed to load profile after signup', error);
        profile = {
          user: credentials.user,
          subscriptionStatus: 'active',
          onboardingComplete: true
        };
      }
      dispatch({
        type: 'SIGN_IN',
        payload: {
          user: profile.user,
          subscriptionStatus: profile.subscriptionStatus,
          crmData: profile.crmData,
          onboardingComplete: profile.onboardingComplete
        }
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const sendPasswordReset = async (email: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await authPasswordReset(email);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const signInWithGoogle = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const credentials = await signInWithSocial('google');
      const profile = await fetchProfile(credentials.user.uid);
      dispatch({
        type: 'SIGN_IN',
        payload: {
          user: profile.user,
          subscriptionStatus: profile.subscriptionStatus,
          crmData: profile.crmData,
          onboardingComplete: profile.onboardingComplete
        }
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const signInWithFacebook = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const credentials = await signInWithSocial('facebook');
      const profile = await fetchProfile(credentials.user.uid);
      dispatch({
        type: 'SIGN_IN',
        payload: {
          user: profile.user,
          subscriptionStatus: profile.subscriptionStatus,
          crmData: profile.crmData,
          onboardingComplete: profile.onboardingComplete
        }
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const signOut = () => {
    void signOutUser();
    dispatch({ type: 'SIGN_OUT' });
  };

  const startSubscription = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      if (state.user) {
        await updateSubscription(state.user.uid, 'active');
        await sendSubscriptionActivated({
          uid: state.user.uid,
          email: state.user.email,
          name: state.user.name
        });
      }
      dispatch({ type: 'UPDATE_SUBSCRIPTION', payload: 'active' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const submitCRMSetup: AuthContextValue['submitCRMSetup'] = async data => {
    if (!state.user) return;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await sendCRMSetup({ ...data, uid: state.user.uid });
      const payload: CRMData = {
        companyName: data.companyName,
        email: data.email,
        phone: data.phone,
        instagram: data.instagram,
        facebook: data.facebook,
        linkedin: data.linkedin,
        targetAudience: data.targetAudience,
        businessGoals: data.businessGoals,
        crmPrompt: data.crmPrompt,
        isActive: true,
        analytics: initialAnalytics
      };
      await persistCRMData(state.user.uid, payload);
      dispatch({
        type: 'UPDATE_CRM_DATA',
        payload: { ...payload, onboardingComplete: true }
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const toggleCRM = async (isActive: boolean) => {
    if (!state.user || !state.crmData) return;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await sendCRMToggle({ uid: state.user.uid, isActive });
      dispatch({ type: 'TOGGLE_CRM', payload: isActive });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const updateCRMPrompt = async (prompt: string) => {
    if (!state.user || !state.crmData) return;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await sendCRMPromptUpdate({ uid: state.user.uid, prompt });
      dispatch({ type: 'UPDATE_CRM_DATA', payload: { crmPrompt: prompt } });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      isAuthenticated: Boolean(state.user),
      needsSubscription: Boolean(state.user) && state.subscriptionStatus !== 'active',
      needsOnboarding: Boolean(state.user) && state.subscriptionStatus === 'active' && !state.onboardingComplete,
      orgId: ((state.user as any)?.orgId ?? state.crmData?.orgId ?? 'demo') as string,
      signIn,
      signUp,
      signInWithGoogle,
      signInWithFacebook,
      sendPasswordReset,
      signOut,
      startSubscription,
      submitCRMSetup,
      toggleCRM,
      updateCRMPrompt
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};


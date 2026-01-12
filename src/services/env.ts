import Constants from 'expo-constants';

type ExtraConfig = {
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_MEASUREMENT_ID?: string;
  STRIPE_API_KEY?: string;
  MAKE_WEBHOOK_URL?: string;
  API_URL?: string;
  HELP_DOCS_URL?: string;
  ANALYTICS_ORG_ID?: string;
  ANALYTICS_USER_ID?: string;
  EXPO_OFFLINE?: string;
  EXPO_PUBLIC_DEBUG_TOOLS?: string;
};

const extra = (Constants?.expoConfig?.extra ?? {}) as ExtraConfig;

export const env = {
  firebaseApiKey:
    extra.FIREBASE_API_KEY ?? process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? process.env.FIREBASE_API_KEY ?? '',
  firebaseProjectId:
    extra.FIREBASE_PROJECT_ID ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? '',
  firebaseAuthDomain:
    extra.FIREBASE_AUTH_DOMAIN ?? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? process.env.FIREBASE_AUTH_DOMAIN ?? '',
  firebaseAppId:
    extra.FIREBASE_APP_ID ?? process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? process.env.FIREBASE_APP_ID ?? '',
  firebaseStorageBucket:
    extra.FIREBASE_STORAGE_BUCKET ?? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? process.env.FIREBASE_STORAGE_BUCKET ?? '',
  firebaseMessagingSenderId:
    extra.FIREBASE_MESSAGING_SENDER_ID ?? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? process.env.FIREBASE_MESSAGING_SENDER_ID ?? '',
  firebaseMeasurementId:
    extra.FIREBASE_MEASUREMENT_ID ?? process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? process.env.FIREBASE_MEASUREMENT_ID ?? '',
  stripeApiKey: extra.STRIPE_API_KEY ?? process.env.STRIPE_API_KEY ?? '',
  makeWebhookUrl: extra.MAKE_WEBHOOK_URL ?? process.env.MAKE_WEBHOOK_URL ?? '',
  apiUrl: extra.API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? process.env.API_URL ?? '',
  helpDocsUrl: extra.HELP_DOCS_URL ?? process.env.EXPO_PUBLIC_HELP_DOCS_URL ?? process.env.HELP_DOCS_URL ?? '',
  analyticsOrgId:
    extra.ANALYTICS_ORG_ID ?? process.env.EXPO_PUBLIC_ANALYTICS_ORG_ID ?? process.env.ANALYTICS_ORG_ID ?? '',
  analyticsUserId:
    extra.ANALYTICS_USER_ID ?? process.env.EXPO_PUBLIC_ANALYTICS_USER_ID ?? process.env.ANALYTICS_USER_ID ?? '',
  offline: String(extra.EXPO_OFFLINE ?? process.env.EXPO_OFFLINE ?? '').toLowerCase() === 'true',
  debugTools:
    String(
      extra.EXPO_PUBLIC_DEBUG_TOOLS ??
        process.env.EXPO_PUBLIC_DEBUG_TOOLS ??
        process.env.DEBUG_TOOLS ??
        '',
    ).toLowerCase() === 'true'
};

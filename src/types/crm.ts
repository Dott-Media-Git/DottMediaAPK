export type SubscriptionStatus = 'none' | 'trial' | 'active' | 'past_due';

export type CRMAnalytics = {
  leads: number;
  engagement: number;
  conversions: number;
  feedbackScore: number;
};

export type CRMData = {
  companyName: string;
  email: string;
  phone: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  targetAudience?: string;
  businessGoals?: string;
  crmPrompt: string;
  isActive: boolean;
  analytics: CRMAnalytics;
};

export type AuthUser = {
  uid: string;
  email: string;
  name: string;
};

export type Profile = {
  user: AuthUser;
  subscriptionStatus: SubscriptionStatus;
  crmData?: CRMData;
  onboardingComplete: boolean;
};

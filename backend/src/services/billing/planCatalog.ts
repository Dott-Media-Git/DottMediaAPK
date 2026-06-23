import { OrgPlan } from '../../types/org';

export type DottPlanId = 'free' | 'starter' | 'creator' | 'business' | 'agency' | 'enterprise';

export type UsageResource =
  | 'aiReplies'
  | 'images'
  | 'basicVideos'
  | 'proVideos'
  | 'scheduledPosts'
  | 'connectedSocials';

export type PlanLimits = Record<UsageResource, number | null> & {
  teamSeats: number | null;
  priorityQueue: boolean;
};

export type PlanDefinition = {
  id: DottPlanId;
  orgPlan: OrgPlan;
  name: string;
  priceMonthlyCents: number | null;
  stripePriceEnv?: string;
  description: string;
  limits: PlanLimits;
};

export const planCatalog: PlanDefinition[] = [
  {
    id: 'free',
    orgPlan: 'Free',
    name: 'Free',
    priceMonthlyCents: 0,
    description: 'Strict trial plan with limited AI and no video generation.',
    limits: {
      aiReplies: 10,
      images: 1,
      basicVideos: 0,
      proVideos: 0,
      scheduledPosts: 5,
      connectedSocials: 2,
      teamSeats: 1,
      priorityQueue: false,
    },
  },
  {
    id: 'starter',
    orgPlan: 'Starter',
    name: 'Starter',
    priceMonthlyCents: 999,
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
    description: 'Entry plan for creators and small teams.',
    limits: {
      aiReplies: 500,
      images: 25,
      basicVideos: 2,
      proVideos: 0,
      scheduledPosts: 100,
      connectedSocials: 3,
      teamSeats: 1,
      priorityQueue: false,
    },
  },
  {
    id: 'creator',
    orgPlan: 'Creator',
    name: 'Creator',
    priceMonthlyCents: 4900,
    stripePriceEnv: 'STRIPE_PRICE_CREATOR',
    description: 'Main creator plan with meaningful AI and media capacity.',
    limits: {
      aiReplies: 2000,
      images: 100,
      basicVideos: 10,
      proVideos: 0,
      scheduledPosts: 500,
      connectedSocials: 8,
      teamSeats: 2,
      priorityQueue: false,
    },
  },
  {
    id: 'business',
    orgPlan: 'Business',
    name: 'Business',
    priceMonthlyCents: 9900,
    stripePriceEnv: 'STRIPE_PRICE_BUSINESS',
    description: 'For active brands needing higher posting and content capacity.',
    limits: {
      aiReplies: 5000,
      images: 300,
      basicVideos: 20,
      proVideos: 0,
      scheduledPosts: 1500,
      connectedSocials: 20,
      teamSeats: 5,
      priorityQueue: true,
    },
  },
  {
    id: 'agency',
    orgPlan: 'Agency',
    name: 'Agency',
    priceMonthlyCents: 39900,
    stripePriceEnv: 'STRIPE_PRICE_AGENCY',
    description: 'High-volume plan for agencies managing multiple brands.',
    limits: {
      aiReplies: 15000,
      images: 1000,
      basicVideos: 50,
      proVideos: 10,
      scheduledPosts: 5000,
      connectedSocials: 75,
      teamSeats: 20,
      priorityQueue: true,
    },
  },
  {
    id: 'enterprise',
    orgPlan: 'Enterprise',
    name: 'Enterprise',
    priceMonthlyCents: null,
    stripePriceEnv: 'STRIPE_PRICE_ENTERPRISE',
    description: 'Custom contract with negotiated limits and dedicated support.',
    limits: {
      aiReplies: null,
      images: null,
      basicVideos: null,
      proVideos: null,
      scheduledPosts: null,
      connectedSocials: null,
      teamSeats: null,
      priorityQueue: true,
    },
  },
];

export const normalizePlanId = (value: unknown): DottPlanId => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'pro') return 'creator';
  if (raw === 'starter' || raw === 'creator' || raw === 'business' || raw === 'agency' || raw === 'enterprise') {
    return raw;
  }
  return 'free';
};

export const getPlan = (value: unknown): PlanDefinition => {
  const id = normalizePlanId(value);
  return planCatalog.find(plan => plan.id === id) ?? planCatalog[0];
};

export const getStripePriceId = (plan: PlanDefinition) => {
  if (!plan.stripePriceEnv) return null;
  return process.env[plan.stripePriceEnv]?.trim() || null;
};


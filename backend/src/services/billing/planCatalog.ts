import { OrgPlan } from '../../types/org';

export type DottPlanId = 'free' | 'creator' | 'enterprise';

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
  estimatedCostsCents?: {
    openAi: number;
    backend: number;
    otherOps: number;
  };
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
    estimatedCostsCents: { openAi: 8, backend: 5, otherOps: 2 },
    description: 'Start with the essential AI and social tools at no cost.',
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
    id: 'creator',
    orgPlan: 'Creator',
    name: 'Creator',
    priceMonthlyCents: 4900,
    estimatedCostsCents: { openAi: 1825, backend: 145, otherOps: 80 },
    stripePriceEnv: 'STRIPE_PRICE_CREATOR',
    description: 'Create, schedule, and grow with higher AI and media capacity.',
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
    id: 'enterprise',
    orgPlan: 'Enterprise',
    name: 'Enterprise',
    priceMonthlyCents: null,
    stripePriceEnv: 'STRIPE_PRICE_ENTERPRISE',
    description: 'Custom scale, onboarding, limits, and dedicated support.',
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
  if (raw === 'pro' || raw === 'starter' || raw === 'creator') return 'creator';
  if (raw === 'business' || raw === 'agency' || raw === 'enterprise') return 'enterprise';
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

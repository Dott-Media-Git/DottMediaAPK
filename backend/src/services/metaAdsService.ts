import admin from 'firebase-admin';
import axios from 'axios';
import createHttpError from 'http-errors';
import { firestore } from '../db/firestore.js';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const boostRulesCollection = firestore.collection('boostRules');
const adRunsCollection = firestore.collection('adRuns');
const SHECARE_USER_ID = 'tCE1FQ1cOFgdupOXP23mPUMQRAz1';
const SHECARE_WHATSAPP_NUMBER = '+447463010235';

export type BoostRule = {
  userId: string;
  enabled: boolean;
  mode: 'manual' | 'auto';
  adAccountId?: string | null;
  pageId?: string | null;
  instagramActorId?: string | null;
  accessToken?: string | null;
  whatsappNumber?: string | null;
  whatsappLink?: string | null;
  dailyBudgetUsd?: number;
  dailyBudgetMinor?: number;
  durationHours?: number;
  currency?: string | null;
  objective?: string;
  billingEvent?: string;
  optimizationGoal?: string;
  statusOnCreate?: 'PAUSED' | 'ACTIVE';
  audience?: {
    countries?: string[];
    ageMin?: number;
    ageMax?: number;
  };
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
};

type BoostPublishedPostInput = {
  userId: string;
  platform: string;
  postId: string;
  caption: string;
  imageUrl?: string | null;
};

type ManualBoostInput = BoostPublishedPostInput & {
  adAccountId?: string;
  dailyBudgetUsd?: number;
  dailyBudgetMinor?: number;
  durationHours?: number;
  whatsappNumber?: string;
};

const normalizeAdAccountId = (value?: string | null) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
};

const normalizeWhatsappNumber = (value?: string | null) => String(value ?? '').replace(/[^\d+]/g, '');

const toUsdBudget = (value?: number | null) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(Math.round(numeric * 100) / 100, 1);
};

const budgetUsdFromRule = (rule: Partial<BoostRule>) => {
  if (typeof rule.dailyBudgetUsd === 'number') return toUsdBudget(rule.dailyBudgetUsd);
  if (typeof rule.dailyBudgetMinor === 'number') return toUsdBudget(rule.dailyBudgetMinor / 100);
  return 5;
};

const budgetMinorFromUsd = (value?: number | null) => Math.max(Math.round(toUsdBudget(value) * 100), 100);

export const buildWhatsappLink = (phone?: string | null, text?: string) => {
  const normalized = normalizeWhatsappNumber(phone);
  if (!normalized) return '';
  const digits = normalized.replace(/^\+/, '');
  const url = new URL(`https://wa.me/${digits}`);
  if (text?.trim()) {
    url.searchParams.set('text', text.trim());
  }
  return url.toString();
};

const resolveToken = (rule: BoostRule) => String(rule.accessToken || process.env.META_GRAPH_TOKEN || '').trim();

const resolveRule = async (userId: string) => {
  const snap = await boostRulesCollection.doc(userId).get();
  if (!snap.exists) return null;
  return snap.data() as BoostRule;
};

const loadUserSocialAccounts = async (userId: string) => {
  const snap = await firestore.collection('users').doc(userId).get();
  return (snap.data()?.socialAccounts ?? {}) as Record<string, any>;
};

const createCampaign = async (rule: BoostRule, accessToken: string) => {
  const adAccountId = normalizeAdAccountId(rule.adAccountId);
  const response = await axios.post(`${GRAPH_BASE}/${adAccountId}/campaigns`, null, {
    params: {
      name: `DottMedia Boost ${new Date().toISOString()}`,
      objective: rule.objective ?? 'OUTCOME_ENGAGEMENT',
      status: 'PAUSED',
      special_ad_categories: JSON.stringify([]),
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return String(response.data?.id ?? '');
};

const createAdSet = async (rule: BoostRule, campaignId: string, accessToken: string) => {
  const adAccountId = normalizeAdAccountId(rule.adAccountId);
  const start = new Date(Date.now() + 5 * 60 * 1000);
  const end = new Date(Date.now() + Math.max(rule.durationHours ?? 24, 1) * 60 * 60 * 1000);
  const targeting = {
    geo_locations: { countries: rule.audience?.countries?.length ? rule.audience.countries : ['UG'] },
    age_min: rule.audience?.ageMin ?? 18,
    age_max: rule.audience?.ageMax ?? 65,
  };
  const response = await axios.post(`${GRAPH_BASE}/${adAccountId}/adsets`, null, {
    params: {
      name: `DottMedia Auto Boost ${start.toISOString()}`,
      campaign_id: campaignId,
      daily_budget: budgetMinorFromUsd(budgetUsdFromRule(rule)),
      billing_event: rule.billingEvent ?? 'IMPRESSIONS',
      optimization_goal: rule.optimizationGoal ?? 'POST_ENGAGEMENT',
      targeting: JSON.stringify(targeting),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'PAUSED',
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return String(response.data?.id ?? '');
};

const createCreative = async (rule: BoostRule, input: BoostPublishedPostInput, accessToken: string) => {
  const adAccountId = normalizeAdAccountId(rule.adAccountId);
  const pageId = String(rule.pageId ?? '').trim();
  const link = rule.whatsappLink || buildWhatsappLink(rule.whatsappNumber, 'Hello, I would like support.');
  const linkData: Record<string, unknown> = {
    message: input.caption,
    link,
    call_to_action: {
      type: process.env.META_ADS_WHATSAPP_CTA_TYPE ?? 'LEARN_MORE',
      value: { link },
    },
  };
  if (input.imageUrl) linkData.picture = input.imageUrl;

  const objectStorySpec: Record<string, unknown> = {
    page_id: pageId,
    link_data: linkData,
  };
  if (rule.instagramActorId) {
    objectStorySpec.instagram_actor_id = rule.instagramActorId;
  }

  const response = await axios.post(`${GRAPH_BASE}/${adAccountId}/adcreatives`, null, {
    params: {
      name: `DottMedia WhatsApp Creative ${new Date().toISOString()}`,
      object_story_spec: JSON.stringify(objectStorySpec),
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return String(response.data?.id ?? '');
};

const createAd = async (rule: BoostRule, adSetId: string, creativeId: string, accessToken: string) => {
  const adAccountId = normalizeAdAccountId(rule.adAccountId);
  const response = await axios.post(`${GRAPH_BASE}/${adAccountId}/ads`, null, {
    params: {
      name: `DottMedia Boost Ad ${new Date().toISOString()}`,
      adset_id: adSetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: rule.statusOnCreate ?? 'PAUSED',
      access_token: accessToken,
    },
    timeout: 30000,
  });
  return String(response.data?.id ?? '');
};

export const metaAdsService = {
  async listAdAccounts(userId: string) {
    const socialAccounts = await loadUserSocialAccounts(userId);
    const accessToken = String(socialAccounts.facebook?.userAccessToken || socialAccounts.facebook?.accessToken || '').trim();
    if (!accessToken) {
      throw createHttpError(400, 'Meta account is not connected');
    }
    const response = await axios.get(`${GRAPH_BASE}/me/adaccounts`, {
      params: {
        fields: 'id,name,account_status,currency,timezone_name,amount_spent,balance',
        access_token: accessToken,
      },
      timeout: 30000,
    });
    return response.data?.data ?? [];
  },

  async getBoostRule(userId: string) {
    const rule = await resolveRule(userId);
    const defaultWhatsappNumber = userId === SHECARE_USER_ID ? SHECARE_WHATSAPP_NUMBER : null;
    if (rule) {
      const { accessToken: _accessToken, ...safeRule } = rule;
      return safeRule;
    }
    return {
      userId,
      enabled: false,
      mode: 'manual',
      whatsappNumber: defaultWhatsappNumber,
      whatsappLink: defaultWhatsappNumber
        ? buildWhatsappLink(defaultWhatsappNumber, 'Hello, I would like private support.')
        : null,
      dailyBudgetUsd: 5,
      dailyBudgetMinor: 500,
      durationHours: 24,
      statusOnCreate: 'PAUSED',
    };
  },

  async upsertBoostRule(userId: string, payload: Partial<BoostRule>) {
    const socialAccounts = await loadUserSocialAccounts(userId);
    const existing = await boostRulesCollection.doc(userId).get();
    const whatsappNumber = normalizeWhatsappNumber(payload.whatsappNumber);
    const dailyBudgetUsd = budgetUsdFromRule(payload);
    const update: BoostRule = {
      userId,
      enabled: Boolean(payload.enabled),
      mode: payload.mode === 'auto' ? 'auto' : 'manual',
      adAccountId: normalizeAdAccountId(payload.adAccountId),
      pageId: String(payload.pageId || socialAccounts.facebook?.pageId || '').trim(),
      instagramActorId: String(payload.instagramActorId || socialAccounts.instagram?.accountId || '').trim(),
      accessToken: String(payload.accessToken || socialAccounts.facebook?.userAccessToken || socialAccounts.facebook?.accessToken || '').trim(),
      whatsappNumber: whatsappNumber || null,
      whatsappLink: payload.whatsappLink || buildWhatsappLink(whatsappNumber, 'Hello, I would like private support.'),
      dailyBudgetUsd,
      dailyBudgetMinor: budgetMinorFromUsd(dailyBudgetUsd),
      durationHours: Math.max(Number(payload.durationHours ?? 24), 1),
      currency: payload.currency ?? null,
      objective: payload.objective ?? 'OUTCOME_ENGAGEMENT',
      billingEvent: payload.billingEvent ?? 'IMPRESSIONS',
      optimizationGoal: payload.optimizationGoal ?? 'POST_ENGAGEMENT',
      statusOnCreate: payload.statusOnCreate === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      audience: payload.audience,
      updatedAt: admin.firestore.Timestamp.now(),
    };
    await boostRulesCollection.doc(userId).set(
      {
        ...update,
        ...(existing.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const { accessToken: _accessToken, ...safeRule } = update;
    return safeRule;
  },

  async boostPublishedPost(input: ManualBoostInput) {
    const existingRule = (await resolveRule(input.userId)) ?? ({ userId: input.userId, enabled: false, mode: 'manual' } as BoostRule);
    const rule: BoostRule = {
      ...existingRule,
      adAccountId: input.adAccountId ?? existingRule.adAccountId,
      dailyBudgetUsd: input.dailyBudgetUsd ?? (typeof input.dailyBudgetMinor === 'number' ? input.dailyBudgetMinor / 100 : existingRule.dailyBudgetUsd),
      dailyBudgetMinor: input.dailyBudgetMinor ?? existingRule.dailyBudgetMinor,
      durationHours: input.durationHours ?? existingRule.durationHours,
      whatsappNumber: input.whatsappNumber ?? existingRule.whatsappNumber,
      whatsappLink: existingRule.whatsappLink || buildWhatsappLink(input.whatsappNumber ?? existingRule.whatsappNumber),
    };
    if (!normalizeAdAccountId(rule.adAccountId)) throw createHttpError(400, 'Missing Meta ad account ID');
    if (!rule.pageId) throw createHttpError(400, 'Missing Facebook Page ID');
    if (!rule.whatsappLink) throw createHttpError(400, 'Missing WhatsApp destination');
    const accessToken = resolveToken(rule);
    if (!accessToken) throw createHttpError(400, 'Missing Meta token with ads_management');

    const campaignId = await createCampaign(rule, accessToken);
    const adSetId = await createAdSet(rule, campaignId, accessToken);
    const creativeId = await createCreative(rule, input, accessToken);
    const adId = await createAd(rule, adSetId, creativeId, accessToken);
    const run = {
      userId: input.userId,
      platform: input.platform,
      sourcePostId: input.postId,
      campaignId,
      adSetId,
      creativeId,
      adId,
      status: rule.statusOnCreate ?? 'PAUSED',
      whatsappLink: rule.whatsappLink,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await adRunsCollection.doc(adId).set(run, { merge: true });
    return run;
  },

  async autoBoostAfterPost(input: BoostPublishedPostInput) {
    if (input.platform !== 'facebook') return null;
    const rule = await resolveRule(input.userId);
    if (!rule?.enabled || rule.mode !== 'auto') return null;
    try {
      return await this.boostPublishedPost(input);
    } catch (error) {
      await adRunsCollection.doc().set({
        userId: input.userId,
        platform: input.platform,
        sourcePostId: input.postId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.warn('[meta-ads] auto boost failed', {
        userId: input.userId,
        postId: input.postId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },

  async listRuns(userId: string, limit = 25) {
    const snap = await adRunsCollection.where('userId', '==', userId).limit(Math.min(Math.max(limit, 1), 100)).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },
};

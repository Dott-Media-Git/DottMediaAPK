import admin from 'firebase-admin';
import axios from 'axios';
import createHttpError from 'http-errors';
import { firestore } from '../db/firestore.js';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const boostRulesCollection = firestore.collection('boostRules');
const adRunsCollection = firestore.collection('adRuns');
const adCandidatesCollection = firestore.collection('adCandidates');
const SHECARE_USER_ID = 'tCE1FQ1cOFgdupOXP23mPUMQRAz1';
const SHECARE_WHATSAPP_NUMBER = '+447463010235';
const DEFAULT_AUTO_BOOST_PLATFORMS = ['facebook', 'instagram', 'facebook_story', 'instagram_story'];

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
  autoBoostPlatforms?: string[];
  autoBoostStrategy?: 'latest' | 'best_performing';
  performanceWindowHours?: number;
  minCandidateAgeMinutes?: number;
  autoBoostCooldownHours?: number;
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

type BoostCandidate = BoostPublishedPostInput & {
  id?: string;
  score?: number;
  metrics?: Record<string, number>;
  postedAt?: admin.firestore.Timestamp;
  evaluatedAt?: admin.firestore.Timestamp;
  boostedAt?: admin.firestore.Timestamp;
  status?: string;
};

type ManualBoostInput = BoostPublishedPostInput & {
  adAccountId?: string;
  dailyBudgetUsd?: number;
  dailyBudgetMinor?: number;
  durationHours?: number;
  whatsappNumber?: string;
};

type AdPerformanceRow = {
  id: string;
  adId?: string | null;
  platform?: string | null;
  sourcePostId?: string | null;
  status?: string | null;
  effectiveStatus?: string | null;
  campaignId?: string | null;
  adSetId?: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  inlineLinkClicks: number;
  messages: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpm: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
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

const numericOrDefault = (value: unknown, fallback: number, min: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, min) : fallback;
};

const normalizeAutoPlatforms = (platforms?: string[] | null) => {
  const normalized = (Array.isArray(platforms) ? platforms : DEFAULT_AUTO_BOOST_PLATFORMS)
    .map(platform => String(platform ?? '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized.length ? normalized : DEFAULT_AUTO_BOOST_PLATFORMS));
};

const candidateDocId = (input: BoostPublishedPostInput) =>
  `${input.userId}_${input.platform}_${input.postId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140);

const toMillis = (value: unknown) => {
  if (!value) return 0;
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
  if (typeof (value as any)?.seconds === 'number') return (value as any).seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumValues = (values: Array<unknown>) =>
  values.reduce((sum, value) => {
    const numeric = Number(value);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);

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

const safeGet = async (url: string, params: Record<string, unknown>) => {
  try {
    const response = await axios.get(url, { params, timeout: 30000 });
    return response.data;
  } catch (error) {
    return null;
  }
};

const graphGet = async (url: string, params: Record<string, unknown>) => {
  const response = await axios.get(url, { params, timeout: 30000 });
  return response.data;
};

const firestoreDateToIso = (value: unknown) => {
  const millis = toMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
};

const numberFromInsight = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const sumActionValues = (actions: unknown, match: (type: string) => boolean) => {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action: any) => {
    const type = String(action?.action_type ?? '').toLowerCase();
    return match(type) ? sum + numberFromInsight(action?.value) : sum;
  }, 0);
};

const parseAdInsights = (payload: any) => {
  const row = Array.isArray(payload?.data) ? payload.data[0] ?? {} : {};
  const clicks = numberFromInsight(row.clicks);
  const inlineLinkClicks = numberFromInsight(row.inline_link_clicks);
  const impressions = numberFromInsight(row.impressions);
  const messages = sumActionValues(row.actions, type => type.includes('messag') || type.includes('whatsapp'));
  const leads = sumActionValues(row.actions, type => type === 'lead' || type.includes('lead'));
  return {
    spend: numberFromInsight(row.spend),
    impressions,
    reach: numberFromInsight(row.reach),
    clicks,
    inlineLinkClicks,
    messages,
    leads,
    ctr: numberFromInsight(row.ctr),
    cpc: numberFromInsight(row.cpc),
    cpm: numberFromInsight(row.cpm),
  };
};

const emptyAdInsights = () => ({
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  inlineLinkClicks: 0,
  messages: 0,
  leads: 0,
  ctr: 0,
  cpc: 0,
  cpm: 0,
});

const errorMessageFromMeta = (error: unknown) => {
  const data = axios.isAxiosError(error) ? error.response?.data : null;
  return String(data?.error?.message || (error instanceof Error ? error.message : error) || 'Meta insights unavailable');
};

const fetchCandidateMetrics = async (candidate: BoostCandidate, socialAccounts: Record<string, any>) => {
  const platform = String(candidate.platform ?? '').toLowerCase();
  const postId = String(candidate.postId ?? '').trim();
  const facebookToken = String(socialAccounts.facebook?.accessToken || socialAccounts.facebook?.userAccessToken || '').trim();
  const instagramToken = String(socialAccounts.instagram?.accessToken || facebookToken).trim();

  if (!postId) return { score: 0, metrics: {} };

  if (platform === 'facebook') {
    const data = await safeGet(`${GRAPH_BASE}/${postId}`, {
      fields: 'reactions.summary(true),comments.summary(true),shares',
      access_token: facebookToken,
    });
    const reactions = Number(data?.reactions?.summary?.total_count ?? 0);
    const comments = Number(data?.comments?.summary?.total_count ?? 0);
    const shares = Number(data?.shares?.count ?? 0);
    const score = reactions + comments * 2 + shares * 3;
    return { score, metrics: { reactions, comments, shares } };
  }

  if (platform === 'instagram') {
    const data = await safeGet(`${GRAPH_BASE}/${postId}`, {
      fields: 'like_count,comments_count',
      access_token: instagramToken,
    });
    const likes = Number(data?.like_count ?? 0);
    const comments = Number(data?.comments_count ?? 0);
    const score = likes + comments * 2;
    return { score, metrics: { likes, comments } };
  }

  if (platform === 'instagram_story') {
    const data = await safeGet(`${GRAPH_BASE}/${postId}/insights`, {
      metric: 'impressions,reach,replies,total_interactions',
      access_token: instagramToken,
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    const metric = (name: string) => rows.find((row: any) => row?.name === name)?.values?.[0]?.value ?? 0;
    const impressions = Number(metric('impressions'));
    const reach = Number(metric('reach'));
    const replies = Number(metric('replies'));
    const interactions = Number(metric('total_interactions'));
    const score = sumValues([interactions, replies * 3, reach / 100, impressions / 250]);
    return { score, metrics: { impressions, reach, replies, interactions } };
  }

  if (platform === 'facebook_story') {
    const data = await safeGet(`${GRAPH_BASE}/${postId}/insights`, {
      metric: 'post_impressions,post_engaged_users',
      access_token: facebookToken,
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    const metric = (name: string) => rows.find((row: any) => row?.name === name)?.values?.[0]?.value ?? 0;
    const impressions = Number(metric('post_impressions'));
    const engagedUsers = Number(metric('post_engaged_users'));
    const score = sumValues([engagedUsers * 2, impressions / 250]);
    return { score, metrics: { impressions, engagedUsers } };
  }

  return { score: 0, metrics: {} };
};

const hasRecentBoost = async (userId: string, cooldownHours: number) => {
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  if (cooldownMs <= 0) return false;
  const snap = await adRunsCollection.where('userId', '==', userId).limit(40).get();
  const now = Date.now();
  return snap.docs.some(doc => {
    const data = doc.data();
    if (data.status === 'failed') return false;
    const createdAt = toMillis(data.createdAt);
    return createdAt > 0 && now - createdAt < cooldownMs;
  });
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
      autoBoostPlatforms: DEFAULT_AUTO_BOOST_PLATFORMS,
      autoBoostStrategy: 'best_performing',
      performanceWindowHours: 48,
      minCandidateAgeMinutes: 15,
      autoBoostCooldownHours: 6,
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
      autoBoostPlatforms: normalizeAutoPlatforms(payload.autoBoostPlatforms),
      autoBoostStrategy: payload.autoBoostStrategy === 'latest' ? 'latest' : 'best_performing',
      performanceWindowHours: numericOrDefault(payload.performanceWindowHours, 48, 1),
      minCandidateAgeMinutes: numericOrDefault(payload.minCandidateAgeMinutes, 15, 0),
      autoBoostCooldownHours: numericOrDefault(payload.autoBoostCooldownHours, 6, 0),
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
      sourceImageUrl: input.imageUrl ?? null,
      campaignId,
      adSetId,
      creativeId,
      adId,
      status: rule.statusOnCreate ?? 'PAUSED',
      whatsappLink: rule.whatsappLink,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await adRunsCollection.doc(adId).set(run, { merge: true });
    await adCandidatesCollection.doc(candidateDocId(input)).set(
      {
        boostedAt: admin.firestore.FieldValue.serverTimestamp(),
        boostAdId: adId,
        status: 'boosted',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return run;
  },

  async autoBoostAfterPost(input: BoostPublishedPostInput) {
    const rule = await resolveRule(input.userId);
    const eligiblePlatforms = normalizeAutoPlatforms(rule?.autoBoostPlatforms);
    if (!eligiblePlatforms.includes(String(input.platform ?? '').toLowerCase())) return null;
    const candidateId = candidateDocId(input);
    await adCandidatesCollection.doc(candidateId).set(
      {
        ...input,
        status: 'candidate',
        postedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (!rule?.enabled || rule.mode !== 'auto') return null;
    const cooldownHours = numericOrDefault(rule.autoBoostCooldownHours, 6, 0);
    if (await hasRecentBoost(input.userId, cooldownHours)) return null;

    const strategy = rule.autoBoostStrategy === 'latest' ? 'latest' : 'best_performing';
    if (strategy === 'latest') {
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
        return null;
      }
    }

    try {
      const windowHours = numericOrDefault(rule.performanceWindowHours, 48, 1);
      const minAgeMinutes = numericOrDefault(rule.minCandidateAgeMinutes, 15, 0);
      const minPostedAt = Date.now() - windowHours * 60 * 60 * 1000;
      const maxPostedAt = Date.now() - minAgeMinutes * 60 * 1000;
      const socialAccounts = await loadUserSocialAccounts(input.userId);
      const snap = await adCandidatesCollection.where('userId', '==', input.userId).limit(80).get();
      const candidates = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }) as BoostCandidate)
        .filter(candidate => {
          const platform = String(candidate.platform ?? '').toLowerCase();
          const postedAt = toMillis(candidate.postedAt);
          return (
            eligiblePlatforms.includes(platform) &&
            String(candidate.status ?? '') !== 'boosted' &&
            !candidate.boostedAt &&
            postedAt >= minPostedAt &&
            postedAt <= maxPostedAt &&
            candidate.postId
          );
        });

      let best: BoostCandidate | null = null;
      for (const candidate of candidates) {
        const { score, metrics } = await fetchCandidateMetrics(candidate, socialAccounts);
        await adCandidatesCollection.doc(candidate.id ?? candidateDocId(candidate)).set(
          {
            score,
            metrics,
            evaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        if (!best || score > Number(best.score ?? -1)) best = { ...candidate, score, metrics };
      }

      if (!best) return null;
      return await this.boostPublishedPost(best);
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

  async getPerformance(userId: string, limit = 25) {
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    const [rule, socialAccounts, snap] = await Promise.all([
      resolveRule(userId),
      loadUserSocialAccounts(userId),
      adRunsCollection.where('userId', '==', userId).limit(Math.max(cappedLimit, 25)).get(),
    ]);
    const accessToken = String(
      rule?.accessToken ||
        socialAccounts.facebook?.userAccessToken ||
        socialAccounts.facebook?.accessToken ||
        process.env.META_GRAPH_TOKEN ||
        '',
    ).trim();
    const runs = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }) as Record<string, any>)
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, cappedLimit);

    const rows = await Promise.all(
      runs.map(async run => {
        const adId = String(run.adId || run.id || '').trim();
        const baseRow: AdPerformanceRow = {
          id: String(run.id ?? adId),
          adId: adId || null,
          platform: run.platform ?? null,
          sourcePostId: run.sourcePostId ?? null,
          status: run.status ?? null,
          effectiveStatus: run.effectiveStatus ?? null,
          campaignId: run.campaignId ?? null,
          adSetId: run.adSetId ?? null,
          ...emptyAdInsights(),
          createdAt: firestoreDateToIso(run.createdAt),
          updatedAt: firestoreDateToIso(run.updatedAt),
          errorMessage: run.errorMessage ?? null,
        };
        if (!adId || run.status === 'failed') return baseRow;
        if (!accessToken) {
          return {
            ...baseRow,
            errorMessage: baseRow.errorMessage ?? 'Missing Meta token with ads insights access',
          };
        }
        try {
          const [adPayload, insightsPayload] = await Promise.all([
            graphGet(`${GRAPH_BASE}/${adId}`, {
              fields: 'id,name,status,effective_status,created_time,updated_time,campaign_id,adset_id',
              access_token: accessToken,
            }),
            graphGet(`${GRAPH_BASE}/${adId}/insights`, {
              fields:
                'spend,impressions,reach,clicks,inline_link_clicks,actions,cpc,cpm,ctr,date_start,date_stop',
              date_preset: 'last_30d',
              access_token: accessToken,
            }),
          ]);
          return {
            ...baseRow,
            status: adPayload?.status ?? baseRow.status,
            effectiveStatus: adPayload?.effective_status ?? baseRow.effectiveStatus,
            campaignId: adPayload?.campaign_id ?? baseRow.campaignId,
            adSetId: adPayload?.adset_id ?? baseRow.adSetId,
            ...parseAdInsights(insightsPayload),
            updatedAt: adPayload?.updated_time ?? baseRow.updatedAt,
          };
        } catch (error) {
          return {
            ...baseRow,
            errorMessage: errorMessageFromMeta(error),
          };
        }
      }),
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.spend += row.spend;
        acc.impressions += row.impressions;
        acc.reach += row.reach;
        acc.clicks += row.clicks;
        acc.inlineLinkClicks += row.inlineLinkClicks;
        acc.messages += row.messages;
        acc.leads += row.leads;
        const normalizedStatus = String(row.effectiveStatus || row.status || '').toUpperCase();
        if (normalizedStatus === 'ACTIVE') acc.active += 1;
        else if (normalizedStatus === 'PAUSED') acc.paused += 1;
        else if (normalizedStatus === 'FAILED' || row.errorMessage) acc.failed += 1;
        else acc.other += 1;
        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        inlineLinkClicks: 0,
        messages: 0,
        leads: 0,
        active: 0,
        paused: 0,
        failed: 0,
        other: 0,
        ctr: 0,
      },
    );
    summary.ctr = summary.impressions > 0 ? Number(((summary.clicks / summary.impressions) * 100).toFixed(2)) : 0;

    return {
      generatedAt: new Date().toISOString(),
      lookbackDays: 30,
      currency: rule?.currency || 'USD',
      summary,
      rows,
    };
  },
};

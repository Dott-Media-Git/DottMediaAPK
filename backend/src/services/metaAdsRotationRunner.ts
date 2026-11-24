import { createSharedBudgetRotationPlan, type RotationPost } from './metaAdsRotationPlan.js';

type Plan = ReturnType<typeof createSharedBudgetRotationPlan>;
type Platform = RotationPost['platform'];

/** claim must atomically reserve a cycle and must not reclaim an uncertain cycle. */
export interface RotationJournal {
  claim(cycleKey: string): Promise<boolean>;
  save(cycleKey: string, event: { stage: string; id?: string; platform?: Platform }): Promise<void>;
}

export interface RotationMetaClient {
  verify(): Promise<void>;
  createCampaign(plan: Plan): Promise<string>;
  createAdSet(plan: Plan, campaignId: string, platform: Platform): Promise<string>;
  createCreative(plan: Plan, platform: Platform, postId: string): Promise<string>;
  createAd(plan: Plan, platform: Platform, adSetId: string, creativeId: string): Promise<string>;
  verifyCampaign?(plan: Plan, campaignId: string): Promise<void>;
  activateAd(id: string): Promise<void>;
  activateAdSet(id: string): Promise<void>;
  activateCampaign(id: string): Promise<void>;
}

/**
 * Meta writes are journaled one by one. An unknown outcome is never retried by
 * this runner; the caller must reconcile it with Meta before claiming again.
 */
export async function runSharedBudgetCycle(input: {
  cycleKey: string;
  plan: Plan;
  journal: RotationJournal;
  meta: RotationMetaClient;
  draft?: boolean;
}): Promise<'started' | 'already_claimed' | 'draft_created'> {
  const { cycleKey, plan, journal, meta, draft } = input;
  if (!cycleKey.trim()) throw new Error('Cycle key is required.');
  if (!(await journal.claim(cycleKey))) return 'already_claimed';
  try {
    await meta.verify();
    await journal.save(cycleKey, { stage: 'verified' });
    const campaignId = await meta.createCampaign(plan);
    if (!campaignId) throw new Error('Meta did not return a campaign ID.');
    await journal.save(cycleKey, { stage: 'campaign_created', id: campaignId });
    const created: Array<{ adId: string; adSetId: string; platform: Platform }> = [];
    for (const ad of plan.ads) {
      const adSetId = await meta.createAdSet(plan, campaignId, ad.platform);
      if (!adSetId) throw new Error('Meta did not return an ad set ID.');
      await journal.save(cycleKey, { stage: 'adset_created', id: adSetId, platform: ad.platform });
      const creativeId = await meta.createCreative(plan, ad.platform, ad.postId);
      if (!creativeId) throw new Error('Meta did not return a creative ID.');
      await journal.save(cycleKey, { stage: 'creative_created', id: creativeId, platform: ad.platform });
      const adId = await meta.createAd(plan, ad.platform, adSetId, creativeId);
      if (!adId) throw new Error('Meta did not return an ad ID.');
      await journal.save(cycleKey, { stage: 'ad_created', id: adId, platform: ad.platform });
      created.push({ adId, adSetId, platform: ad.platform });
    }
    await meta.verifyCampaign?.(plan, campaignId);
    if (draft) {
      await journal.save(cycleKey, { stage: 'draft_created', id: campaignId });
      return 'draft_created';
    }
    if (Date.parse(plan.endTime) <= Date.now()) throw new Error('The ad rotation window already ended.');
    // The campaign stays paused until both ads and ad sets are ready.
    for (const ad of created) {
      await meta.activateAd(ad.adId);
      await journal.save(cycleKey, { stage: 'ad_activated', id: ad.adId, platform: ad.platform });
      await meta.activateAdSet(ad.adSetId);
      await journal.save(cycleKey, { stage: 'adset_activated', id: ad.adSetId, platform: ad.platform });
    }
    await journal.save(cycleKey, { stage: 'campaign_activation_requested', id: campaignId });
    await meta.activateCampaign(campaignId);
    await journal.save(cycleKey, { stage: 'campaign_activated', id: campaignId });
    return 'started';
  } catch (error) {
    await journal.save(cycleKey, { stage: 'requires_reconciliation' }).catch(() => undefined);
    throw error;
  }
}

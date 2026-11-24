import axios from 'axios';
import { existingPostCreative } from './metaAdsExistingPost.js';
import type { RotationPost } from './metaAdsRotationPlan.js';
import type { RotationMetaClient } from './metaAdsRotationRunner.js';

const adAccountId = 'act_2415264498885686';
const graph = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v23.0'}`;
const instagramUsername = 'carmarketplace999';

export function rotationError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.error?.code;
    const subcode = error.response?.data?.error?.error_subcode;
    if (typeof code === 'number') {
      const summary = error.response?.data?.error?.error_user_title;
      const title = typeof summary === 'string' && /^[\p{L}\p{N} .,()$!?:'-]{1,160}$/u.test(summary) ? ` ${summary}` : '';
      return `Meta error ${code}${typeof subcode === 'number' ? `/${subcode}` : ''}${title}`;
    }
    return `Request failed (${error.response?.status ?? error.code ?? 'network error'})`;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function connectCarMarketRotation(input: { pageId: string; userToken: string; username: string }) {
  if (!/^\d+$/.test(input.pageId) || !input.userToken || input.username.toLowerCase() !== instagramUsername) {
    throw new Error('Car Market Place must have Facebook and Instagram connected.');
  }

  const api = axios.create({ baseURL: graph, timeout: 15_000, maxRedirects: 0 });
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const read = async (path: string, params: Record<string, unknown>, token = input.userToken) =>
    (await api.get(path, { params, headers: auth(token) })).data;
  const write = async (path: string, data: Record<string, string | number>) =>
    (await api.post(path, new URLSearchParams(Object.entries(data).map(([key, value]) => [key, String(value)])), {
      headers: auth(input.userToken),
    })).data;

  const [account, page] = await Promise.all([
    read(adAccountId, { fields: 'id,currency,account_status' }),
    read(input.pageId, { fields: 'id,access_token,instagram_business_account{id,username}' }),
  ]);
  const instagram = page.instagram_business_account;
  if (account.id !== adAccountId || account.account_status !== 1 || account.currency !== 'USD') {
    throw new Error('The Car Market Place USD ad account is unavailable.');
  }
  if (page.id !== input.pageId || !page.access_token || !/^\d+$/.test(instagram?.id ?? '') ||
      instagram.username?.toLowerCase() !== instagramUsername) {
    throw new Error('Meta could not verify the Car Market Place Page and its linked Instagram account.');
  }

  const [facebookMedia, instagramMedia] = await Promise.all([
    read(`${page.id}/posts`, { fields: 'id,full_picture', limit: 50 }, page.access_token),
    read(`${instagram.id}/media`, { fields: 'id,media_type,boost_eligibility_info', limit: 50 }),
  ]);
  const facebookPosts: RotationPost[] = (facebookMedia.data ?? [])
    .filter((post: { id: string; full_picture?: string }) => post.full_picture && post.id.startsWith(`${page.id}_`))
    .map((post: { id: string }) => ({ id: post.id, platform: 'facebook' }));
  const instagramPosts: RotationPost[] = (instagramMedia.data ?? [])
    .filter((post: { id: string; media_type: string; boost_eligibility_info?: { eligible_for_boost?: boolean } }) =>
      /^\d+$/.test(post.id) && ['IMAGE', 'CAROUSEL_ALBUM'].includes(post.media_type) &&
      post.boost_eligibility_info?.eligible_for_boost !== false)
    .map((post: { id: string }) => ({ id: post.id, platform: 'instagram' }));

  const setActive = async (id: string) => {
    const result = await write(id, { status: 'ACTIVE' });
    if (result.success !== true) throw new Error('Meta did not confirm the status change.');
  };

  const clientFor = (posts: { facebookPost: RotationPost; instagramPost: RotationPost }): RotationMetaClient => ({
    async verify() {
      if (!facebookPosts.some(post => post.id === posts.facebookPost.id) ||
          !instagramPosts.some(post => post.id === posts.instagramPost.id)) {
        throw new Error('One of the selected posts is no longer available for boosting.');
      }
    },
    async createCampaign(plan) {
      const result = await write(`${adAccountId}/campaigns`, {
        name: `Dotti Car Market Place • ${plan.startTime}`,
        objective: 'OUTCOME_ENGAGEMENT',
        special_ad_categories: '[]',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        ...plan.campaign,
      });
      return result.id;
    },
    async createAdSet(plan, campaignId, platform) {
      const result = await write(`${adAccountId}/adsets`, {
        name: `Dotti • ${platform}`,
        campaign_id: campaignId,
        status: 'PAUSED',
        start_time: plan.startTime,
        end_time: plan.endTime,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'POST_ENGAGEMENT',
        destination_type: 'ON_POST',
        promoted_object: JSON.stringify({ page_id: page.id }),
        targeting: JSON.stringify({
          geo_locations: { countries: ['UG'] },
          publisher_platforms: [platform],
          ...(platform === 'facebook' ? { facebook_positions: ['feed'] } : { instagram_positions: ['stream'] }),
        }),
      });
      return result.id;
    },
    async createCreative(_plan, platform, postId) {
      const result = await write(`${adAccountId}/adcreatives`, {
        name: `Dotti • ${platform} • ${postId}`,
        ...existingPostCreative({ platform, postId, pageId: page.id }),
        ...(platform === 'instagram' ? { instagram_user_id: instagram.id, object_id: page.id } : {}),
      });
      return result.id;
    },
    async createAd(_plan, platform, adSetId, creativeId) {
      const result = await write(`${adAccountId}/ads`, {
        name: `Dotti Car Market Place • ${platform}`,
        adset_id: adSetId,
        creative: JSON.stringify({ creative_id: creativeId }),
        status: 'PAUSED',
      });
      return result.id;
    },
    async verifyCampaign(plan, campaignId) {
      const saved = await read(campaignId, {
        fields: 'status,account_id,lifetime_budget,daily_budget,adsets{status,start_time,end_time,targeting,ads{id,status}}',
      });
      if (saved.status !== 'PAUSED' || `act_${saved.account_id}` !== adAccountId ||
          Number(saved.lifetime_budget) !== plan.campaign.lifetime_budget || Number(saved.daily_budget ?? 0) !== 0) {
        throw new Error('Meta did not confirm the paused campaign and shared lifetime budget.');
      }
      const adSets: Array<{
        status: string;
        start_time: string;
        end_time: string;
        targeting?: { publisher_platforms?: string[] };
        ads?: { data: Array<{ status: string }> };
      }> = saved.adsets?.data ?? [];
      const confirmed = plan.ads.every(({ platform }) => adSets.some(set =>
        set.status === 'PAUSED' && set.targeting?.publisher_platforms?.join(',') === platform &&
        Math.floor(Date.parse(set.start_time) / 1000) === Math.floor(Date.parse(plan.startTime) / 1000) &&
        Math.floor(Date.parse(set.end_time) / 1000) === Math.floor(Date.parse(plan.endTime) / 1000) &&
        set.ads?.data.length === 1 && set.ads.data[0].status === 'PAUSED',
      ));
      if (adSets.length !== 2 || !confirmed) throw new Error('Meta did not confirm both paused ads and their schedules.');
    },
    activateAd: setActive,
    activateAdSet: setActive,
    activateCampaign: setActive,
  });

  return { facebookPosts, instagramPosts, clientFor };
}

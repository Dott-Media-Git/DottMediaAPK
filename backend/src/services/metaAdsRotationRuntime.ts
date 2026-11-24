import { supabaseFallbackService } from './supabaseFallbackService.js';
import { connectCarMarketRotation } from './metaAdsRotationGraph.js';
import { createSharedBudgetRotationPlan, getCarMarketRotationDay, type RotationPost } from './metaAdsRotationPlan.js';
import { runSharedBudgetCycle, type RotationJournal } from './metaAdsRotationRunner.js';
import { selectNextRotationPosts } from './metaAdsRotationSelection.js';
import { carMarketAdsOwnerId } from './carMarketAdsAccount.js';

const channel = 'carmarket_ads_rotation';
type Pair = { facebookPost: RotationPost; instagramPost: RotationPost };

export async function getCarMarketRotationConnection() {
  const owner = await supabaseFallbackService.getSocialAccountsByEmail('carmarketplace999@gmail.com');
  if (owner?.userId !== carMarketAdsOwnerId) {
    throw new Error('The Car Market Place Dotti account was not found.');
  }
  const { facebook, instagram, metaAds } = owner.socialAccounts as Record<string, any>;
  const connection = await connectCarMarketRotation({
    pageId: String(facebook?.pageId ?? ''),
    username: String(instagram?.username ?? ''),
    userToken: String(metaAds?.userAccessToken || metaAds?.accessToken || facebook?.userAccessToken || ''),
  });
  return { ownerId: owner.userId, connection };
}

export function rotationJournal(ownerId: string, pair: Pair, pairIndex: number, draft = false): RotationJournal {
  const recordChannel = draft ? `${channel}_draft` : channel;
  return {
    claim: id => supabaseFallbackService.reserveInboundMessage({
      id, channel: recordChannel, senderId: ownerId, status: 'claimed', payload: { ...pair, pairIndex },
    }),
    async save(id, event) {
      const recorded = await supabaseFallbackService.reserveInboundMessage({
        id: [id, event.stage, event.platform].filter(Boolean).join('_'),
        channel: `${recordChannel}_events`, senderId: ownerId, recipientId: id,
        status: event.stage, payload: { metaId: event.id, platform: event.platform },
      });
      if (!recorded) throw new Error('An ad rotation event already exists. Check Meta before proceeding.');
      await supabaseFallbackService.updateInboundMessage(id, { status: event.stage });
    },
  };
}

export async function runCarMarketRotation(startDate: string, now = Date.now()) {
  const scheduledDay = getCarMarketRotationDay(startDate, now);
  if (scheduledDay.status !== 'scheduled') return scheduledDay.status;
  const { dayEnd, date, pairIndex } = scheduledDay;
  if (dayEnd - now < 15 * 60_000) return 'waiting_for_next_day';
  const cycleKey = `${channel}_${date}`;
  if (await supabaseFallbackService.getInboundMessage(cycleKey)) return 'already_claimed';

  const history = await supabaseFallbackService.listInboundMessages(channel, 250);
  const previous = history[0];
  if (previous && previous.status !== 'campaign_activated') {
    throw new Error('A prior paid rotation needs reconciliation in Meta Ads Manager.');
  }

  const { ownerId, connection } = await getCarMarketRotationConnection();
  const previousPair = previous?.payload as (Pair & { pairIndex: number }) | undefined;
  const pair = previousPair?.pairIndex === pairIndex ? previousPair : selectNextRotationPosts({
    facebookPosts: connection.facebookPosts,
    instagramPosts: connection.instagramPosts,
    previousFacebookId: previousPair?.facebookPost.id,
    previousInstagramId: previousPair?.instagramPost.id,
    usedFacebookIds: history.map(row => (row.payload as Pair | undefined)?.facebookPost?.id).filter(Boolean) as string[],
    usedInstagramIds: history.map(row => (row.payload as Pair | undefined)?.instagramPost?.id).filter(Boolean) as string[],
  });
  const plan = createSharedBudgetRotationPlan({
    ...pair, dailyBudgetCents: 100, startTime: new Date(now + 5 * 60_000), endTime: new Date(dayEnd),
  });
  return runSharedBudgetCycle({ cycleKey, plan, journal: rotationJournal(ownerId, pair, pairIndex), meta: connection.clientFor(pair) });
}

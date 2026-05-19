import '../src/config.js';
import { publishToFacebook } from '../src/packages/services/socialPlatforms/facebookPublisher.js';
import { publishToInstagram } from '../src/packages/services/socialPlatforms/instagramPublisher.js';
import { resolveFacebookPageId } from '../src/services/socialAccountResolver.js';
import {
  buildCarmarketVehicleCaption,
  fetchBeforwardVehicle,
  pickBeforwardVehicle,
} from '../src/services/beforwardVehicleService.js';
import { supabaseFallbackService } from '../src/services/supabaseFallbackService.js';

const CARMARKET_USER_ID = 'acmVetCcOiTHeGk5D7eDYieamDF3';
const CARMARKET_PAGE_ID = '1033657279841186';
const CARMARKET_IG_ID = '17841414110816982';

async function loadRecentStockNos() {
  const job = await supabaseFallbackService.getAutopostJob(CARMARKET_USER_ID);
  const values = [
    ...((job?.recentImageUrls as string[] | undefined) ?? []),
    ...((job?.recentCaptions as string[] | undefined) ?? []),
  ];
  return new Set(
    values
      .map(value => String(value).match(/\b[A-Z]{2}\d{6}\b/i)?.[0]?.toUpperCase())
      .filter((value): value is string => Boolean(value)),
  );
}

async function resolveCredentials() {
  const token = (process.env.CLIENT_META_USER_TOKEN ?? process.env.FACEBOOK_PAGE_TOKEN ?? process.env.META_GRAPH_TOKEN ?? '').trim();
  if (!token) throw new Error('Missing CLIENT_META_USER_TOKEN/FACEBOOK_PAGE_TOKEN/META_GRAPH_TOKEN');
  const resolved = await resolveFacebookPageId(token, CARMARKET_PAGE_ID);
  const pageToken = resolved?.pageToken?.trim() || token;
  return {
    facebook: {
      accessToken: pageToken,
      pageId: resolved?.pageId?.trim() || CARMARKET_PAGE_ID,
      ...(resolved?.pageName ? { pageName: resolved.pageName } : {}),
    },
    instagram: {
      accessToken: pageToken,
      accountId: CARMARKET_IG_ID,
      username: 'carmarketplace999',
    },
  };
}

async function main() {
  const url = process.argv[2]?.trim();
  const vehicle = url
    ? await fetchBeforwardVehicle(url)
    : await pickBeforwardVehicle({ recentStockNos: await loadRecentStockNos() });
  const caption = buildCarmarketVehicleCaption(vehicle);
  const credentials = await resolveCredentials();
  const imageUrls = vehicle.images.slice(0, 10);

  const results = [];
  try {
    const facebook = await publishToFacebook({ caption, imageUrls, credentials });
    results.push({ platform: 'facebook', status: 'posted', remoteId: facebook.remoteId ?? null });
  } catch (error) {
    results.push({ platform: 'facebook', status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const instagram = await publishToInstagram({ caption, imageUrls, credentials });
    results.push({ platform: 'instagram', status: 'posted', remoteId: instagram.remoteId ?? null });
  } catch (error) {
    results.push({ platform: 'instagram', status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }

  const job = await supabaseFallbackService.getAutopostJob(CARMARKET_USER_ID);
  if (job) {
    const recentImageUrls = [
      ...imageUrls,
      `beforward-stock:${vehicle.stockNo}`,
      ...(((job.recentImageUrls as string[] | undefined) ?? []).filter(Boolean)),
    ].slice(0, 400);
    const recentCaptions = [
      `beforward-stock:${vehicle.stockNo}`,
      ...(((job.recentCaptions as string[] | undefined) ?? []).filter(Boolean)),
    ].slice(0, 400);
    await supabaseFallbackService.upsertAutopostJob(CARMARKET_USER_ID, {
      ...job,
      recentImageUrls,
      recentCaptions,
      lastResult: results,
      lastRunAt: new Date(),
      nextRun: new Date(Date.now() + 60 * 60 * 1000),
      intervalHours: 1,
    } as Record<string, unknown>);
  }

  console.log(JSON.stringify({ vehicle, postedImages: imageUrls.length, results }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

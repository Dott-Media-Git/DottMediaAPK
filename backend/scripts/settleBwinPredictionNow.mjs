import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

import {
  BWIN_USER_ID,
  getBwinAccounts,
  publishToFacebookImage,
  publishToInstagramImage,
  queryScheduledRowById,
  queryScheduledRows,
  uploadImageBuffer,
  upsertScheduledRows,
} from './lib/bwinWorkerCommon.mjs';
import { settlePredictionBatch } from './lib/bwinPredictionEngine.mjs';
import { renderPredictionRecapBuffer } from './lib/bwinPredictionRender.mjs';

dotenv.config();

const DRY_RUN = String(process.env.BWIN_PREDICTION_DRY_RUN || '').toLowerCase() === 'true';
const LOOKBACK_DAYS = Math.max(Number(process.env.BWIN_PREDICTION_LOOKBACK_DAYS ?? 7), 2);
const GRACE_HOURS = Math.max(Number(process.env.BWIN_PREDICTION_SETTLEMENT_GRACE_HOURS ?? 18), 3);
const PREVIEW_DIR = (process.env.BWIN_PREDICTION_SETTLEMENT_PREVIEW_DIR || '').trim();

function buildHashtagBlock() {
  return '#BwinbetUganda #BettingTips #WinningPicks #FootballResults #SoccerPicks #OddsWatch';
}

function buildCaption(settlement) {
  const headline = settlement.allWon
    ? `All ${settlement.totalCount} picks from the earlier board landed.`
    : `${settlement.wonCount} of ${settlement.totalCount} picks from the earlier board landed.`;
  return [
    headline,
    'Here are the picks that went through.',
    'More football updates: www.bwinbetug.info',
    'Place bets: https://bwinbetug.com',
    '',
    buildHashtagBlock(),
  ].join('\n');
}

async function maybeWritePreview(batchKey, buffer) {
  if (!PREVIEW_DIR) return;
  const targetDir = path.resolve(PREVIEW_DIR);
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, `${batchKey}.jpg`);
  await fs.writeFile(target, buffer);
  console.info('[bwin-prediction-settlement] preview saved', target);
}

function buildSettlementMarker(settlement) {
  const now = new Date().toISOString();
  return {
    id: `prediction-settlement:${settlement.batchKey}`,
    user_id: BWIN_USER_ID,
    platform: 'system',
    status: 'processed',
    target_date: settlement.marketDate,
    caption: settlement.allWon
      ? `All ${settlement.totalCount} picks landed.`
      : `${settlement.wonCount} of ${settlement.totalCount} picks landed.`,
    hashtags: '',
    image_urls: [],
    scheduled_for: now,
    created_at: now,
    updated_at: now,
    posted_at: now,
    remote_id: null,
    error_message: null,
    source: 'prediction_settlement',
    payload: { settlement },
  };
}

function buildRecapRow({ platform, settlement, caption, hashtags, imageUrl, remoteId, errorMessage }) {
  const now = new Date().toISOString();
  return {
    id: `prediction-recap:${settlement.batchKey}:${platform}`,
    user_id: BWIN_USER_ID,
    platform,
    status: errorMessage ? 'failed' : 'posted',
    target_date: settlement.marketDate,
    caption,
    hashtags,
    image_urls: imageUrl ? [imageUrl] : [],
    scheduled_for: now,
    created_at: now,
    updated_at: now,
    posted_at: errorMessage ? null : now,
    remote_id: remoteId || null,
    error_message: errorMessage || null,
    source: 'prediction_recap',
    payload: { settlement, imageUrl, caption, hashtags },
  };
}

async function getOpenBatches() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return queryScheduledRows({
    select: 'id,payload,posted_at,target_date',
    source: 'eq.prediction_card',
    platform: 'eq.instagram',
    status: 'eq.posted',
    posted_at: `gte.${since}`,
    order: 'posted_at.desc',
    limit: 80,
  });
}

async function main() {
  const rows = await getOpenBatches();
  if (!rows.length) {
    console.info('[bwin-prediction-settlement] No posted prediction batches found.');
    return;
  }

  const accounts = DRY_RUN ? null : await getBwinAccounts();

  for (const row of rows) {
    const batch = row?.payload?.batch || row?.payload;
    if (!batch?.batchKey || !Array.isArray(batch?.picks) || !batch.picks.length) continue;

    const markerId = `prediction-settlement:${batch.batchKey}`;
    const existingMarker = await queryScheduledRowById(markerId, 'id');
    if (existingMarker) continue;

    const settlement = await settlePredictionBatch(batch, { graceHours: GRACE_HOURS });
    if (!settlement.ready) continue;

    if (!settlement.wonCount) {
      await upsertScheduledRows([buildSettlementMarker(settlement)]);
      console.info('[bwin-prediction-settlement] board settled with no landed picks', batch.batchKey);
      continue;
    }

    const imageBuffer = await renderPredictionRecapBuffer(settlement);
    await maybeWritePreview(batch.batchKey, imageBuffer);

    if (DRY_RUN) {
      console.info('[bwin-prediction-settlement] dry run settlement ready', {
        batchKey: settlement.batchKey,
        wonCount: settlement.wonCount,
        totalCount: settlement.totalCount,
      });
      continue;
    }

    const publicUrl = await uploadImageBuffer(imageBuffer);
    const caption = buildCaption(settlement);
    const hashtags = buildHashtagBlock();
    const rowsToUpsert = [];
    let successCount = 0;

    if (accounts?.instagram?.accountId && accounts.instagram.accessToken) {
      try {
        const result = await publishToInstagramImage({
          accountId: accounts.instagram.accountId,
          accessToken: accounts.instagram.accessToken,
          imageUrl: publicUrl,
          caption,
        });
        rowsToUpsert.push(
          buildRecapRow({
            platform: 'instagram',
            settlement,
            caption,
            hashtags,
            imageUrl: publicUrl,
            remoteId: result.remoteId,
          }),
        );
        successCount += 1;
      } catch (error) {
        rowsToUpsert.push(
          buildRecapRow({
            platform: 'instagram',
            settlement,
            caption,
            hashtags,
            imageUrl: publicUrl,
            errorMessage: error?.response?.data?.error?.message || error?.message || String(error),
          }),
        );
        console.error('[bwin-prediction-settlement] instagram recap failed', error?.response?.data || error?.message || error);
      }
    }

    if (accounts?.facebook?.pageId && accounts.facebook.accessToken) {
      try {
        const result = await publishToFacebookImage({
          pageId: accounts.facebook.pageId,
          accessToken: accounts.facebook.accessToken,
          imageUrl: publicUrl,
          caption,
        });
        rowsToUpsert.push(
          buildRecapRow({
            platform: 'facebook',
            settlement,
            caption,
            hashtags,
            imageUrl: publicUrl,
            remoteId: result.remoteId,
          }),
        );
        successCount += 1;
      } catch (error) {
        rowsToUpsert.push(
          buildRecapRow({
            platform: 'facebook',
            settlement,
            caption,
            hashtags,
            imageUrl: publicUrl,
            errorMessage: error?.response?.data?.error?.message || error?.message || String(error),
          }),
        );
        console.error('[bwin-prediction-settlement] facebook recap failed', error?.response?.data || error?.message || error);
      }
    }

    if (!successCount) {
      console.warn('[bwin-prediction-settlement] recap publish failed on all platforms; leaving batch open', batch.batchKey);
      continue;
    }

    rowsToUpsert.push(buildSettlementMarker(settlement));
    await upsertScheduledRows(rowsToUpsert);

    console.info('[bwin-prediction-settlement] recap published', {
      batchKey: settlement.batchKey,
      wonCount: settlement.wonCount,
      totalCount: settlement.totalCount,
      imageUrl: publicUrl,
    });
  }
}

main().catch(error => {
  console.error('[bwin-prediction-settlement] Failed:', error?.message || String(error));
  process.exitCode = 1;
});

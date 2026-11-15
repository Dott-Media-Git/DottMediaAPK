import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { formatCarmarketCoverPrice, parseUsdUgxRate, renderCarmarketListingImage } from '../services/beforwardVehicleService';

test('cover prices use the Only format without rounding away the listed amount', () => {
  assert.equal(formatCarmarketCoverPrice(406_000_000), 'Only 406M');
  assert.equal(formatCarmarketCoverPrice(54_206_000), 'Only 54.206M');
  assert.equal(formatCarmarketCoverPrice(undefined), 'Price on request');
});

test('USD conversion rejects stale or invalid rates', () => {
  const now = Date.UTC(2026, 10, 15);
  const response = { result: 'success', base_code: 'USD', rates: { UGX: 3700 }, time_last_update_unix: now / 1000 };
  assert.equal(parseUsdUgxRate(response, now).rate, 3700);
  assert.throws(() => parseUsdUgxRate({ ...response, rates: { UGX: 0 } }, now));
  assert.throws(() => parseUsdUgxRate({ ...response, time_last_update_unix: now / 1000 - 4 * 86400 }, now));
});

test('listing photo has a brand mark in the top-left while the rest remains clear', async () => {
  const original = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const output = await renderCarmarketListingImage(original);
  const pixel = async (left: number, top: number) => (await sharp(output).extract({ left, top, width: 1, height: 1 }).raw().toBuffer())[0];
  assert.ok(await pixel(64, 85) < 180, 'top-left badge should darken the image');
  assert.ok(await pixel(1010, 85) > 240, 'top-right should remain unmarked');
  assert.ok(await pixel(800, 500) > 240, 'main image area should remain unmarked');
});

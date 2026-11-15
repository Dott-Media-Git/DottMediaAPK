import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { renderCarmarketListingImage } from '../services/beforwardVehicleService';

test('listing photo has a brand mark in the top-left while the rest remains clear', async () => {
  const original = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const output = await renderCarmarketListingImage(original);
  const pixel = async (left: number, top: number) => (await sharp(output).extract({ left, top, width: 1, height: 1 }).raw().toBuffer())[0];
  assert.ok(await pixel(64, 85) < 180, 'top-left badge should darken the image');
  assert.ok(await pixel(1010, 85) > 240, 'top-right should remain unmarked');
  assert.ok(await pixel(800, 500) > 240, 'main image area should remain unmarked');
});

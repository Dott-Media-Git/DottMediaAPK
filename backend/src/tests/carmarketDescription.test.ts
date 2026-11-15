import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCarmarketVehicleCaption, extractVehicleDescription } from '../services/beforwardVehicleService';

test('Car Marketplace description retains the listing text and line breaks', () => {
  const html = '<div><h2>About This Vehicle</h2><p>Seller information</p><p class="text-sm whitespace-pre-line">Beautiful SUV\n\nAutomatic &amp; ready.</p></div>';
  const description = extractVehicleDescription(html, 'CarMarketplace');
  assert.equal(description, 'Beautiful SUV\n\nAutomatic & ready.');
  assert.equal(buildCarmarketVehicleCaption({ title: 'Car', stockNo: '1', url: 'https://example.com', images: [], summary: {}, description }), description);
});

test('other sources use the vehicle description in structured listing data', () => {
  const html = '<script type="application/ld+json">{"@type":["Product","Vehicle"],"description":"Original seller description"}</script>';
  assert.equal(extractVehicleDescription(html, 'Carbarn Uganda'), 'Original seller description');
});

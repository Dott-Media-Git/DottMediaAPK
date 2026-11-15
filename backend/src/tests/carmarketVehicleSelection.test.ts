import assert from 'node:assert/strict';
import test from 'node:test';
import { CARMARKET_AUTOPOST_SOURCES, hasRecentCarmarketStock } from '../services/carmarketVehicleSelection';

test('marketplace listing IDs match history regardless of casing', () => {
  const mixed = 'CARMARKET-usr_8205335367722_10864c3d-dfef-46ca-b8f3-50c9d7b8a6ef';
  assert.equal(hasRecentCarmarketStock(mixed, new Set([mixed.toUpperCase()])), true);
  assert.equal(hasRecentCarmarketStock(mixed.toUpperCase(), new Set([mixed])), true);
  assert.equal(hasRecentCarmarketStock('CARMARKET-different', new Set([mixed])), false);
});

test('autopost sources exclude BE FORWARD', () => {
  assert.deepEqual([...CARMARKET_AUTOPOST_SOURCES], ['carmarketplace', 'carbarn', 'milele']);
});

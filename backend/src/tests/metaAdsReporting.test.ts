import assert from 'node:assert/strict';
import test from 'node:test';
import { metaAdsEffectiveStatus, metaAdsReportingStatus, metaAdsReportWindow } from '../services/metaAdsReporting.js';

test('the 30 day window includes the ad account’s current day at local midnight', () => {
  const now = Date.parse('2026-11-24T21:01:00Z');
  assert.deepEqual(metaAdsReportWindow(now, 'Africa/Kampala'), { since: '2026-10-27', until: '2026-11-25' });
  assert.deepEqual(metaAdsReportWindow(now, 'America/Los_Angeles'), { since: '2026-10-26', until: '2026-11-24' });
});

test('the report distinguishes Meta errors, pending reports, and a reported zero', () => {
  assert.equal(metaAdsReportingStatus(null), 'unavailable');
  assert.equal(metaAdsReportingStatus({ data: [] }), 'pending');
  assert.equal(metaAdsReportingStatus({ data: [{ impressions: '0' }] }), 'reported');
});

test('effective status accounts for the run window and preserves Meta restrictions', () => {
  const adset = { start_time: '2026-11-25T00:00:00+03:00', end_time: '2026-11-26T00:00:00+03:00' };
  const ad = { status: 'ACTIVE', adset };
  assert.equal(metaAdsEffectiveStatus(ad, Date.parse('2026-11-24T20:59:59Z')), 'SCHEDULED');
  assert.equal(metaAdsEffectiveStatus(ad, Date.parse('2026-11-24T21:00:00Z')), 'ACTIVE');
  assert.equal(metaAdsEffectiveStatus(ad, Date.parse('2026-11-25T21:00:00Z')), 'COMPLETED');
  assert.equal(metaAdsEffectiveStatus({ ...ad, effective_status: 'DISAPPROVED' }, Date.parse(adset.end_time)), 'DISAPPROVED');
});

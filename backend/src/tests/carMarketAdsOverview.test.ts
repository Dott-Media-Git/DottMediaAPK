import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeCarMarketAds } from '../services/carMarketAdsOverview.js';

test('combines the 30-day website ad reports and keeps link clicks distinct from conversions', () => {
  const window = { since: '2026-10-26', until: '2026-11-24' };
  const website = 'https://cmp.dott-media.org/';
  const ad = {
    creative: { object_story_spec: { link_data: { link: website } } },
    overview_report: { data: [
      { date_start: window.since, date_stop: window.until, impressions: '20', actions: [
        { action_type: 'post_engagement', value: '4' },
        { action_type: 'page_engagement', value: '4' },
        { action_type: 'link_click', value: '2' },
        { action_type: 'lead', value: '1' },
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '1' },
      ] },
      { date_start: '2026-10-25', date_stop: '2026-10-25', impressions: '90' },
    ] },
  };
  const secondAd = {
    ...ad,
    overview_report: { data: [{ date_start: '2026-11-23', date_stop: '2026-11-23', impressions: '7' }] },
  };
  assert.deepEqual(summarizeCarMarketAds([
    ad, secondAd, { ...ad, creative: undefined }, { ...ad, overview_report: undefined },
  ], window, website), { ...window, views: 27, interactions: 4, conversions: 1 });
});

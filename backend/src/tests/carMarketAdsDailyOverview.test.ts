import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeCarMarketAdDay } from '../services/carMarketAdsDailyOverview.js';

test('counts today’s website ads once and keeps link clicks distinct from conversions', () => {
  const date = '2026-11-24';
  const website = 'https://cmp.dott-media.org/';
  const ad = {
    creative: { object_story_spec: { link_data: { link: website } } },
    today_report: { data: [
      { date_start: date, impressions: '20', actions: [
        { action_type: 'post_engagement', value: '4' },
        { action_type: 'page_engagement', value: '4' },
        { action_type: 'link_click', value: '2' },
        { action_type: 'lead', value: '1' },
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '1' },
      ] },
      { date_start: '2026-11-23', impressions: '90' },
    ] },
  };
  assert.deepEqual(summarizeCarMarketAdDay([
    ad, { ...ad, creative: undefined }, { ...ad, today_report: undefined },
  ], date, website), { date, views: 20, interactions: 4, conversions: 1 });
});

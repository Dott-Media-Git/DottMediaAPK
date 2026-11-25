import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPageAdsScopes } from '../utils/metaAdsScopes';
import { isOptionalMetaScope } from '../utils/metaFacebookInsightsScope';

test('Ads sign-in requests Page ad access and keeps existing scopes', () => {
  assert.deepEqual(withPageAdsScopes(['pages_manage_posts', 'pages_show_list']), [
    'pages_manage_posts', 'pages_show_list', 'ads_read', 'ads_management',
    'business_management', 'pages_read_engagement', 'pages_manage_ads',
  ]);
  assert.equal(withPageAdsScopes(['pages_manage_ads']).filter(scope => scope === 'pages_manage_ads').length, 1);
});

test('missing Page ad consent does not prevent access to ads-account reporting', () => {
  assert.equal(isOptionalMetaScope('pages_manage_ads', 'ads'), true);
  assert.equal(isOptionalMetaScope('pages_show_list', 'ads'), false);
  assert.equal(isOptionalMetaScope('ads_management', 'ads'), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOptionalMetaScope, withFacebookInsightsScope } from '../utils/metaFacebookInsightsScope';

test('Facebook and combined login request insights even with configured scopes', () => {
  for (const platform of ['facebook', 'all']) {
    assert.deepEqual(withFacebookInsightsScope(['pages_show_list'], platform), ['pages_show_list', 'read_insights']);
    assert.deepEqual(withFacebookInsightsScope(['read_insights'], platform), ['read_insights']);
    assert.equal(isOptionalMetaScope('read_insights', platform), true);
    assert.equal(isOptionalMetaScope('pages_show_list', platform), false);
  }
});

test('other integrations do not gain or relax Facebook insight permissions', () => {
  for (const platform of ['instagram', 'ads']) {
    assert.deepEqual(withFacebookInsightsScope(['business_management'], platform), ['business_management']);
    assert.equal(isOptionalMetaScope('read_insights', platform), false);
  }
});

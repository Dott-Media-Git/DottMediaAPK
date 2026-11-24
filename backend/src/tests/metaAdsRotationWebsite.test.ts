import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCarMarketWebsiteCreative } from '../services/metaAdsRotationWebsite.js';

test('website ads use the same requested destination in the button and link card', () => {
  const story = buildCarMarketWebsiteCreative({
    pageId: '1', instagramId: '2', imageHash: 'photo-hash',
    caption: 'BMW i7 🌟\nhttps://example.com/listing',
  });
  assert.equal(story.instagram_user_id, '2');
  assert.equal(story.link_data.name, 'Visit Car Market Place Website');
  assert.equal(story.link_data.link, 'https://cmp.dott-media.org/');
  assert.equal(story.link_data.call_to_action.value.link, story.link_data.link);
  assert.equal(story.link_data.message, 'BMW i7 🌟\n\nVisit Car Market Place Website');
});

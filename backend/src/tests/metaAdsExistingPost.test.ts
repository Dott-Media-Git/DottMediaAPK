import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existingPostCreative } from '../services/metaAdsExistingPost.js';

test('references the selected connected Facebook post instead of creating a different post', () => {
  assert.deepEqual(existingPostCreative({ platform: 'facebook', pageId: '123', postId: '123_456' }), { object_story_id: '123_456' });
  assert.throws(() => existingPostCreative({ platform: 'facebook', pageId: '123', postId: '999_456' }));
});

test('references the selected Instagram media and rejects malformed identifiers', () => {
  assert.deepEqual(existingPostCreative({ platform: 'instagram', pageId: '123', postId: '456' }), { source_instagram_media_id: '456' });
  assert.throws(() => existingPostCreative({ platform: 'instagram', pageId: '123', postId: 'https://example.com/' }));
  assert.throws(() => existingPostCreative({ platform: 'instagram', pageId: '', postId: '456' }));
});

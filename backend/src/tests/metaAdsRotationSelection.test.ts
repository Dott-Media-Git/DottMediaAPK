import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectNextRotationPosts } from '../services/metaAdsRotationSelection.js';

test('selects a fresh post for each platform and rejects repeated or missing posts', () => {
  const posts = {
    facebookPosts: [{ platform: 'facebook' as const, id: 'f1' }, { platform: 'facebook' as const, id: 'f2' }],
    instagramPosts: [{ platform: 'instagram' as const, id: 'i1' }, { platform: 'instagram' as const, id: 'i2' }],
    previousFacebookId: 'f1', previousInstagramId: 'i1',
  };
  assert.equal(selectNextRotationPosts(posts).facebookPost.id, 'f2');
  assert.equal(selectNextRotationPosts(posts).instagramPost.id, 'i2');
  assert.throws(() => selectNextRotationPosts({ ...posts, instagramPosts: [posts.instagramPosts[0]] }), /No new instagram/);
  assert.throws(() => selectNextRotationPosts({ ...posts, facebookPosts: [] }), /No eligible facebook/);
});

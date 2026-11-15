import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

test('Car Marketplace sends up to ten images and keeps the source caption', async () => {
  const originalCreate = axios.create;
  const calls: Array<{url: string; body: any}> = [];
  (axios as any).create = () => ({
    post: async (url: string, body: any) => {
      calls.push({ url, body });
      return { data: { id: url.endsWith('media_publish') ? 'published' : `id${calls.length}`, post_id: 'published' } };
    },
    get: async (_url: string, options: any) => options?.params?.fields === 'status_code,status'
      ? { data: { status_code: 'FINISHED' } }
      : { data: { id: 'published', permalink: 'https://example.com/post', media_type: 'CAROUSEL_ALBUM' } },
  });
  try {
    const { publishToInstagram } = await import('../packages/services/socialPlatforms/instagramPublisher');
    const { publishToFacebook } = await import('../packages/services/socialPlatforms/facebookPublisher');
    const imageUrls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`);
    const caption = 'Seller description\nSecond line';
    await publishToInstagram({ caption, imageUrls, maxImages: 10, preserveCaption: true,
      credentials: { instagram: { accountId: 'ig', accessToken: 'test' } } });
    assert.equal(calls.filter(call => call.body?.is_carousel_item).length, 10);
    assert.equal(calls.find(call => call.body?.media_type === 'CAROUSEL')?.body.caption, caption);
    calls.length = 0;
    await publishToFacebook({ caption, imageUrls, maxImages: 10, preserveCaption: true,
      credentials: { facebook: { pageId: 'page', accessToken: 'test' } } });
    assert.equal(calls.filter(call => call.body?.published === false).length, 10);
    assert.equal(calls.find(call => call.url.endsWith('/feed'))?.body.message, caption);
    calls.length = 0;
    await publishToFacebook({ caption, imageUrls: imageUrls.slice(0, 1), maxImages: 10, preserveCaption: true,
      credentials: { facebook: { pageId: 'page', accessToken: 'test' } } });
    assert.equal(calls.filter(call => call.url.endsWith('/photos')).length, 1);
  } finally {
    (axios as any).create = originalCreate;
  }
});

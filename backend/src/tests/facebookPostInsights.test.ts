import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { fetchFacebookMetric } from '../services/liveSocialMetricsService';

test('post views still load when Meta denies reaction summary fields', async () => {
  const original = axios.get;
  const calls: string[] = [];
  axios.get = (async (url: string, options?: { params?: { metric?: string } }) => {
    const metric = options?.params?.metric;
    calls.push(metric ?? (url.endsWith('/me/accounts') ? 'page-token' : 'post-fields'));
    if (url.endsWith('/me/accounts')) throw new Error('already a page token');
    if (!metric) throw new Error('reaction fields require additional permission');
    if (metric === 'post_media_view') return { data: { data: [{ name: metric, values: [{ value: 2 }] }] } };
    throw new Error('other insights unavailable');
  }) as typeof axios.get;
  try {
    const result = await fetchFacebookMetric('test-page_test-post', { pageId: 'test-page', accessToken: 'test-token' });
    assert.deepEqual(result, { views: 2, interactions: 0 });
    assert.ok(calls.includes('post_media_view'));
  } finally {
    axios.get = original;
  }
});

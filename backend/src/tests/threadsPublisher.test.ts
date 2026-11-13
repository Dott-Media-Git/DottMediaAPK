import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

test('Threads retries a temporarily missing container without creating or publishing duplicates', async () => {
  process.env.THREADS_MEDIA_READY_DELAY_MS = '1000';
  const originalCreate = axios.create;
  let creates = 0;
  let checks = 0;
  let publishes = 0;
  (axios as any).create = () => ({
    post: async (url: string) => {
      if (url.endsWith('/threads_publish')) { publishes++; return { data: { id: 'published' } }; }
      creates++;
      return { data: { id: 'container' } };
    },
    get: async () => {
      checks++;
      if (checks === 1) throw { response: { data: { error: { code: 24, error_subcode: 4279009 } } } };
      return { data: { status: 'FINISHED' } };
    },
  });
  try {
    const { publishToThreads } = await import('../packages/services/socialPlatforms/threadsPublisher');
    const result = await publishToThreads({ caption: 'Test', imageUrls: ['https://example.com/photo.jpg'],
      credentials: { threads: { accountId: 'account', accessToken: 'test-token' } } });
    assert.equal(result.remoteId, 'published');
    assert.equal(creates, 1);
    assert.equal(checks, 2);
    assert.equal(publishes, 1);
  } finally {
    (axios as any).create = originalCreate;
  }
});

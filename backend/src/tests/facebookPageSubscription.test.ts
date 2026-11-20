import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { ensureFacebookPageSubscription } from '../services/facebookPageSubscription';

test('adds only permitted fields and preserves existing Page subscriptions', async () => {
  let posted: string[] = [];
  const client = {
    get: async () => ({ data: { data: [{ id: 'app', subscribed_fields: ['mention'] }] } }),
    post: async (_url: string, body: { subscribed_fields: string[] }) => { posted = body.subscribed_fields; return { data: { success: true } }; },
  } as unknown as Pick<typeof axios, 'get' | 'post'>;
  const result = await ensureFacebookPageSubscription({ pageId: 'page', pageToken: 'token', appId: 'app', graphVersion: 'v23.0', messagingGranted: false, client });
  assert.deepEqual(posted, ['mention', 'feed']);
  assert.equal(result.changed, true);
});

test('is idempotent and subscribes Messenger only with its permission', async () => {
  let writes = 0;
  const client = {
    get: async () => ({ data: { data: [{ id: 'app', subscribed_fields: ['feed', 'messages'] }] } }),
    post: async () => { writes++; return { data: { success: true } }; },
  } as unknown as Pick<typeof axios, 'get' | 'post'>;
  const result = await ensureFacebookPageSubscription({ pageId: 'page', pageToken: 'token', appId: 'app', graphVersion: 'v23.0', messagingGranted: true, client });
  assert.equal(result.changed, false);
  assert.equal(writes, 0);
});

test('does not subscribe if existing subscriptions cannot be safely read', async () => {
  let writes = 0;
  const client = {
    get: async () => { throw new Error('Meta unavailable'); },
    post: async () => { writes++; return { data: { success: true } }; },
  } as unknown as Pick<typeof axios, 'get' | 'post'>;
  await assert.rejects(() => ensureFacebookPageSubscription({ pageId: 'page', pageToken: 'token', appId: 'app', graphVersion: 'v23.0', messagingGranted: true, client }));
  assert.equal(writes, 0);
});

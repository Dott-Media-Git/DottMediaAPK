import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storeFacebookPageEvents } from '../services/facebookPageWebhook';

test('Page events are stored once for their own connected owner, excluding echoes', async () => {
  const saved = new Map<string, any>();
  const dependencies = {
    findOwner: async (page: string) => page === 'page-a' ? 'owner-a' : page === 'page-b' ? 'owner-b' : null,
    reserve: async (event: any) => { if (saved.has(event.id)) return false; saved.set(event.id, event); return true; },
  };
  const body = { entry: [
    { id: 'page-a', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'comment', message: 'Hello', from: { id: 'visitor' } } }],
      messaging: [{ sender: { id: 'visitor' }, message: { mid: 'mid', text: 'Hello' } }, { sender: { id: 'page-a' }, message: { mid: 'echo', text: 'Hi', is_echo: true } }] },
    { id: 'page-b', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'other', message: 'Hi', from: { id: 'visitor' } } }] },
    { id: 'unknown', messaging: [{ sender: { id: 'visitor' }, message: { mid: 'unknown', text: 'Hi' } }] },
  ] };
  await storeFacebookPageEvents(body, dependencies);
  await storeFacebookPageEvents(body, dependencies);
  assert.equal(saved.size, 3);
  assert.equal(saved.get('facebook_page_comment_page-a_comment').payload.ownerId, 'owner-a');
  assert.equal(saved.get('facebook_page_dm_page-a_mid').payload.ownerId, 'owner-a');
  assert.equal(saved.get('facebook_page_comment_page-b_other').payload.ownerId, 'owner-b');
});

test('storage errors propagate so Meta can retry', async () => {
  await assert.rejects(() => storeFacebookPageEvents({ entry: [{ id: 'page', messaging: [{ sender: { id: 'user' }, message: { mid: 'm', text: 'Hi' } }] }] }, {
    findOwner: async () => 'owner', reserve: async () => { throw new Error('storage unavailable'); },
  }), /storage unavailable/);
});

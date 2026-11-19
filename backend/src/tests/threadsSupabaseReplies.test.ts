import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import axios from 'axios';

test('Supabase reply processing respects opt-out and never sends a duplicate', async () => {
  process.env.ALLOW_MOCK_AUTH = 'true';
  process.env.THREADS_COMMENT_POLL_ENABLED = 'false';
  process.env.AUTO_REPLY_AI_ENABLED = 'false';
  const { supabaseFallbackService: store } = await import('../services/supabaseFallbackService');
  const { processReply } = await import('../jobs/threadsCommentPollJob');
  const { firestore } = await import('../db/firestore');
  const originals = { reserve: store.reserveInboundMessage, update: store.updateInboundMessage,
    setting: store.getInboundMessage, post: axios.post, collection: firestore.collection };
  let enabled = true;
  let creates = 0;
  let publishes = 0;
  let lastReply: string | null | undefined;
  const records = new Map<string, string>();
  (store as any).reserveInboundMessage = async (item: { id: string }) => {
    if (records.has(item.id)) return false;
    records.set(item.id, 'pending');
    return true;
  };
  (store as any).updateInboundMessage = async (id: string, patch: { status: string; reply?: string | null }) => { records.set(id, patch.status); if (patch.reply) lastReply = patch.reply; };
  (store as any).getInboundMessage = async () => ({ payload: { enabled } });
  (axios as any).post = async (url: string) => {
    if (url.endsWith('/threads_publish')) { publishes++; return { data: { id: 'published' } }; }
    creates++; return { data: { id: 'container' } };
  };
  const target = { userId: 'new-business', accountId: 'account', accessToken: 'test-token',
    username: 'business', supabaseReplies: true, repliesAfter: '2026-11-18T00:00:00Z' };
  const item = { id: 'reply-1', text: 'Hello', timestamp: new Date().toISOString(), username: 'customer' };
  try {
    await Promise.all([processReply(item, 'post', target), processReply(item, 'post', target)]);
    assert.equal(creates, 1);
    assert.equal(publishes, 1);
    assert.equal(records.get('threads_reply_reply-1'), 'sent');
    assert.ok(lastReply, 'a successful response must be saved for display in Dotti');
    enabled = false;
    await processReply({ ...item, id: 'reply-2' }, 'post', target);
    assert.equal(publishes, 1);
    assert.equal(records.get('threads_reply_reply-2'), 'skipped');
    await processReply({ ...item, id: 'reply-legacy' }, 'post', { ...target, userId: 'ouwaugr76lhdQ6IJbTuoCK9yMV93', supabaseReplies: false });
    assert.equal(publishes, 1);
    assert.equal(records.get('threads_reply_reply-legacy'), 'skipped');
    enabled = true;
    (firestore as any).collection = () => ({ doc: () => ({ get: async () => { throw new Error('quota'); } }) });
    await processReply({ ...item, id: 'reply-3' }, 'post', target);
    assert.equal(publishes, 2);
    assert.equal(records.get('threads_reply_reply-3'), 'sent');
  } finally {
    (store as any).reserveInboundMessage = originals.reserve;
    (store as any).updateInboundMessage = originals.update;
    (store as any).getInboundMessage = originals.setting;
    (axios as any).post = originals.post;
    (firestore as any).collection = originals.collection;
  }
});

test('Threads inbox query always constrains the authenticated recipient', async () => {
  const { supabaseFallbackService: store } = await import('../services/supabaseFallbackService');
  const originalConfigured = store.isConfigured;
  const originalRequest = (store as any).request;
  let params: any;
  (store as any).isConfigured = () => true;
  (store as any).request = async (_method: string, _table: string, options: any) => { params = options.params; return []; };
  try {
    await store.listInboundMessagesForRecipient('threads', 'user-a');
    assert.equal(params.channel, 'eq.threads');
    assert.equal(params.recipient_id, 'eq.user-a');
    await assert.rejects(store.listInboundMessagesForRecipient('threads', ''));
  } finally { (store as any).isConfigured = originalConfigured; (store as any).request = originalRequest; }
});

test('account discovery uses a stable cursor for successive Supabase pages', async () => {
  const { supabaseFallbackService: store } = await import('../services/supabaseFallbackService');
  const originalConfigured = store.isConfigured;
  const originalRequest = (store as any).request;
  const calls: any[] = [];
  (store as any).isConfigured = () => true;
  (store as any).request = async (_method: string, _table: string, options: any) => {
    calls.push(options.params);
    return [{ user_id: calls.length === 1 ? 'a' : 'b', accounts: {} }];
  };
  try {
    const first = await store.getAllSocialAccounts(1, '');
    const second = await store.getAllSocialAccounts(1, first[0].userId);
    assert.equal(second[0].userId, 'b');
    assert.equal(calls[0].order, 'user_id.asc');
    assert.equal(calls[1].user_id, 'gt.a');
  } finally {
    (store as any).isConfigured = originalConfigured;
    (store as any).request = originalRequest;
  }
});

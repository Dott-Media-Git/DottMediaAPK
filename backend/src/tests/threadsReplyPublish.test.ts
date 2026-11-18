import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { replyToThreadsComment } from '../services/autoReplyService';

test('retries the same reply container after Meta temporarily cannot find it', async () => {
  const original = axios.post;
  const ids: string[] = [];
  let creates = 0;
  (axios as any).post = async (url: string, _body: unknown, options: any) => {
    if (!url.endsWith('/threads_publish')) { creates++; return { data: { id: 'container' } }; }
    ids.push(options.params.creation_id);
    if (ids.length === 1) throw { response: { status: 400, data: { error: { code: 24, error_subcode: 4279009 } } } };
    return { data: { id: 'published' } };
  };
  try {
    await replyToThreadsComment('reply', 'Hello', { accountId: 'account', accessToken: 'token' });
    assert.equal(creates, 1);
    assert.deepEqual(ids, ['container', 'container']);
  } finally { axios.post = original; }
});

test('does not retry ambiguous publish failures', async () => {
  const original = axios.post;
  let publishes = 0;
  (axios as any).post = async (url: string) => {
    if (!url.endsWith('/threads_publish')) return { data: { id: 'container' } };
    publishes++;
    throw new Error('network timeout');
  };
  try {
    await assert.rejects(replyToThreadsComment('reply', 'Hello', { accountId: 'account', accessToken: 'token' }));
    assert.equal(publishes, 1);
  } finally { axios.post = original; }
});

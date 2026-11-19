import test from 'node:test';
import assert from 'node:assert/strict';
import { threadsScopesForUser } from '../utils/threadsScopes';

test('requests reply access for configured review users only', () => {
  const base = ['threads_basic', 'threads_content_publish'];
  assert.deepEqual(threadsScopesForUser(base, 'reviewer', 'other, reviewer'), [...base, 'threads_read_replies']);
  assert.deepEqual(threadsScopesForUser(base, 'other-user', 'reviewer'), base);
  assert.deepEqual(threadsScopesForUser([...base, 'threads_read_replies'], 'reviewer', 'reviewer'), [...base, 'threads_read_replies']);
});

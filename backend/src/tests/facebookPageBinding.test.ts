import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFacebookPageBinding } from '../services/facebookPageBinding';

test('shared Page notifications go only to the explicitly assigned connected owner', () => {
  const rows = [{ user_id: 'owner-a' }, { user_id: 'owner-b' }];
  assert.equal(resolveFacebookPageBinding(rows, null), null);
  assert.deepEqual(resolveFacebookPageBinding(rows, { status: 'events_only', payload: { ownerId: 'owner-b' } }),
    { userId: 'owner-b', eventsOnly: true });
  assert.equal(resolveFacebookPageBinding(rows, { status: 'events_only', payload: { ownerId: 'other' } }), null);
  assert.equal(resolveFacebookPageBinding([{ user_id: 'owner-a' }], { status: 'events_only', payload: { ownerId: 'owner-b' } }), null);
});

test('an unassigned Page with one connected owner keeps its existing mode', () => {
  assert.deepEqual(resolveFacebookPageBinding([{ user_id: 'owner-a' }], null), { userId: 'owner-a', eventsOnly: false });
  assert.deepEqual(resolveFacebookPageBinding([{ user_id: 'owner-a', accounts: { facebook: { webhookEventsOnly: true } } }], null),
    { userId: 'owner-a', eventsOnly: true });
});

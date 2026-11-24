import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSharedBudgetRotationPlan } from '../services/metaAdsRotationPlan.js';
import { runSharedBudgetCycle, type RotationMetaClient, type RotationJournal } from '../services/metaAdsRotationRunner.js';

const plan = createSharedBudgetRotationPlan({
  facebookPost: { platform: 'facebook', id: '1_2' },
  instagramPost: { platform: 'instagram', id: '3' },
  dailyBudgetCents: 100,
  startTime: new Date(Date.now() + 60_000),
});

function fixture() {
  const events: string[] = [];
  let claimed = false;
  const journal: RotationJournal = {
    async claim() { if (claimed) return false; claimed = true; return true; },
    async save(_key, event) { events.push(event.stage); },
  };
  const meta: RotationMetaClient = {
    async verify() { events.push('verify'); },
    async createCampaign() { events.push('createCampaign'); return 'campaign'; },
    async createAdSet(_plan, _campaign, platform) { events.push(`createAdSet:${platform}`); return `set:${platform}`; },
    async createCreative(_plan, platform) { events.push(`createCreative:${platform}`); return `creative:${platform}`; },
    async createAd(_plan, platform) { events.push(`createAd:${platform}`); return `ad:${platform}`; },
    async activateAd(id) { events.push(`activateAd:${id}`); },
    async activateAdSet(id) { events.push(`activateAdSet:${id}`); },
    async activateCampaign() { events.push('activateCampaign'); },
  };
  return { events, journal, meta };
}

test('activates the campaign only after both ads are created and prevents duplicate cycle execution', async () => {
  const f = fixture();
  assert.equal(await runSharedBudgetCycle({ cycleKey: 'cycle', plan, ...f }), 'started');
  assert.ok(f.events.indexOf('createAd:instagram') < f.events.indexOf('activateCampaign'));
  assert.equal(f.events.filter(event => event === 'activateCampaign').length, 1);
  assert.equal(await runSharedBudgetCycle({ cycleKey: 'cycle', plan, ...f }), 'already_claimed');
});

test('an uncertain Meta response is recorded and does not activate or retry the campaign', async () => {
  const f = fixture();
  f.meta.createAd = async () => { throw new Error('timeout'); };
  await assert.rejects(() => runSharedBudgetCycle({ cycleKey: 'cycle', plan, ...f }), /timeout/);
  assert.ok(f.events.includes('requires_reconciliation'));
  assert.ok(!f.events.includes('activateCampaign'));
  assert.equal(await runSharedBudgetCycle({ cycleKey: 'cycle', plan, ...f }), 'already_claimed');
});

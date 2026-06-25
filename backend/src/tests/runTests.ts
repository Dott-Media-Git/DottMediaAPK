import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64');

async function testVault() {
  const crypto = await import('../services/vaultCrypto.js');
  const key = crypto.getEncryptionKey();
  const payload = crypto.encryptValueRaw('secret', key);
  const plain = crypto.decryptValueRaw(payload, key);
  assert.equal(plain, 'secret', 'Vault encryption should round-trip');
}

async function testRoleHelper() {
  const rbac = await import('../utils/rbac.js');
  assert.equal(rbac.roleAllowed('Admin', ['Owner', 'Admin']), true);
  assert.equal(rbac.roleAllowed('Agent', ['Owner', 'Admin']), false);
}

async function testSettingsValidator() {
  const validator = await import('../services/admin/settingsValidator.js');
  const result = validator.validateSettingsPatch({
    features: { leadGen: false } as any,
    booking: { provider: 'calendly' } as any,
  }) as any;
  assert.ok(result.features, 'Features should be present');
  assert.equal(result.booking.provider, 'calendly');
}

async function testBillingPolicy() {
  const { assertUsageAllowed, canActivateCheckoutSession, resolveUsablePlan } = await import(
    '../services/billing/billingPolicy.js'
  );
  assert.equal(resolveUsablePlan({ planId: 'creator', subscriptionStatus: 'active' }).id, 'creator');
  assert.equal(resolveUsablePlan({ planId: 'creator' }).id, 'free');
  assert.equal(resolveUsablePlan({ planId: 'creator', subscriptionStatus: 'past_due' }).id, 'free');
  assert.equal(
    resolveUsablePlan({
      planId: 'creator',
      subscriptionStatus: 'active',
      billingCycleEndsAt: new Date(Date.now() - 1000),
    }).id,
    'free',
  );
  assert.equal(canActivateCheckoutSession('paid'), true);
  assert.equal(canActivateCheckoutSession('unpaid'), false);

  const starter = resolveUsablePlan({ planId: 'starter', subscriptionStatus: 'active' });
  assert.doesNotThrow(() =>
    assertUsageAllowed(starter, { aiReplies: 499 }, {}, new Map([['aiReplies', 1]])),
  );
  assert.throws(
    () => assertUsageAllowed(starter, { aiReplies: 500 }, {}, new Map([['aiReplies', 1]])),
    (error: any) => error?.status === 402,
  );
  assert.doesNotThrow(() =>
    assertUsageAllowed(starter, { images: 25 }, { images: 2 }, new Map([['images', 2]])),
  );
}

async function run() {
  await testVault();
  await testRoleHelper();
  await testSettingsValidator();
  await testBillingPolicy();
  console.log('Backend tests passed');
}

run().catch(error => {
  console.error('Tests failed', error);
  process.exit(1);
});

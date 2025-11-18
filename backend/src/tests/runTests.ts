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

async function run() {
  await testVault();
  await testRoleHelper();
  await testSettingsValidator();
  console.log('Admin control panel tests passed ✅');
}

run().catch(error => {
  console.error('Tests failed', error);
  process.exit(1);
});

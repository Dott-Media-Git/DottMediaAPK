import assert from 'node:assert/strict';
import { test } from 'node:test';
import { socialAccountLabels } from '../utils/socialAccountLabels';

test('labels use public account metadata and never expose credentials', () => {
  const labels = socialAccountLabels({
    facebook: { pageName: 'Ngogo Safari Lodge', accessToken: 'secret' },
    instagram: { username: 'ngogo_safari_lodge', accessToken: 'secret' },
    threads: { username: '@ngogo', accessToken: 'secret' },
    whatsapp: { displayPhoneNumber: '+256 700 000000', accessToken: 'secret' },
    linkedin: { accessToken: 'secret', urn: 'urn:li:organization:123' },
  }, 'Lodge videos');
  assert.equal(labels.facebook, 'Ngogo Safari Lodge');
  assert.equal(labels.instagram, '@ngogo_safari_lodge');
  assert.equal(labels.threads, '@ngogo');
  assert.equal(labels.linkedin, null);
  assert.equal(labels.youtube, 'Lodge videos');
  assert.equal(JSON.stringify(labels).includes('secret'), false);
});

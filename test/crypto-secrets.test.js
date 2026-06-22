import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptJson,
  decryptJson,
  isEncryptionAvailable,
  shouldUseEncryptedChannelSecrets
} from '../lib/crypto/secrets.js';
import {
  splitSecretsFromConfig,
  mergeSecretsIntoConfig,
  prepareConfigForStorage,
  decryptChannelSecrets
} from '../lib/ops-hub/integrations/channel-secrets-crypto.js';

const TEST_KEY = '01234567890123456789012345678901';

test('encryptJson roundtrip', () => {
  const payload = { apiSecret: 'super-secret', nested: { a: 1 } };
  const ciphertext = encryptJson(payload, TEST_KEY);
  assert.match(ciphertext, /^v1:/);
  assert.deepEqual(decryptJson(ciphertext, TEST_KEY), payload);
});

test('decryptJson returns null for invalid payload', () => {
  assert.equal(decryptJson('', TEST_KEY), null);
  assert.equal(decryptJson('v0:bad', TEST_KEY), null);
});

test('splitSecretsFromConfig isolates secret fields', () => {
  const { secrets, publicConfig } = splitSecretsFromConfig({
    shopId: 's1',
    apiUsername: 'user',
    apiPassword: 'pass',
    apiKey: 'key'
  });
  assert.equal(secrets.apiPassword, 'pass');
  assert.equal(secrets.apiKey, 'key');
  assert.equal(publicConfig.shopId, 's1');
  assert.equal(publicConfig.apiPassword, undefined);
});

test('prepareConfigForStorage encrypts when ENCRYPTION_KEY available', () => {
  const platformEnv = { ENCRYPTION_KEY: TEST_KEY };
  const stored = prepareConfigForStorage(
    { shopId: 's1', apiPassword: 'pass' },
    null,
    platformEnv
  );
  assert.equal(stored.config.shopId, 's1');
  assert.equal(stored.config.apiPassword, undefined);
  assert.ok(stored.secretsCiphertext);
  const secrets = decryptChannelSecrets(stored.secretsCiphertext, platformEnv);
  assert.equal(secrets.apiPassword, 'pass');
});

test('prepareConfigForStorage keeps plaintext when encryption disabled', () => {
  const stored = prepareConfigForStorage({ apiSecret: 'x' }, null, {});
  assert.equal(stored.config.apiSecret, 'x');
  assert.equal(stored.secretsCiphertext, null);
});

test('shouldUseEncryptedChannelSecrets respects explicit flag', () => {
  assert.equal(shouldUseEncryptedChannelSecrets({ CHANNEL_SECRETS_ENCRYPTED: 'false' }), false);
  assert.equal(shouldUseEncryptedChannelSecrets({ ENCRYPTION_KEY: TEST_KEY }), true);
});

test('isEncryptionAvailable requires 32+ chars', () => {
  assert.equal(isEncryptionAvailable({ ENCRYPTION_KEY: 'short' }), false);
  assert.equal(isEncryptionAvailable({ ENCRYPTION_KEY: TEST_KEY }), true);
});

test('mergeSecretsIntoConfig restores secrets', () => {
  const merged = mergeSecretsIntoConfig({ shopId: 's1' }, { apiPassword: 'p' });
  assert.equal(merged.apiPassword, 'p');
});

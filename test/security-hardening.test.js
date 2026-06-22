import test from 'node:test';
import assert from 'node:assert/strict';
import { safeTokenEqual, createAuth } from '../lib/auth/index.js';
import { isWebhookVerificationDisabled } from '../lib/ops-hub/webhooks/webhook-auth.js';

test('safeTokenEqual matches equal tokens and rejects mismatches', () => {
  assert.equal(safeTokenEqual('s3cret-token-value', 's3cret-token-value'), true);
  assert.equal(safeTokenEqual('s3cret-token-value', 's3cret-token-VALUE'), false);
  assert.equal(safeTokenEqual('short', 'shorter-different-length'), false);
  assert.equal(safeTokenEqual('', ''), false, 'boş tokenlar eşleşmemeli');
  assert.equal(safeTokenEqual(undefined, 'x'), false);
});

test('isWebhookVerificationDisabled can never be disabled in production', () => {
  assert.equal(
    isWebhookVerificationDisabled({ NODE_ENV: 'production', OPS_WEBHOOK_VERIFY_DISABLED: 'true' }),
    false
  );
  assert.equal(
    isWebhookVerificationDisabled({ NODE_ENV: 'production', WEBHOOK_VERIFY_DISABLED: 'true' }),
    false
  );
});

test('isWebhookVerificationDisabled honors both env names in development', () => {
  assert.equal(
    isWebhookVerificationDisabled({ NODE_ENV: 'development', OPS_WEBHOOK_VERIFY_DISABLED: 'true' }),
    true
  );
  assert.equal(
    isWebhookVerificationDisabled({ NODE_ENV: 'development', WEBHOOK_VERIFY_DISABLED: '1' }),
    true
  );
  assert.equal(isWebhookVerificationDisabled({ NODE_ENV: 'development' }), false);
});

test('assertAuthorized rejects wrong token and accepts correct token', () => {
  const auth = createAuth({
    platformApiToken: 'a-very-long-platform-token-1234567890',
    authRequired: true,
    nodeEnv: 'production'
  });
  assert.throws(
    () => auth.assertAuthorized({ headers: { authorization: 'Bearer wrong-token' } }),
    /Yetkisiz/
  );
  assert.doesNotThrow(() =>
    auth.assertAuthorized({
      headers: { authorization: 'Bearer a-very-long-platform-token-1234567890' }
    })
  );
});

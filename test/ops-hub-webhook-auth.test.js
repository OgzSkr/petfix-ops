import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWebhookSecretFromRequest } from '../lib/ops-hub/webhooks/webhook-auth.js';

test('resolveWebhookSecretFromRequest supports node http headers object', () => {
  const secret = resolveWebhookSecretFromRequest({
    headers: { authorization: 'Bearer abc-secret' }
  });
  assert.equal(secret, 'abc-secret');
});

test('resolveWebhookSecretFromRequest supports fetch Headers', () => {
  const headers = new Headers({ 'X-Webhook-Secret': 'xyz' });
  const secret = resolveWebhookSecretFromRequest({ headers });
  assert.equal(secret, 'xyz');
});

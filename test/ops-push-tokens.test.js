import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderPushToken,
  filterDeliverablePushTokens
} from '../lib/ops-hub/notifications/push-service.js';

test('isPlaceholderPushToken rejects device id prefixes', () => {
  assert.equal(isPlaceholderPushToken('android:abc123'), true);
  assert.equal(isPlaceholderPushToken('ios:vendor-id'), true);
  assert.equal(isPlaceholderPushToken('desktop:macos'), true);
  assert.equal(isPlaceholderPushToken(''), true);
});

test('isPlaceholderPushToken accepts FCM registration tokens', () => {
  const fcmToken = 'dK3xYz:' + 'a'.repeat(120);
  assert.equal(isPlaceholderPushToken(fcmToken), false);
});

test('filterDeliverablePushTokens keeps only real FCM tokens', () => {
  const filtered = filterDeliverablePushTokens([
    'android:emulator',
    'real-fcm-token-abc',
    'ios:foo'
  ]);
  assert.deepEqual(filtered, ['real-fcm-token-abc']);
});

test('isPushConfigured accepts legacy key or service account json', async () => {
  const { isPushConfigured } = await import('../lib/ops-hub/notifications/push-service.js');
  assert.equal(isPushConfigured({ FCM_SERVER_KEY: 'abc' }), true);
  assert.equal(isPushConfigured({}), false);
  assert.equal(
    isPushConfigured({
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'petfix-ops',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        client_email: 'firebase-adminsdk@test.iam.gserviceaccount.com'
      })
    }),
    true
  );
});

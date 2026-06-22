import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStaffRouteRole,
  assertMobileDeliverRole,
  isStaffAuthPlatformBypassPath,
  isStaffAuthRequired
} from '../lib/ops-hub/auth/mobile-auth.js';

test('FF_STAFF_AUTH resolves from platform env', () => {
  assert.equal(isStaffAuthRequired({ FF_STAFF_AUTH: 'true' }), true);
  assert.equal(isStaffAuthRequired({ FF_STAFF_AUTH: 'false' }), false);
  assert.equal(isStaffAuthRequired({}), false);
});

test('staff auth platform bypass paths', () => {
  assert.equal(isStaffAuthPlatformBypassPath('/ops/v1/orders/ingest/mock'), true);
  assert.equal(isStaffAuthPlatformBypassPath('/ops/v1/orders'), false);
});

test('assertStaffRouteRole allows platform token for admin routes when FF_STAFF_AUTH off', () => {
  assert.doesNotThrow(() => {
    assertStaffRouteRole({ staffUser: null, platformEnv: {} }, ['picker']);
  });
});

test('assertStaffRouteRole blocks platform token on mobile routes when FF_STAFF_AUTH on', () => {
  assert.throws(() => {
    assertStaffRouteRole({ staffUser: null, platformEnv: { FF_STAFF_AUTH: 'true' } }, ['picker']);
  }, /Personel oturumu gerekli/);
});

test('assertMobileDeliverRole allows picker to deliver', () => {
  assert.doesNotThrow(() => {
    assertMobileDeliverRole({
      staffUser: { role: 'picker' },
      platformEnv: { FF_STAFF_AUTH: 'true' }
    });
  });
});

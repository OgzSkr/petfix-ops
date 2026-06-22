import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashStaffPassword,
  verifyStaffPassword
} from '../lib/ops-hub/staff/password.js';
import { hashSessionToken, createSessionToken } from '../lib/ops-hub/staff/staff-auth-service.js';

test('staff password hash verifies', async () => {
  const hash = await hashStaffPassword('Test1234!');
  assert.match(hash, /^scrypt:/);
  assert.equal(await verifyStaffPassword('Test1234!', hash), true);
  assert.equal(await verifyStaffPassword('wrong', hash), false);
});

test('session token hash is stable', () => {
  const token = createSessionToken();
  assert.equal(token.length, 64);
  assert.equal(hashSessionToken(token), hashSessionToken(token));
});

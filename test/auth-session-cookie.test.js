import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../lib/auth/index.js';
import {
  buildSessionCookie,
  clearSessionCookie,
  parseCookieHeader,
  readSessionCookie
} from '../lib/auth/session-cookie.js';

test('readProvidedAuthToken accepts HttpOnly session cookie', () => {
  const auth = createAuth({ platformApiToken: 'secret-token', authRequired: true });
  const cookie = buildSessionCookie('secret-token', { secure: false });
  const request = {
    headers: {
      cookie: cookie.split(';')[0]
    }
  };
  auth.assertAuthorized(request);
  assert.equal(readSessionCookie(request), 'secret-token');
});

test('parseCookieHeader decodes cookie values', () => {
  const parsed = parseCookieHeader('pf_platform_token=abc%20123; Path=/');
  assert.equal(parsed.pf_platform_token, 'abc 123');
});

test('clearSessionCookie sets Max-Age=0', () => {
  assert.match(clearSessionCookie({ secure: false }), /Max-Age=0/);
});

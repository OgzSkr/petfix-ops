import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionConfig } from '../lib/production/validate-config.js';

test('validateProductionConfig skips non-production', () => {
  const result = validateProductionConfig({}, { NODE_ENV: 'development' });
  assert.equal(result.skipped, true);
});

test('validateProductionConfig fails when critical keys missing', () => {
  assert.throws(
    () => validateProductionConfig({}, { NODE_ENV: 'production' }),
    (error) => error.code === 'PRODUCTION_CONFIG_INVALID'
  );
});

test('validateProductionConfig passes with minimal valid config', () => {
  const env = {
    NODE_ENV: 'production',
    OPS_POSTGRES_URL: 'postgresql://u:p@localhost/db',
    PLATFORM_API_TOKEN: 'x'.repeat(32),
    OPS_PUBLIC_API_BASE_URL: 'https://api.petfix.com.tr',
    YEMEKSEPETI_WEBHOOK_SECRET: 'wh-secret',
    YEMEKSEPETI_CLIENT_ID: 'cid',
    YEMEKSEPETI_CLIENT_SECRET: 'csec',
    YEMEKSEPETI_VENDOR_ID: 'vid',
    ENCRYPTION_KEY: 'x'.repeat(32)
  };
  const result = validateProductionConfig(env, env);
  assert.equal(result.ok, true);
});

test('validateProductionConfig allows short panel token when explicitly enabled', () => {
  const env = {
    NODE_ENV: 'production',
    OPS_POSTGRES_URL: 'postgresql://u:p@localhost/db',
    PLATFORM_API_TOKEN: '1234',
    PANEL_ALLOW_SIMPLE_TOKEN: 'true',
    OPS_PUBLIC_API_BASE_URL: 'https://api.petfix.com.tr',
    YEMEKSEPETI_WEBHOOK_SECRET: 'wh-secret',
    YEMEKSEPETI_CLIENT_ID: 'cid',
    YEMEKSEPETI_CLIENT_SECRET: 'csec',
    YEMEKSEPETI_VENDOR_ID: 'vid',
    ENCRYPTION_KEY: 'x'.repeat(32)
  };
  const result = validateProductionConfig(env, env);
  assert.equal(result.ok, true);
});

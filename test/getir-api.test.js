import test from 'node:test';
import assert from 'node:assert/strict';
import { isGetirApiConfigComplete, resolveGetirApiConfig } from '../lib/channels/getir-api.js';
import { isGetirConfigComplete } from '../lib/ops-hub/integrations/config-bridge.js';

test('resolveGetirApiConfig maps env-style fields', () => {
  const cfg = resolveGetirApiConfig({
    apiBaseUrl: 'https://api.example.getirapi.com',
    apiUsername: 'petfix',
    apiPassword: 'secret',
    shopId: 'shop-1'
  });
  assert.equal(cfg.baseUrl, 'https://api.example.getirapi.com');
  assert.equal(cfg.username, 'petfix');
  assert.equal(cfg.shopId, 'shop-1');
});

test('isGetirConfigComplete requires shop, credentials and base URL', () => {
  assert.equal(isGetirConfigComplete({ shopId: 'x' }), false);
  assert.equal(isGetirConfigComplete({
    shopId: '6a310a9818ce7da2135a05c9',
    apiUsername: 'petfix',
    apiPassword: 'test',
    apiBaseUrl: 'https://api.example.getirapi.com'
  }), true);
  assert.equal(isGetirApiConfigComplete({
    shopId: '6a310a9818ce7da2135a05c9',
    username: 'petfix',
    password: 'test',
    baseUrl: 'https://api.example.getirapi.com'
  }), true);
});

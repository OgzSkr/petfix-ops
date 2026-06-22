import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOY_PROFILE,
  resolveDeployProfile,
  isOpsOnlyDeploy,
  isLegacyMarketplacePagePath,
  isLegacyMarketplaceApiPath,
  isLocalOnlyPagePath,
  isLocalOnlyApiPath,
  isRouteBlockedInOpsOnly,
  listVisiblePanelModules,
  resolveOpsOnlyLegacyRedirect
} from '../lib/production/deploy-profile.js';

test('resolveDeployProfile defaults to ops-only', () => {
  assert.equal(resolveDeployProfile({}), DEPLOY_PROFILE.OPS_ONLY);
  assert.equal(resolveDeployProfile({ DEPLOY_PROFILE: 'full' }), DEPLOY_PROFILE.FULL);
  assert.equal(resolveDeployProfile({ DEPLOY_PROFILE: 'ops-only' }), DEPLOY_PROFILE.OPS_ONLY);
});

test('isOpsOnlyDeploy detects ops-only', () => {
  assert.equal(isOpsOnlyDeploy({ DEPLOY_PROFILE: 'ops-only' }), true);
  assert.equal(isOpsOnlyDeploy({}), true);
  assert.equal(isOpsOnlyDeploy({ DEPLOY_PROFILE: 'full' }), false);
});

test('legacy marketplace paths blocked in ops repo', () => {
  assert.equal(isLegacyMarketplacePagePath('/marketplace/trendyol'), true);
  assert.equal(isLegacyMarketplacePagePath('/hzlmrktops/siparisler'), false);
  assert.equal(isLegacyMarketplaceApiPath('/api/buybox/history'), true);
  assert.equal(isLegacyMarketplaceApiPath('/api/dashboard'), true);
  assert.equal(isLegacyMarketplaceApiPath('/api/dashboard/channels-summary'), false);
  assert.equal(isLegacyMarketplaceApiPath('/api/hzlmrktops/orders'), false);
  assert.equal(isLegacyMarketplaceApiPath('/api/product-matching/queue'), false);
});

test('ops-only blocks marketplace pages and buybox APIs', () => {
  const profile = DEPLOY_PROFILE.OPS_ONLY;
  assert.equal(isLocalOnlyPagePath('/marketplace/trendyol', profile), true);
  assert.equal(isLocalOnlyPagePath('/hzlmrktops/siparisler', profile), false);
  assert.equal(isLocalOnlyApiPath('/api/buybox/history', profile), true);
  assert.equal(isLocalOnlyApiPath('/api/hzlmrktops/orders', profile), false);
  assert.equal(isRouteBlockedInOpsOnly('/assets/panel-common.js', profile), false);
});

test('listVisiblePanelModules hides marketplace in ops-only', () => {
  const modules = listVisiblePanelModules(DEPLOY_PROFILE.OPS_ONLY).map((row) => row.id);
  assert.deepEqual(modules, ['hzlmrktops', 'admin']);
});

test('resolveOpsOnlyLegacyRedirect maps siparisler to hzlmrktops', () => {
  assert.match(String(resolveOpsOnlyLegacyRedirect('/siparisler')), /\/hzlmrktops\/siparisler$/);
  assert.equal(resolveOpsOnlyLegacyRedirect('/trendyol'), null);
});

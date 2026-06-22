import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roleAllows,
  ROLE_RANK
} from '../lib/ops-hub/branches/branch-repository.js';
import {
  readBranchIdFromRequest,
  resolveRbacSubjectKey,
  buildBranchCookie,
  isBranchIdRequired
} from '../lib/ops-hub/branches/branch-context.js';
import {
  parseBranchScopedWebhookPath,
  branchWebhookBasePath
} from '../lib/ops-hub/branches/webhook-branch-resolver.js';
import { buildWebhookPanel } from '../lib/ops-hub/integrations/integration-service.js';

test('roleAllows maps viewer/operator/admin hierarchy', () => {
  assert.equal(roleAllows('viewer', 'read'), true);
  assert.equal(roleAllows('viewer', 'write'), false);
  assert.equal(roleAllows('operator', 'write'), true);
  assert.equal(roleAllows('operator', 'admin'), false);
  assert.equal(roleAllows('admin', 'admin'), true);
  assert.ok(ROLE_RANK.admin > ROLE_RANK.operator);
});

test('readBranchIdFromRequest prefers header then query then cookie', () => {
  const url = new URL('http://local/ops/v1/integrations?branch=from-query');
  const fromHeader = readBranchIdFromRequest(
    { headers: { 'x-ops-branch-id': 'from-header' }, cookie: '' },
    url
  );
  assert.equal(fromHeader, 'from-header');

  const fromQuery = readBranchIdFromRequest(
    { headers: {}, cookie: '' },
    url
  );
  assert.equal(fromQuery, 'from-query');

  const fromCookie = readBranchIdFromRequest(
    { headers: { cookie: 'pf_ops_branch_id=from-cookie' } },
    new URL('http://local/ops/v1/integrations')
  );
  assert.equal(fromCookie, 'from-cookie');
});

test('buildBranchCookie includes branch id', () => {
  const cookie = buildBranchCookie('abc-123', { secure: false });
  assert.match(cookie, /pf_ops_branch_id=abc-123/);
});

test('resolveRbacSubjectKey defaults to platform', () => {
  assert.equal(resolveRbacSubjectKey(), 'platform');
});

test('parseBranchScopedWebhookPath extracts slug and subpath', () => {
  const parsed = parseBranchScopedWebhookPath('/webhooks/v1/branches/kadikoy/yemeksepeti/orders');
  assert.equal(parsed.branchSlug, 'kadikoy');
  assert.equal(parsed.subPath, '/webhooks/v1/yemeksepeti/orders');
});

test('buildWebhookPanel includes branch slug in URLs', () => {
  const panel = buildWebhookPanel({ OPS_PUBLIC_API_BASE_URL: 'https://api.test' }, { branchSlug: 'kadikoy' });
  assert.match(panel.endpoints.yemeksepetiOrders, /\/branches\/kadikoy\/yemeksepeti\/orders$/);
  assert.equal(branchWebhookBasePath('kadikoy'), '/webhooks/v1/branches/kadikoy');
});

test('isBranchIdRequired respects env flag', () => {
  assert.equal(isBranchIdRequired({ OPS_BRANCH_ID_REQUIRED: 'true' }), true);
  assert.equal(isBranchIdRequired({ OPS_BRANCH_ID_REQUIRED: 'false' }), false);
});

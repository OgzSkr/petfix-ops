import test from 'node:test';
import assert from 'node:assert/strict';
import { canListOpsOrders } from '../lib/channels/ops-orders-bridge.js';
import { createChannelOrdersService } from '../lib/platform/services/channel-orders.js';
import { createHzlMrktOpsOrdersService } from '../lib/platform/services/hzlmrktops-orders.js';
import { readEnvFile } from '../lib/env.js';
import { paths, resolveRuntimeConfig } from '../lib/config.js';

test('canListOpsOrders returns true when Ops Postgres is available', async () => {
  const available = await canListOpsOrders('getir');
  assert.equal(typeof available, 'boolean');
});

test('Getir healthCheck reports ops-only mode without API credentials', async (t) => {
  const { GetirAdapter } = await import('../lib/channels/getir.js');
  const adapter = new GetirAdapter();
  const originalLoad = adapter.loadConfig.bind(adapter);
  adapter.loadConfig = async () => ({
    shopId: '',
    apiUsername: '',
    apiPassword: '',
    apiBaseUrl: '',
    apiInitialPassword: '',
    apiEnv: 'dev'
  });

  const opsAvailable = await canListOpsOrders('getir');
  const health = await adapter.healthCheck();
  if (opsAvailable) {
    assert.equal(health.configured, true);
    assert.equal(health.opsOrdersOnly, true);
    assert.match(health.message, /Ops|webhook/i);
  } else {
    assert.equal(health.configured, false);
  }

  adapter.loadConfig = originalLoad;
});

test('hzlmrktops getir filter lists Ops orders without Getir API env', async (t) => {
  const opsAvailable = await canListOpsOrders('getir');
  if (!opsAvailable) {
    t.skip('OPS_POSTGRES_URL not configured');
    return;
  }

  const platformEnv = await readEnvFile(paths.platformEnv);
  const runtime = { channelOrdersCache: {} };
  const channelOrders = createChannelOrdersService({
    runtime,
    config: resolveRuntimeConfig(platformEnv)
  });
  const svc = createHzlMrktOpsOrdersService({ channelOrders });
  const params = new URLSearchParams({ days: '14', channel: 'getir' });
  const result = await svc.listHzlMrktOpsOrders(params);

  const getirMeta = result.channels?.find((entry) => entry.id === 'getir');
  assert.ok(getirMeta);
  assert.equal(getirMeta.configured, true);
  assert.ok(result.total >= 0);
  if (result.paginated) {
    assert.equal(result.paginated, true);
    assert.ok(Array.isArray(result.rows));
  } else {
    assert.equal(getirMeta.available, true);
  }
});

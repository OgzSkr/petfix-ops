#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.env.PETFIX_ENV_FILE
  ? path.join(__dirname, '..', process.env.PETFIX_ENV_FILE)
  : path.join(__dirname, '..', '.env');

function readEnvToken() {
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('PLATFORM_API_TOKEN=')) {
        return trimmed.slice('PLATFORM_API_TOKEN='.length).trim();
      }
      if (trimmed.startsWith('AUTH_ALLOW_INSECURE=') && trimmed.endsWith('true')) {
        return null;
      }
    }
  } catch {
    return process.env.PLATFORM_API_TOKEN || '';
  }
  return process.env.PLATFORM_API_TOKEN || '';
}

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 8787;
const base = `http://${host}:${port}`;
const token = readEnvToken();

async function check(name, url, expectStatus = 200, options = {}) {
  const response = await fetch(url, options);
  if (response.status !== expectStatus) {
    throw new Error(`${name}: expected ${expectStatus}, got ${response.status}`);
  }
  return response;
}

function cookieHeaderFromLogin(response) {
  const raw = response.headers.getSetCookie?.() || [];
  if (raw.length) {
    return raw.map((entry) => entry.split(';')[0]).join('; ');
  }
  const single = response.headers.get('set-cookie');
  if (!single) return '';
  return single.split(';')[0];
}

async function loginWithCookie(token) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  if (response.status !== 200) {
    throw new Error(`auth login: expected 200, got ${response.status}`);
  }
  const cookie = cookieHeaderFromLogin(response);
  if (!cookie) {
    throw new Error('auth login: Set-Cookie missing');
  }
  return { headers: { Authorization: `Bearer ${token}`, Cookie: cookie } };
}

async function main() {
  const checks = [];

  await check('health', `${base}/api/health`);
  checks.push('health');

  await check('ops liveness', `${base}/health`);
  checks.push('ops-liveness');

  const readyResponse = await fetch(`${base}/ready`);
  if (readyResponse.status !== 200 && readyResponse.status !== 503) {
    throw new Error(`ops ready: expected 200 or 503, got ${readyResponse.status}`);
  }
  const readyBody = await readyResponse.json();
  if (!readyBody.status) {
    throw new Error('ops ready: missing status field');
  }
  checks.push('ops-ready');

  await check('webhook health', `${base}/webhooks/v1/health`);
  checks.push('webhook-health');

  await check('hzlmrktops siparisler page', `${base}/hzlmrktops/siparisler`);
  checks.push('hzlmrktops-siparisler-page');

  await check('hzlmrktops integrations page', `${base}/hzlmrktops/integrations`);
  checks.push('hzlmrktops-integrations-page');

  await check('dashboard without token', `${base}/api/dashboard`, 401);
  checks.push('dashboard-auth-block');

  if (token) {
    const headers = { Authorization: `Bearer ${token}` };
    const session = await loginWithCookie(token);
    const sessionHeaders = session.headers;
    checks.push('auth-login-cookie');

    await check('dashboard with token', `${base}/api/dashboard`, 200, { headers });
    checks.push('dashboard-auth-ok');

    await check('hzlmrktops orders api', `${base}/api/hzlmrktops/orders?days=1`, 200, { headers });
    const hzOrders = await (await fetch(`${base}/api/hzlmrktops/orders?days=1`, { headers })).json();
    if (!Array.isArray(hzOrders.rows) || typeof hzOrders.total !== 'number') {
      throw new Error('hzlmrktops orders: missing rows/total');
    }
    checks.push('hzlmrktops-orders-list');

    const getirOrdersRes = await fetch(`${base}/api/hzlmrktops/orders?days=14&channel=getir`, { headers });
    if (getirOrdersRes.status !== 200) {
      throw new Error(`getir channel orders: expected 200, got ${getirOrdersRes.status}`);
    }
    const getirOrders = await getirOrdersRes.json();
    if (!Array.isArray(getirOrders.rows)) {
      throw new Error('getir channel orders: missing rows');
    }
    checks.push('getir-channel-orders-api');

    const thumbDenied = await fetch(`${base}/api/product-thumb-img?barcode=8690000000001`);
    if (thumbDenied.status !== 401) {
      throw new Error(`product-thumb-img unauth: expected 401, got ${thumbDenied.status}`);
    }
    checks.push('product-thumb-img-auth-block');

    const thumbAuthed = await fetch(`${base}/api/product-thumb-img?barcode=8690000000001`, {
      headers: sessionHeaders,
      redirect: 'manual'
    });
    if (thumbAuthed.status !== 302 && thumbAuthed.status !== 404) {
      throw new Error(`product-thumb-img authed: expected 302 or 404, got ${thumbAuthed.status}`);
    }
    checks.push('product-thumb-img-auth-ok');

    const badJsonRes = await fetch(`${base}/api/products/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{ invalid'
    });
    if (badJsonRes.status !== 400) {
      throw new Error(`invalid json body: expected 400, got ${badJsonRes.status}`);
    }
    checks.push('invalid-json-400');

    await check('buybox analytics', `${base}/api/buybox/analytics?days=7`, 200, { headers });
    checks.push('buybox-analytics');

    await check('commission tariff status', `${base}/api/commission-tariff`, 200, { headers });
    checks.push('commission-tariff');

    await check('commission tariff preview', `${base}/api/commission-tariff/preview`, 200, { headers });
    checks.push('commission-tariff-preview');

    const bulkResponse = await check('commission tariff bulk-select', `${base}/api/commission-tariff/bulk-select`, 200, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({ minNetProfit: 0, minProfitRate: 0, tiers: [4, 3, 2] })
    });
    const bulk = await bulkResponse.json();
    if (!bulk.summary || typeof bulk.summary.total !== 'number') {
      throw new Error('commission tariff bulk-select: missing summary');
    }
    checks.push('commission-tariff-bulk-select');

    const exportResponse =     await check('commission tariff export', `${base}/api/commission-tariff/export`, 200, { headers });
    const contentType = exportResponse.headers.get('content-type') || '';
    if (!contentType.includes('spreadsheetml')) {
      throw new Error(`commission tariff export: unexpected content-type ${contentType}`);
    }
    checks.push('commission-tariff-export');

    await check('commission tariff analysis', `${base}/api/commission-tariff/analysis`, 200, { headers });
    const analysisResponse = await fetch(`${base}/api/commission-tariff/analysis`, { headers });
    const analysis = await analysisResponse.json();
    if (!analysis.summary || typeof analysis.summary.missingBuybox !== 'number') {
      throw new Error('commission tariff analysis: missing summary');
    }
    checks.push('commission-tariff-analysis');

    const batchResponse = await check('buybox refresh batch', `${base}/api/buybox/refresh-batch`, 200, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({ missingFromTariff: true, maxCount: 1 })
    });
    const batch = await batchResponse.json();
    if (typeof batch.requested !== 'number') {
      throw new Error('buybox refresh batch: missing requested count');
    }
    checks.push('buybox-refresh-batch');

    const syncCatalogResponse = await check('commission tariff sync catalog', `${base}/api/commission-tariff/sync-catalog`, 200, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      method: 'POST'
    });
    const syncCatalog = await syncCatalogResponse.json();
    if (!syncCatalog.catalogSync) {
      throw new Error('commission tariff sync catalog: missing catalogSync');
    }
    checks.push('commission-tariff-sync-catalog');

    const importMissingResponse = await fetch(`${base}/api/products/import`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (importMissingResponse.status !== 400) {
      throw new Error(`products import validation: expected 400, got ${importMissingResponse.status}`);
    }
    checks.push('products-import-validation');

    const opsResponse = await check('ops status', `${base}/api/ops/status`, 200, { headers });
    const ops = await opsResponse.json();
    if (!ops.db || !ops.worker || !ops.cache) {
      throw new Error('ops status: missing expected fields');
    }
    checks.push('ops-status');

    await check('channels summary', `${base}/api/dashboard/channels-summary?days=14`, 200, { headers });
    checks.push('channels-summary');

    await check(
      'live performance api',
      `${base}/api/dashboard/live-performance?days=1&channel=trendyol-marketplace`,
      200,
      { headers }
    );
    checks.push('live-performance-api');

    await check('uber eats settings', `${base}/api/uber-eats-settings`, 200, { headers });
    checks.push('uber-eats-settings');

    await check('yemeksepeti settings', `${base}/api/yemeksepeti-settings`, 200, { headers });
    checks.push('yemeksepeti-settings');
    await check('yemeksepeti status', `${base}/api/yemeksepeti/status`, 200, { headers });
    checks.push('yemeksepeti-status');

    await check('ops hub config', `${base}/ops/v1/config`, 200, { headers });
    checks.push('ops-hub-config');

    await check('ops integrations list', `${base}/ops/v1/integrations`, 200, { headers });
    checks.push('ops-integrations-api');

    await check('admin channel status', `${base}/api/admin/channel-status`, 200, { headers });
    checks.push('admin-channel-status');
  }

  await check('login page', `${base}/login`);
  checks.push('login');

  const rootResponse = await fetch(`${base}/`, { redirect: 'manual' });
  if (rootResponse.status !== 302) {
    throw new Error(`root redirect: expected 302, got ${rootResponse.status}`);
  }
  checks.push('root-redirect');

  await check('general dashboard', `${base}/dashboard`);
  checks.push('dashboard-page');

  await check('trendyol marketplace', `${base}/trendyol`);
  checks.push('trendyol-page');

  await check('commission tariff page', `${base}/marketplace/trendyol`);
  checks.push('marketplace-trendyol-page');

  await check('live performance page', `${base}/marketplace/live-performance`);
  checks.push('marketplace-live-performance-page');

  await check('live performance asset', `${base}/assets/live-performance.js`);
  checks.push('live-performance-asset');

  await check('shipping page', `${base}/marketplace/shipping`);
  checks.push('marketplace-shipping-page');

  await check('uber eats page', `${base}/uber-eats`);
  checks.push('uber-eats-page');

  await check('yemeksepeti page', `${base}/yemeksepeti`);
  checks.push('yemeksepeti-page');

  if (token) {
    const headers = { Authorization: `Bearer ${token}` };
    const envText = fs.readFileSync(envPath, 'utf8');

    const channelOrdersResponse = await fetch(`${base}/api/channels/uber-eats/orders`, { headers });
    const uberConfigured = envText.includes('UBER_EATS_API_KEY=');
    const uberExpectedStatus = uberConfigured ? 200 : 503;
    if (channelOrdersResponse.status !== uberExpectedStatus) {
      throw new Error(`uber-eats orders: expected ${uberExpectedStatus}, got ${channelOrdersResponse.status}`);
    }
    checks.push('uber-eats-orders-api');

    const ysOrdersResponse = await fetch(`${base}/api/channels/yemeksepeti/orders`, { headers });
    const ysConfigured =
      /YEMEKSEPETI_CLIENT_ID=\S+/.test(envText) && /YEMEKSEPETI_CLIENT_SECRET=\S+/.test(envText);
    const ysExpectedStatus = ysConfigured ? 200 : 503;
    if (ysOrdersResponse.status !== ysExpectedStatus) {
      throw new Error(`yemeksepeti orders: expected ${ysExpectedStatus}, got ${ysOrdersResponse.status}`);
    }
    checks.push('yemeksepeti-orders-api');
  }

  await check('settings page', `${base}/admin/settings`);
  checks.push('settings-page');

  console.log(JSON.stringify({ ok: true, base, checks: checks.length, passed: checks }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});

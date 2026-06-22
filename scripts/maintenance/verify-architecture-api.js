#!/usr/bin/env node
/**
 * Mimari refactor'un production'a deploy edilip edilmediğini doğrular.
 *   node scripts/maintenance/verify-architecture-api.js
 *   BASE_URL=https://api.petfix.com.tr node scripts/maintenance/verify-architecture-api.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function readTokenFromEnvFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('PLATFORM_API_TOKEN=')) {
        return trimmed.slice('PLATFORM_API_TOKEN='.length).trim();
      }
    }
  } catch {
    return '';
  }
  return '';
}

async function fetchJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const base = (process.env.BASE_URL || 'http://127.0.0.1:8899').replace(/\/$/, '');
  const token =
    process.env.PLATFORM_API_TOKEN ||
    readTokenFromEnvFile(path.join(root, process.env.PETFIX_ENV_FILE || '.env.production')) ||
    readTokenFromEnvFile(path.join(root, '.env'));

  const report = {
    baseUrl: base,
    checkedAt: new Date().toISOString(),
    auth: Boolean(token),
    architectureDeployed: false,
    checks: {}
  };

  const health = await fetchJson(`${base}/health`, null);
  report.checks.health = { ok: health.ok, status: health.status };

  if (!token) {
    report.error = 'PLATFORM_API_TOKEN gerekli — .env veya .env.production';
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const channels = await fetchJson(`${base}/api/channels/health`, token);
  report.checks.channelsHealth = { ok: channels.ok, status: channels.status };

  const getir = channels.body?.channels?.find((c) => c.id === 'getir');
  const hasCapabilities = Boolean(getir?.capabilities && getir?.capabilityGaps);
  report.checks.capabilities = {
    ok: hasCapabilities,
    getirFetchOrders: getir?.capabilities?.fetchOrders || null,
    getirGaps: getir?.capabilityGaps || null
  };

  const ops = await fetchJson(`${base}/api/ops/status`, token);
  report.checks.opsStatus = { ok: ops.ok, status: ops.status };
  const hasOpsPoll = ops.body?.opsPoll != null;
  report.checks.opsPoll = {
    ok: hasOpsPoll,
    enabled: ops.body?.opsPoll?.settings?.enabled ?? null,
    scheduled: ops.body?.opsPoll?.scheduled ?? null
  };

  const controlBoard = await fetchJson(`${base}/api/channels/control-board`, token);
  report.checks.controlBoard = {
    ok: controlBoard.ok && controlBoard.body?.ok === true,
    status: controlBoard.status,
    opsChannelCount: controlBoard.body?.opsChannels?.length ?? 0,
    hasWorkers: Boolean(controlBoard.body?.workers?.opsPoll && controlBoard.body?.workers?.matchingSync)
  };

  const branches = await fetchJson(`${base}/api/ops/branches`, token);
  const branchList = branches.body?.branches || [];
  report.checks.branches = {
    ok: branches.ok && Array.isArray(branchList) && branchList.length > 0,
    status: branches.status,
    count: branchList.length,
    defaultSlug: branchList[0]?.slug || null
  };

  const webhookHealth = await fetchJson(`${base}/webhooks/v1/branches/main/yemeksepeti/orders`, null);
  report.checks.branchWebhookHealth = {
    ok: webhookHealth.ok,
    status: webhookHealth.status,
    endpoint: webhookHealth.body?.endpoint || null
  };

  const marketplaceBlocked = await fetchJson(`${base}/marketplace/trendyol`, token);
  report.checks.opsOnlyMarketplaceBlocked = {
    ok: marketplaceBlocked.status === 404,
    status: marketplaceBlocked.status
  };

  report.architectureDeployed =
    hasCapabilities &&
    hasOpsPoll &&
    report.checks.controlBoard.ok &&
    report.checks.branches.ok &&
    report.checks.opsOnlyMarketplaceBlocked.ok;

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.architectureDeployed ? 0 : 2);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

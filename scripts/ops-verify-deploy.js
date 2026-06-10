#!/usr/bin/env node
/**
 * Deploy sonrası sağlık kontrolü — local veya production base URL.
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';

const platformEnv = await readEnvFile(paths.platformEnv);
const config = resolveOpsHubConfig(platformEnv);
const base = process.argv[2] || process.env.OPS_VERIFY_BASE || config.publicApiBaseUrl || 'http://127.0.0.1:8787';
const token = process.env.PLATFORM_API_TOKEN || platformEnv.PLATFORM_API_TOKEN || '';

const checks = [];
let failed = 0;

async function check(name, url, { auth = false, expectOk = true } = {}) {
  const headers = auth && token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const response = await fetch(url, { headers });
    const data = await response.json().catch(() => ({}));
    const ok = expectOk ? response.ok && data.ok !== false : response.ok;
    checks.push({ name, ok, status: response.status, detail: ok ? 'OK' : JSON.stringify(data).slice(0, 120) });
    if (!ok) failed += 1;
  } catch (error) {
    checks.push({ name, ok: false, status: 0, detail: error.message });
    failed += 1;
  }
}

console.log(`\nPetFix Ops deploy verify — ${base}\n`);

await check('GET /health', `${base}/health`);
await check('GET /ready', `${base}/ready`);
await check('GET /ops/v1/config', `${base}/ops/v1/config`, { auth: true });
await check('GET /ops/v1/integrations/health', `${base}/ops/v1/integrations/health`, { auth: true });
await check('GET /webhooks/v1/health', `${base}/webhooks/v1/health`);

for (const row of checks) {
  const icon = row.ok ? '✓' : '✗';
  console.log(`${icon} ${row.name} [${row.status}] ${row.detail}`);
}

console.log('');
if (failed) {
  console.error(`${failed} kontrol başarısız.`);
  process.exit(1);
}
console.log('Tüm kontroller geçti.');
console.log('Sonraki: npm run ops:webhook-setup (YS portal bilgileri)\n');

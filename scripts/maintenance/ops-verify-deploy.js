#!/usr/bin/env node
/**
 * Deploy sonrası sağlık kontrolü — local veya production base URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile } from '../../lib/env.js';
import { paths } from '../../lib/config.js';
import { resolveOpsHubConfig } from '../../lib/ops-hub/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function resolvePlatformEnvPath() {
  if (process.env.PETFIX_ENV_FILE) {
    const rel = process.env.PETFIX_ENV_FILE.replace(/^\.\//, '');
    return path.isAbsolute(process.env.PETFIX_ENV_FILE)
      ? process.env.PETFIX_ENV_FILE
      : path.join(ROOT, rel);
  }
  const verifyBase = process.argv[2] || process.env.OPS_VERIFY_BASE || '';
  if (String(verifyBase).includes('api.petfix.com.tr')) {
    const prodPath = path.join(ROOT, '.env.production');
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }
  }
  const prodPath = path.join(ROOT, '.env.production');
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }
  return paths.platformEnv;
}

const platformEnv = await readEnvFile(resolvePlatformEnvPath());
const config = resolveOpsHubConfig(platformEnv);
const base = process.argv[2] || process.env.OPS_VERIFY_BASE || config.publicApiBaseUrl || 'http://127.0.0.1:8787';
const token = process.env.PLATFORM_API_TOKEN || platformEnv.PLATFORM_API_TOKEN || '';

const checks = [];
let failed = 0;

async function check(name, url, { auth = false, expectOk = true, optional = false } = {}) {
  const headers = auth && token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const response = await fetch(url, { headers });
    const data = await response.json().catch(() => ({}));
    const ok = expectOk ? response.ok && data.ok !== false : response.ok;
    if (!ok && auth && !token) {
      checks.push({ name, ok: true, status: response.status, detail: 'SKIP (token yok)' });
      return;
    }
    checks.push({ name, ok, status: response.status, detail: ok ? 'OK' : JSON.stringify(data).slice(0, 120) });
    if (!ok && !optional) failed += 1;
  } catch (error) {
    checks.push({ name, ok: false, status: 0, detail: error.message });
    if (!optional) failed += 1;
  }
}

console.log(`\nPetFix Ops deploy verify — ${base}\n`);
if (token) {
  console.log('Auth: PLATFORM_API_TOKEN yüklü\n');
}

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

#!/usr/bin/env node
/**
 * Yerelde otomatik çalıştırılabilen tüm Ops adımlarını sırayla yapar.
 * DNS / VPS / partner portal adımları için engel raporu verir.
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const platformEnv = await readEnvFile(paths.platformEnv);
const config = resolveOpsHubConfig(platformEnv);
const token = platformEnv.PLATFORM_API_TOKEN || process.env.PLATFORM_API_TOKEN || '';
const base = process.env.OPS_VERIFY_BASE || 'http://127.0.0.1:8787';

const blockers = [];

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

function step(title, fn) {
  return fn().then(
    (result) => {
      console.log(`✓ ${title}`);
      return result;
    },
    (error) => {
      console.log(`✗ ${title}: ${error.message}`);
      return null;
    }
  );
}

console.log('\n=== PetFix Ops Autopilot ===\n');

// DNS check
try {
  const dns = execSync('dig +short api.petfix.com.tr A 2>/dev/null', { encoding: 'utf8' }).trim();
  if (!dns) {
    blockers.push({
      id: 'dns',
      action: 'Güzel.net.tr DNS panelinde api.petfix.com.tr A kaydı → VPS IP',
      owner: 'Siz (panel girişi gerekli — agent erişemez)'
    });
    console.log('✗ DNS: api.petfix.com.tr A kaydı yok');
  } else {
    console.log(`✓ DNS: api.petfix.com.tr → ${dns}`);
  }
} catch {
  blockers.push({ id: 'dns', action: 'DNS kontrol edilemedi', owner: 'Manuel' });
}

await step('Health check', async () => {
  const r = await api('/health');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.data;
});

await step('BenimPOS master sync', async () => {
  const r = await api('/api/product-matching/sync-master', { method: 'POST', body: '{}' });
  if (!r.data.ok) throw new Error(r.data.error || 'sync-master failed');
  if (r.data.started || r.data.running) {
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, i === 0 ? 500 : 2000));
      const status = await api('/api/product-matching/sync-master/status');
      if (status.data.running) continue;
      if (status.data.error) throw new Error(status.data.error);
      return status.data.result || status.data;
    }
    throw new Error('sync-master timeout');
  }
  return r.data;
});

await step('YS katalog sync', async () => {
  const r = await api('/api/product-matching/sync-yemeksepeti-catalog', { method: 'POST', body: '{}' });
  if (!r.data.ok) throw new Error(r.data.error || 'ys catalog failed');
  return r.data;
});

await step('TGO kanal sync', async () => {
  const r = await api('/api/product-matching/sync-uber-channel', { method: 'POST', body: '{}' });
  if (!r.data.ok) throw new Error(r.data.error || 'uber channel failed');
  return r.data;
});

await step('Otomatik eşleştirme', async () => {
  const r = await api('/api/product-matching/run-auto-match', {
    method: 'POST',
    body: JSON.stringify({ limit: 500 })
  });
  if (!r.data.ok) throw new Error(r.data.error || 'auto-match failed');
  return r.data;
});

await step('Otomatik eşleşmeleri onayla', async () => {
  const r = await api('/api/product-matching/confirm-auto-matched-bulk', { method: 'POST', body: '{}' });
  if (!r.data.ok && !r.data.confirmed) throw new Error(r.data.error || 'confirm failed');
  return r.data;
});

await step('Kanal poll (TGO+YS)', async () => {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/ops-hub-poll.js'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`poll exit ${code}`));
      else {
        const line = out.trim().split('\n').filter(Boolean).pop() || '{}';
        resolve(JSON.parse(line));
      }
    });
  });
});

await step('Shadow readiness', async () => {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/dev/ops-shadow-readiness.js'], {
      cwd: projectRoot,
      stdio: 'inherit'
    });
    child.on('close', (code) => {
      if (code !== 0) resolve({ ready: false });
      else resolve({ ready: true });
    });
  });
});

blockers.push({
  id: 'vps',
  action: 'VPS SSH + deploy/vps-setup.sh (sunucu IP/kullanıcı/şifre .env veya panelde yok)',
  owner: 'Siz — IP ve SSH bilgisi paylaşırsanız agent bir sonraki turda deploy script çalıştırabilir'
});

blockers.push({
  id: 'ys-webhook',
  action: 'partner-app.yemeksepeti.com → Order Webhook Management → URL + secret kaydı',
  owner: 'Siz — partner portal oturumu gerekli (agent giriş yapamaz)',
  urls: {
    orders: `${config.publicApiBaseUrl}/webhooks/v1/yemeksepeti/orders`,
    catalog: `${config.publicApiBaseUrl}/webhooks/v1/yemeksepeti/catalog`
  }
});

blockers.push({
  id: 'getir',
  action: 'Getir credential + whitelist',
  owner: 'Getir bölge yöneticisi'
});

console.log('\n=== Dış adımlar (agent yapamaz) ===\n');
for (const b of blockers) {
  console.log(`• ${b.action}`);
  console.log(`  → ${b.owner}`);
  if (b.urls) {
    console.log(`  → Sipariş: ${b.urls.orders}`);
  }
}

console.log('\nYerel autopilot tamamlandı.\n');

/**
 * Yemeksepeti Partner Portal sipariş sync worker'ı.
 *
 * CDP yakalama (Chrome) + JSON kayıt + Ops DB ingest + satır zenginleştirme.
 * CLI script'ler ince sarmalayıcı olarak bu modülü çağırır.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { paths } from '../../config.js';
import { readEnvFile } from '../../env.js';
import { resolveOpsHubConfig } from '../config.js';
import { createOpsPool, closeOpsPool, applyOpsMigrations } from '../db/migrate.js';
import { ensureDefaultBranch } from '../db/repository.js';
import { parsePortalListOrdersPayload } from '../../channels/yemeksepeti-portal-orders.js';
import { syncYemeksepetiPortalSummaries } from '../sync/ys-portal-sync.js';
import { runYemeksepetiLinesEnrich } from './order-lines-enrich-worker.js';

const DEFAULT_OUT = path.join(paths.root, 'data', 'ys-portal-orders.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function cdpSend(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout ${method}`)), 120000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/**
 * Partner Portal /orders GraphQL yanıtını Chrome CDP ile yakalar.
 * @param {object} [options]
 * @returns {Promise<string|null>} ham GraphQL JSON metni
 */
export async function captureYemeksepetiPortalOrdersPayload(options = {}) {
  const CHROME = options.chromePath || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const CHROME_PROFILE = options.chromeProfile || process.env.CHROME_PROFILE || 'Profile 2';
  const PROFILE = path.resolve(
    options.chromeAutomationDir ||
      process.env.CHROME_AUTOMATION_DIR ||
      path.join(os.tmpdir(), 'petfix-chrome-automation')
  );
  const CDP_PORT = Number(options.cdpPort || process.env.CDP_PORT || 9333);

  try {
    execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' });
  } catch {
    /* Chrome zaten kapalı olabilir */
  }

  await sleep(800);
  spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    'about:blank'
  ], { stdio: 'ignore', detached: true }).unref();

  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      if (i === 24) throw new Error('CDP bağlantısı kurulamadı');
    }
  }

  await sleep(2000);
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.onerror = reject;
  });

  await cdpSend(ws, 'Network.enable', { maxTotalBufferSize: 30000000, maxResourceBufferSize: 15000000 });
  let payload = null;

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method !== 'Network.loadingFinished' || payload) return;
    try {
      const bodyResult = await cdpSend(ws, 'Network.getResponseBody', { requestId: msg.params.requestId });
      const text = bodyResult.base64Encoded
        ? Buffer.from(bodyResult.body, 'base64').toString('utf8')
        : bodyResult.body;
      if (text?.includes('listOrders') && text.includes('jk2w-')) {
        payload = text;
      }
    } catch {
      /* başka network yanıtları */
    }
  });

  await cdpSend(ws, 'Page.navigate', { url: 'https://partner-app.yemeksepeti.com/orders' });
  await sleep(options.captureWaitMs ?? 18000);
  ws.close();
  return payload;
}

/**
 * Portal GraphQL ham metnini parse edip Ops DB'ye yazar.
 */
export async function ingestYemeksepetiPortalPayload(raw, options = {}) {
  const summaries = parsePortalListOrdersPayload(raw);
  const platformEnv = options.platformEnv || (await readEnvFile(paths.platformEnv));
  const config = resolveOpsHubConfig(platformEnv);

  if (!config.postgresEnabled) {
    return {
      ok: true,
      postgresSkipped: true,
      orders: summaries.length,
      message: 'OPS_POSTGRES_URL yok — yalnızca parse edildi'
    };
  }

  const pool = await createOpsPool(config.postgresUrl);
  try {
    await applyOpsMigrations(pool);
    await ensureDefaultBranch(pool);
    const ingest = await syncYemeksepetiPortalSummaries(pool, summaries, {
      platformEnv,
      shadowMode: options.shadowMode ?? true
    });
    return { ok: true, orders: summaries.length, ingest };
  } finally {
    await closeOpsPool();
  }
}

/**
 * Kayıtlı JSON dosyasından portal siparişlerini ingest eder.
 */
export async function ingestYemeksepetiPortalFromFile(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    const err = new Error(`Dosya yok: ${resolved}`);
    err.code = 'ENOENT';
    throw err;
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const result = await ingestYemeksepetiPortalPayload(raw, options);
  return { ...result, filePath: resolved };
}

/**
 * CDP yakalama → JSON kayıt → Ops ingest → (opsiyonel) satır zenginleştirme.
 */
export async function runYemeksepetiPortalSync(options = {}) {
  const outPath = options.outPath || DEFAULT_OUT;
  const raw = await captureYemeksepetiPortalOrdersPayload(options);
  if (!raw) {
    const err = new Error('Portal sipariş yanıtı yakalanamadı — YS oturumu gerekli.');
    err.code = 'PORTAL_CAPTURE_EMPTY';
    throw err;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, raw);

  const summaries = parsePortalListOrdersPayload(raw);
  const capture = { step: 'capture', out: outPath, orders: summaries.length };

  const ingest = await ingestYemeksepetiPortalPayload(raw, options);

  let enrich = null;
  if (options.enrichLines !== false && ingest.ok && !ingest.postgresSkipped) {
    enrich = await runYemeksepetiLinesEnrich({
      platformEnv: options.platformEnv,
      limit: options.enrichLimit ?? 100
    });
  }

  return {
    ok: true,
    capture,
    ingest,
    enrich,
    finishedAt: new Date().toISOString()
  };
}

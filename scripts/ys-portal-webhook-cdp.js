#!/usr/bin/env node
/**
 * Chrome DevTools Protocol ile YS Partner Portal webhook formunu doldurur.
 * Cevizlibağ Chrome profili (Profile 2) oturumunu kopyalayarak kullanır.
 */
import { spawn, execSync } from 'node:child_process';
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { buildYemeksepetiPortalWebhookSecret } from '../lib/ops-hub/webhooks/webhook-auth.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_SRC = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2'; // Cevizlibağ
const PROFILE = path.join(os.tmpdir(), 'petfix-chrome-cevizlibag');
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const CHAIN_ID = '24fbaadf-e4d9-4040-87ce-7fa93ff26a19';
const TARGET_URL = `https://partner-app.yemeksepeti.com/shops-integrations/chain/${CHAIN_ID}`;

const platformEnv = await readEnvFile(paths.platformEnv);
const config = resolveOpsHubConfig(platformEnv);
const secret = String(platformEnv.YEMEKSEPETI_WEBHOOK_SECRET || '').trim();
const orderUrl = `${config.publicApiBaseUrl}/webhooks/v1/yemeksepeti/orders`;
const portalSecret = buildYemeksepetiPortalWebhookSecret(secret, 'petfix');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function syncCevizlibagProfile() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const srcProfile = path.join(CHROME_SRC, CHROME_PROFILE);
  const dstProfile = path.join(PROFILE, CHROME_PROFILE);
  if (!fs.existsSync(srcProfile)) {
    throw new Error(`Chrome profili bulunamadı: ${srcProfile}`);
  }
  console.log(`Profil kopyalanıyor: ${CHROME_PROFILE} (Cevizlibağ)…`);
  execSync(`rsync -a --delete "${srcProfile}/" "${dstProfile}/"`, { stdio: 'inherit' });
  for (const file of ['Local State', 'First Run']) {
    const src = path.join(CHROME_SRC, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(PROFILE, file));
    }
  }
}

function stopCdpChrome() {
  try {
    execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' });
  } catch {
    /* yok */
  }
}

async function cdpEvaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('evaluate timeout')), 90000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === 1) {
        clearTimeout(timeout);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result?.result?.value);
      }
    });
    ws.addEventListener('error', reject);
  });
}

async function cdpNavigate(tab, url) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('navigate timeout')), 30000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
      ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: '1' } }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === 2) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    ws.addEventListener('error', reject);
  });
}

const fillJs = `(async function(){
  const ORDER_URL = ${JSON.stringify(orderUrl)};
  const PORTAL_SECRET = ${JSON.stringify(portalSecret)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').trim().toLowerCase()
    .replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ü/g, 'u').replace(/ç/g, 'c').replace(/ğ/g, 'g');
  const clickBtn = (re) => {
    const el = Array.from(document.querySelectorAll('button')).find((b) => re.test(norm(b.innerText)));
    if (el) { el.click(); return (el.innerText || '').trim().slice(0, 80); }
    return null;
  };
  const dismissDialogs = async () => {
    for (let i = 0; i < 3; i += 1) {
      const closed = clickBtn(/^(tamam|iptal|kapat|close|cancel)$/);
      if (!closed) break;
      await sleep(400);
    }
  };
  const scrollMain = async (steps = 35) => {
    const area = document.querySelector('[class*="scroll-area-content"]');
    if (area) {
      area.scrollTop = 0;
      await sleep(300);
      for (let i = 0; i < steps; i += 1) {
        area.scrollTop += 280;
        await sleep(160);
      }
    } else {
      window.scrollTo(0, 0);
      for (let i = 0; i < steps; i += 1) {
        window.scrollBy(0, 280);
        await sleep(160);
      }
    }
  };
  const setInput = (input, value) => {
    if (!input) return false;
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    native.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  if (/login/i.test(location.pathname)) {
    return { ok: false, reason: 'login_required', url: location.href };
  }
  const steps = [];
  const findChainAyarlarButton = () => {
    const row = Array.from(document.querySelectorAll('div,section,article,li,tr')).find((el) => {
      const text = el.innerText || '';
      return text.includes('jk2w') && text.includes('Ayarlar') && text.length < 400;
    });
    if (row) {
      return Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Ayarlar') || null;
    }
    const ayarlarBtns = Array.from(document.querySelectorAll('button')).filter((b) => (b.innerText || '').trim() === 'Ayarlar');
    return ayarlarBtns.find((b) => {
      let parent = b.parentElement;
      for (let i = 0; i < 8 && parent; i += 1) {
        if ((parent.innerText || '').includes('jk2w')) return true;
        parent = parent.parentElement;
      }
      return false;
    }) || ayarlarBtns[ayarlarBtns.length - 1] || null;
  };
  await dismissDialogs();
  const chainBtn = findChainAyarlarButton();
  if (!chainBtn) {
    return { ok: false, reason: 'chain_ayarlar_missing', url: location.href };
  }
  chainBtn.click();
  steps.push('chain-ayarlar-jk2w');
  await sleep(8000);
  await dismissDialogs();
  steps.push(clickBtn(/^api'?si$/));
  await sleep(5000);
  await scrollMain(40);
  await sleep(2000);
  const webhookBtn = Array.from(document.querySelectorAll('button')).find((b) =>
    /^siparis webhook ayarlari$/.test(norm(b.innerText))
    || /^order webhook settings$/.test(norm(b.innerText))
    || /^order webhook management$/.test(norm(b.innerText))
  );
  if (!webhookBtn) {
    const visibleBtns = Array.from(document.querySelectorAll('button'))
      .map((b) => (b.innerText || '').trim())
      .filter(Boolean)
      .filter((t) => /webhook|secret|management|configure|direct|siparis/i.test(t));
    return {
      ok: false,
      reason: 'webhook_settings_button_missing',
      steps,
      visibleBtns,
      url: location.href
    };
  }
  webhookBtn.click();
  steps.push(webhookBtn.innerText.trim());
  await sleep(4000);
  await dismissDialogs();
  const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]),textarea'));
  const urlField = inputs.find((i) =>
    /url|api|endpoint|your api|gonderilecegi|gönderileceği/i.test(
      (i.placeholder || '') + (i.name || '') + (i.getAttribute('aria-label') || '')
    )
  );
  const secretField = inputs.find((i) =>
    /secret|gizli|token|authorization|sirri|sır/i.test(
      (i.placeholder || '') + (i.name || '') + (i.getAttribute('aria-label') || '')
    )
  );
  const filledUrl = setInput(urlField, ORDER_URL);
  const filledSecret = setInput(secretField, PORTAL_SECRET);
  await sleep(600);
  const saved = clickBtn(/^kaydet$|^save$/);
  await sleep(2500);
  return {
    ok: Boolean(filledUrl && filledSecret && saved),
    steps,
    saved,
    urlValue: (urlField?.value || '').slice(0, 120),
    secretLen: (secretField?.value || '').length,
    fieldCount: inputs.length,
    inputPlaceholders: inputs.map((i) => i.placeholder).filter(Boolean),
    url: location.href
  };
})()`;

async function findYsTab() {
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return tabs.find((t) => t.url?.includes('yemeksepeti.com')) || tabs[0];
}

async function main() {
  stopCdpChrome();
  await sleep(1500);
  syncCevizlibagProfile();

  console.log(`Chrome CDP (${CHROME_PROFILE}) → port ${CDP_PORT}`);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    TARGET_URL
  ], { stdio: 'ignore', detached: true });
  chrome.unref();

  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      if (i === 24) {
        console.error('CDP bağlantısı kurulamadı');
        process.exit(1);
      }
    }
  }

  console.log('Sayfa yükleniyor…');
  await sleep(6000);

  let tab = await findYsTab();
  let status = await cdpEvaluate(tab, `({ href: location.href, loggedIn: !/\\/login/i.test(location.pathname) })`);
  console.log('Oturum:', status?.href?.slice(0, 100));

  if (!status?.loggedIn) {
    console.error('\nCevizlibağ profilinde YS oturumu yok veya süresi dolmuş.');
    console.error('Açılan Chrome penceresinde giriş yapın, sonra tekrar çalıştırın.');
    process.exit(2);
  }

  if (!tab.url?.includes('shops-integrations')) {
    await cdpNavigate(tab, TARGET_URL);
    await sleep(6000);
    tab = await findYsTab();
  } else if (tab.url?.includes('updates_list_')) {
    await cdpNavigate(tab, TARGET_URL);
    await sleep(6000);
    tab = await findYsTab();
  }

  console.log('Webhook formu dolduruluyor…');
  const result = await cdpEvaluate(tab, fillJs);
  console.log('\nSonuç:', JSON.stringify(result, null, 2));

  if (!result?.ok) {
    console.log('\nForm tam doldurulamadı. CDP Chrome penceresinde Settings → API → Order Webhook Settings kontrol edin.');
    process.exit(3);
  }

  console.log('\n✓ Webhook portal kaydı tamamlandı (Cevizlibağ profili).');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

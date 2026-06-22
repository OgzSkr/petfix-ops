#!/usr/bin/env node
/**
 * Sipariş Geçmişi → her sipariş detayından ürün satırlarını toplar.
 *   node scripts/ys-portal-backfill-order-details-cdp.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { paths } from '../lib/config.js';
import {
  parsePortalOrderCodes,
  parsePortalOrderDetailLines
} from '../lib/channels/yemeksepeti-portal-order-detail.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2';
const PROFILE = path.resolve(process.env.CHROME_AUTOMATION_DIR || path.join(os.tmpdir(), 'petfix-chrome-automation'));
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const MAX_ORDERS = Number(process.env.YS_DETAIL_MAX || 30);
const OUT = path.join(paths.root, 'data', 'ys-portal-order-details.json');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function cdpSend(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout ${method}`)), 180000);
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

async function connectTab() {
  try {
    await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  } catch {
    try {
      execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' });
    } catch { /* */ }
    await sleep(800);
    spawn(CHROME, [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      `--profile-directory=${CHROME_PROFILE}`,
      '--no-first-run',
      'https://partner-app.yemeksepeti.com/'
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
  }

  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return tabs.find((t) => t.url?.includes('yemeksepeti.com') && !t.url.includes('service-worker')) || tabs[0];
}

async function evaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.onerror = reject;
  });
  const result = await cdpSend(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  ws.close();
  return result.result?.value;
}

async function main() {
  const tab = await connectTab();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.onerror = reject;
  });

  await cdpSend(ws, 'Page.navigate', { url: 'https://partner-app.yemeksepeti.com/' });
  await sleep(6000);
  await cdpSend(ws, 'Runtime.evaluate', {
    expression: `[...document.querySelectorAll('a,button,span,div')].find(e=>(e.textContent||'').trim()==='Sipariş Geçmişi')?.click()`,
    returnByValue: true
  });
  await sleep(10000);

  const listText = (await cdpSend(ws, 'Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true
  })).result?.value || '';

  const codes = parsePortalOrderCodes(listText).slice(0, MAX_ORDERS);
  const orders = [];

  for (const orderCode of codes) {
    const clickJs = `(async function(){
      const code = ${JSON.stringify(orderCode)};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      if (!/order-history|orders/i.test(location.href)) {
        [...document.querySelectorAll('a,button,span,div')].find(e => (e.textContent||'').trim()==='Sipariş Geçmişi')?.click();
        await sleep(7000);
      }
      const target = [...document.querySelectorAll('tr,[role=row],a,button,div,span,td')]
        .filter(e => (e.textContent||'').includes(code))
        .sort((a,b) => (a.textContent||'').length - (b.textContent||'').length)[0];
      if (!target) return { orderCode: code, error: 'row_not_found', text: '' };
      target.click();
      await sleep(7000);
      return { orderCode: code, url: location.href, text: document.body.innerText || '' };
    })()`;

    const detail = await cdpSend(ws, 'Runtime.evaluate', {
      expression: clickJs,
      returnByValue: true,
      awaitPromise: true
    });

    const payload = detail.result?.value || {};
    const lines = parsePortalOrderDetailLines(payload.text || '');
    orders.push({
      orderCode,
      url: payload.url || null,
      lines,
      lineCount: lines.length,
      error: payload.error || (lines.length ? null : 'no_lines')
    });

    await cdpSend(ws, 'Runtime.evaluate', {
      expression: 'history.length > 1 ? history.back() : null',
      returnByValue: true
    });
    await sleep(2500);
  }

  ws.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(orders, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    out: OUT,
    orders: orders.length,
    withLines: orders.filter((row) => row.lineCount > 0).length,
    sample: orders.find((row) => row.orderCode === 'jk2w-2624-kvq0') || orders[0]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

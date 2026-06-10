#!/usr/bin/env node
/**
 * Yemeksepeti Partner Portal — Order Webhook alanlarını otomatik doldurur.
 * Chrome'da Shop Integrations sayfası açıkken çalıştırın.
 * Gereksinim: Görünüm > Geliştirici > Apple Events'ten JavaScript'e izin ver
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { buildYemeksepetiPortalWebhookSecret } from '../lib/ops-hub/webhooks/webhook-auth.js';
import { execSync } from 'node:child_process';

const platformEnv = await readEnvFile(paths.platformEnv);
const config = resolveOpsHubConfig(platformEnv);
const secret = String(platformEnv.YEMEKSEPETI_WEBHOOK_SECRET || '').trim();
const orderUrl = `${config.publicApiBaseUrl}/webhooks/v1/yemeksepeti/orders`;
const portalSecret = buildYemeksepetiPortalWebhookSecret(secret, 'petfix');

const fillJs = `(async function(){
  const ORDER_URL = ${JSON.stringify(orderUrl)};
  const PORTAL_SECRET = ${JSON.stringify(portalSecret)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = (re) => {
    const el = Array.from(document.querySelectorAll('button,a,span,div')).find((n) => re.test((n.innerText||'').trim()));
    if (el) { el.click(); return true; }
    return false;
  };
  const setInput = (input, value) => {
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  clickText(/settings|ayarlar/i);
  await sleep(800);
  clickText(/^api$/i);
  await sleep(800);
  clickText(/order webhook settings|sipari[sş] webhook/i);
  await sleep(1200);
  const inputs = Array.from(document.querySelectorAll('input:not([type=hidden])'));
  const urlInput = inputs.find((i) => /url|api/i.test(i.placeholder||'') || /url/i.test(i.name||'')) || inputs[0];
  const secretInput = inputs.find((i) => /secret|gizli/i.test(i.placeholder||'') || /secret/i.test(i.name||'')) || inputs[1];
  setInput(urlInput, ORDER_URL);
  setInput(secretInput, PORTAL_SECRET);
  await sleep(300);
  clickText(/save|kaydet|submit/i);
  return JSON.stringify({ ok: true, orderUrl: ORDER_URL, filledUrl: !!urlInput, filledSecret: !!secretInput });
})()`;

function runChromeJs() {
  const escaped = fillJs.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
tell application "Google Chrome"
  repeat with w in windows
    set ti to 1
    repeat with t in tabs of w
      if URL of t contains "partner-app.yemeksepeti.com" then
        tell w
          tell tab ti
            return execute javascript "${escaped}"
          end tell
        end tell
      end if
      set ti to ti + 1
    end repeat
  end repeat
  return "NO_TAB"
end tell`;
  return execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { encoding: 'utf8' }).trim();
}

console.log('\n=== Yemeksepeti Webhook Portal ===\n');
console.log('Sipariş URL:', orderUrl);
console.log('Portal Secret (Basic):', portalSecret);
console.log('');

try {
  const result = runChromeJs();
  if (result === 'NO_TAB') {
    console.log('Chrome\'da YS partner sekmesi bulunamadı.');
    process.exit(1);
  }
  console.log('Portal sonucu:', result);
  process.exit(0);
} catch (error) {
  const msg = String(error.message || error);
  if (msg.includes('JavaScript') || msg.includes('Apple Events')) {
    console.log('Chrome JS kapalı. Bir kez açın: Görünüm → Geliştirici → Apple Events\'ten JavaScript\'e izin ver');
    console.log('Sonra: node scripts/ys-portal-webhook-autofill.js');
    process.exit(2);
  }
  throw error;
}

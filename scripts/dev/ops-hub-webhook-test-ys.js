#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

function readEnvValue(key) {
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) {
        return trimmed.slice(key.length + 1).trim();
      }
    }
  } catch {
    return process.env[key] || '';
  }
  return process.env[key] || '';
}

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 8787;
const base = process.env.OPS_WEBHOOK_BASE || process.env.OPS_TUNNEL_URL || `http://${host}:${port}`;

async function main() {
  const verifyDisabled = readEnvValue('OPS_WEBHOOK_VERIFY_DISABLED') === 'true';
  const secret =
    readEnvValue('YEMEKSEPETI_WEBHOOK_SECRET') ||
    process.env.YEMEKSEPETI_WEBHOOK_SECRET ||
    (verifyDisabled ? 'dev' : '');

  if (!secret && !verifyDisabled) {
    console.error('YEMEKSEPETI_WEBHOOK_SECRET veya OPS_WEBHOOK_VERIFY_DISABLED=true gerekli');
    process.exit(1);
  }

  const fixturePath = path.join(__dirname, '../lib/ops-hub/fixtures/yemeksepeti-webhook.fixture.js');
  const { YS_WEBHOOK_ORDER_FIXTURE } = await import(fixturePath);
  const payload = {
    ...YS_WEBHOOK_ORDER_FIXTURE,
    order: {
      ...YS_WEBHOOK_ORDER_FIXTURE.order,
      order_id: `ys-wh-test-${Date.now()}`
    }
  };

  const response = await fetch(`${base}/webhooks/v1/yemeksepeti/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  console.log(JSON.stringify({ base, status: response.status, data }, null, 2));
  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

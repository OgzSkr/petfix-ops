#!/usr/bin/env node
/**
 * YS / Getir webhook kurulum bilgilerini terminale yazdırır.
 * Partner portalına kopyala-yapıştır için.
 */
import { readEnvFile } from '../lib/env.js';
import { paths } from '../lib/config.js';
import { resolveOpsHubConfig } from '../lib/ops-hub/config.js';
import { listIntegrations } from '../lib/ops-hub/integrations/integration-service.js';
import { getOpsHubState, bootstrapOpsHub } from '../lib/ops-hub/bootstrap.js';

async function main() {
  const platformEnv = await readEnvFile(paths.platformEnv);
  const config = resolveOpsHubConfig(platformEnv);

  console.log('\n=== PetFix Ops — Webhook Kurulum Bilgileri ===\n');
  console.log(`Public API base: ${config.publicApiBaseUrl}\n`);

  if (config.postgresEnabled) {
    try {
      await bootstrapOpsHub(platformEnv);
      const { createOpsPool, closeOpsPool } = await import('../lib/ops-hub/db/migrate.js');
      const pool = await createOpsPool(config.postgresUrl);
      const branchId = getOpsHubState().branch?.id;
      if (branchId) {
        const data = await listIntegrations(pool, { branchId, platformEnv });
        console.log('--- Yemeksepeti ---');
        console.log(`Sipariş Webhook URL:\n  ${data.webhooks.endpoints.yemeksepetiOrders}`);
        console.log(`Katalog Callback URL:\n  ${data.webhooks.endpoints.yemeksepetiCatalog}`);
        const ys = data.integrations.find((i) => i.channel === 'yemeksepeti');
        const secret = ys?.config?.webhookSecret;
        console.log(`Webhook Secret:\n  ${secret ? '(kayıtlı — Entegrasyonlar > YS > Gelişmiş ayarlar veya DB)' : '(henüz yok — integrations kaydından üretilir)'}`);
        console.log('\n--- Getir ---');
        console.log(`Yeni Sipariş Webhook URL:\n  ${data.webhooks.endpoints.getirOrdersNew}`);
        console.log(`İptal Webhook URL:\n  ${data.webhooks.endpoints.getirOrdersCancelled}`);
        const getir = data.integrations.find((i) => i.channel === 'getir');
        const getirSecret = getir?.config?.webhookSecret;
        console.log(
          `x-api-key:\n  ${getirSecret ? '(kayıtlı — Entegrasyonlar > Getir veya GETIR_WEBHOOK_SECRET)' : '(henüz yok — integrations kaydından üretilir)'}`
        );
        await closeOpsPool();
      }
    } catch (error) {
      console.warn('DB okunamadı, env fallback kullanılıyor:', error.message);
    }
  }

  if (!config.postgresEnabled) {
    const base = config.publicApiBaseUrl;
    console.log('--- Yemeksepeti (env) ---');
    console.log(`Sipariş Webhook URL:\n  ${base}/webhooks/v1/yemeksepeti/orders`);
    console.log(`Katalog Callback URL:\n  ${base}/webhooks/v1/yemeksepeti/catalog`);
    console.log('\n--- Getir (env) ---');
    console.log(`Yeni Sipariş Webhook URL:\n  ${base}/webhooks/v1/getir/orders/new`);
    console.log(`İptal Webhook URL:\n  ${base}/webhooks/v1/getir/orders/cancelled`);
  }

  console.log('\n--- Partner portal adımları ---');
  console.log('1. partner-app.yemeksepeti.com → Order Webhook Management');
  console.log('2. Yukarıdaki Sipariş URL + Secret değerlerini yapıştırın');
  console.log('3. Kaydettikten sonra: npm run ops:verify-deploy');
  console.log('4. Test sipariş: npm run ops:webhook-test-ys\n');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

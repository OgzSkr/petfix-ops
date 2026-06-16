import { readDb } from '../../db/store.js';
import { buildMatchingQueue, resolveInboxHref } from '../../product-matching/matching-queue.js';
import { buildYemeksepetiPortalWebhookSecret } from '../webhooks/webhook-auth.js';
import { ensureProductMatching } from '../../product-matching/schema.js';
import { isYsConfigComplete, branchConfigToYsCfg, branchConfigToTgoCfg, isTgoConfigComplete, isGetirConfigComplete } from './config-bridge.js';
import { buildWebhookPanel } from './integration-service.js';

function statusItem(id, label, status, hint, extra = {}) {
  return { id, label, status, hint, ...extra };
}

/**
 * Yemeksepeti kurulum kontrol listesi — entegrasyon detay ekranı için.
 */
export async function buildYemeksepetiSetupChecklist({
  config = {},
  configMeta = {},
  platformEnv = {},
  db = null
} = {}) {
  const database = db || (await readDb());
  const pm = ensureProductMatching(database);
  const ysCfg = branchConfigToYsCfg(config);
  const credentialsOk = isYsConfigComplete(ysCfg);
  const testOk = configMeta.lastTestOk === true;
  const catalogAt = pm.meta.channelIngest?.yemeksepeti?.ingestedAt || null;
  const catalogCount = pm.channelProducts.filter((cp) => cp.channelId === 'yemeksepeti').length;

  const queue = buildMatchingQueue(database, {
    productMatchingMode: platformEnv.PRODUCT_MATCHING_MODE || 'legacy',
    productMatchingModeByChannel: {},
    benimposSaleConfirmLevel: platformEnv.BENIMPOS_SALE_CONFIRM_LEVEL
  });
  const ysRow = (queue.channels || []).find((c) => c.channelId === 'yemeksepeti') || {};

  const webhooks = buildWebhookPanel(platformEnv);
  const rawSecret = String(config.webhookSecret || platformEnv.YEMEKSEPETI_WEBHOOK_SECRET || '').trim();
  const portalSecret = buildYemeksepetiPortalWebhookSecret(rawSecret, 'petfix');

  const publicBase = webhooks.baseUrl || '';
  const publicUrlPending = publicBase.includes('127.0.0.1') || publicBase.includes('localhost');

  const items = [
    statusItem(
      'credentials',
      'OAuth kimlik bilgileri',
      credentialsOk ? 'done' : 'pending',
      credentialsOk
        ? 'Client Name, Secret, Vendor ID ve Chain ID tamam.'
        : 'Client Name, Secret, Vendor ID ve Chain ID girin.'
    ),
    statusItem(
      'connection_test',
      'Bağlantı testi',
      testOk ? 'done' : (credentialsOk ? 'warn' : 'pending'),
      testOk
        ? (configMeta.lastTestMessage || 'OAuth ve katalog erişimi doğrulandı.')
        : 'Bağlantı testi ile OAuth ve katalog erişimini doğrulayın.'
    ),
    statusItem(
      'catalog',
      'Katalog senkronu',
      catalogCount > 0 ? 'done' : 'pending',
      catalogCount > 0
        ? `${catalogCount.toLocaleString('tr-TR')} kanal ürünü${catalogAt ? ` · ${new Date(catalogAt).toLocaleString('tr-TR')}` : ''}`
        : 'Katalog sync çalıştırın.'
    ),
    statusItem(
      'matching',
      'Ürün eşleştirme',
      ysRow.readyForSales ? 'done' : (ysRow.queueTotal > 0 ? 'warn' : 'pending'),
      ysRow.readyForSales
        ? `${ysRow.manualConfirmed || 0} onaylı eşleştirme — satışa hazır.`
        : ysRow.blockers?.[0] || (ysRow.queueTotal > 0
          ? `${ysRow.queueTotal} ürün karar bekliyor.`
          : 'Eşleştirme tamamlanmadan sipariş satışa aktarılamaz.'),
      ysRow.queueTotal > 0
        ? { href: resolveInboxHref(ysRow) }
        : {}
    ),
    statusItem(
      'webhook_portal',
      'Sipariş webhook (portal)',
      'warn',
      'YS Partner Portal → jk2w Ayarlar → API → Sipariş Webhook Ayarları. URL ve Basic secret yapıştırıp kaydedin.',
      {
        copyLabel: 'Portal secret (Basic)',
        copyValue: portalSecret || '',
        copyLabel2: 'Sipariş webhook URL',
        copyValue2: webhooks.endpoints?.yemeksepetiOrders || ''
      }
    ),
    statusItem(
      'catalog_webhook_portal',
      'Katalog webhook (portal)',
      'warn',
      'Aynı API ekranı → Ürün Güncelleme API - Webhook Ayarları. Katalog callback URL + aynı Basic secret.',
      {
        copyLabel: 'Katalog webhook URL',
        copyValue: webhooks.endpoints?.yemeksepetiCatalog || '',
        copyLabel2: 'Portal secret (Basic)',
        copyValue2: portalSecret || ''
      }
    ),
    statusItem(
      'public_url',
      'Canlı webhook adresi',
      publicUrlPending ? 'warn' : 'done',
      publicUrlPending
        ? `Şu an ${publicBase} — DNS/VPS aktif olunca YS siparişleri ulaşır.`
        : `Public URL: ${publicBase}`
    )
  ];

  const doneCount = items.filter((i) => i.status === 'done').length;
  return {
    channelId: 'yemeksepeti',
    title: 'Kurulum kontrol listesi',
    progress: `${doneCount}/${items.length}`,
    readyForOrders: credentialsOk && testOk && catalogCount > 0 && !publicUrlPending,
    items
  };
}

export async function buildTrendyolGoSetupChecklist({
  config = {},
  configMeta = {},
  platformEnv = {},
  db = null
} = {}) {
  const database = db || (await readDb());
  const pm = ensureProductMatching(database);
  const tgoCfg = branchConfigToTgoCfg(config);
  const credentialsOk = isTgoConfigComplete(tgoCfg);
  const testOk = configMeta.lastTestOk === true;
  const catalogAt = pm.meta.channelIngest?.['uber-eats-catalog']?.ingestedAt || null;
  const catalogCount = pm.channelProducts.filter((cp) => cp.channelId === 'uber-eats').length;

  const queue = buildMatchingQueue(database, {
    productMatchingMode: platformEnv.PRODUCT_MATCHING_MODE || 'legacy',
    productMatchingModeByChannel: {},
    benimposSaleConfirmLevel: platformEnv.BENIMPOS_SALE_CONFIRM_LEVEL
  });
  const tgoRow = (queue.channels || []).find((c) => c.channelId === 'uber-eats') || {};

  const items = [
    statusItem(
      'credentials',
      'API kimlik bilgileri',
      credentialsOk ? 'done' : 'pending',
      credentialsOk
        ? 'Satıcı ID, API Key, API Secret ve mağaza ID tamam.'
        : 'Trendyol Go Market API bilgilerini girin.'
    ),
    statusItem(
      'connection_test',
      'Sipariş okuma testi',
      testOk ? 'done' : (credentialsOk ? 'warn' : 'pending'),
      testOk
        ? (configMeta.lastTestMessage || 'Grocery packages okuması doğrulandı.')
        : 'Bağlantı testi ile sipariş okumasını doğrulayın.'
    ),
    statusItem(
      'catalog',
      'TGO katalog senkronu',
      catalogCount > 0 ? 'done' : 'pending',
      catalogCount > 0
        ? `${catalogCount.toLocaleString('tr-TR')} Uber/TGO kanal ürünü${catalogAt ? ` · ${new Date(catalogAt).toLocaleString('tr-TR')}` : ''}`
        : 'Ürün Merkezi → Katalog Sync çalıştırın.',
      catalogCount > 0 ? { href: '/hzlmrktops/urunler?tab=uber-eats' } : {}
    ),
    statusItem(
      'matching',
      'Ürün eşleştirme',
      tgoRow.readyForSales ? 'done' : (tgoRow.queueTotal > 0 ? 'warn' : 'pending'),
      tgoRow.readyForSales
        ? `${tgoRow.manualConfirmed || 0} onaylı eşleştirme.`
        : tgoRow.blockers?.[0] || (tgoRow.queueTotal > 0
          ? `${tgoRow.queueTotal} ürün karar bekliyor.`
          : 'Eşleştirme tamamlanmadan sipariş satışa aktarılamaz.'),
      tgoRow.queueTotal > 0
        ? { href: resolveInboxHref(tgoRow) }
        : {}
    ),
    statusItem(
      'stock_push',
      'Stok push',
      platformEnv.FF_STOCK_PUSH === 'true' || platformEnv.FF_STOCK_PUSH === true ? 'done' : 'warn',
      platformEnv.FF_STOCK_PUSH === 'true' || platformEnv.FF_STOCK_PUSH === true
        ? 'TGO fiyat/stok gönderimi aktif — Ürünler sayfasından manuel tetikleyin.'
        : 'FF_STOCK_PUSH kapalı — canlı gönderim simülasyon modunda.',
      { href: '/hzlmrktops/urunler' }
    )
  ];

  const doneCount = items.filter((i) => i.status === 'done').length;
  return {
    channelId: 'trendyol_go',
    title: 'Trendyol Go kurulum kontrol listesi',
    progress: `${doneCount}/${items.length}`,
    readyForOrders: credentialsOk && testOk && tgoRow.readyForSales,
    items
  };
}

export async function buildGetirSetupChecklist({
  config = {},
  configMeta = {},
  platformEnv = {},
  db = null
} = {}) {
  const database = db || (await readDb());
  const shopId = String(config.shopId || '').trim();
  const apiOk = isGetirConfigComplete({
    shopId,
    apiUsername: config.apiUsername,
    apiPassword: config.apiPassword,
    apiBaseUrl: config.apiBaseUrl
  });
  const credentialsOk = Boolean(shopId);
  const webhooks = buildWebhookPanel(platformEnv);
  const publicBase = webhooks.baseUrl || '';
  const publicUrlPending = publicBase.includes('127.0.0.1') || publicBase.includes('localhost');

  const items = [
    statusItem(
      'whitelist',
      'Bölge yöneticisi onayı',
      'pending',
      'Getir bölge yöneticinizden PetFix webhook URL whitelist talebi gönderin.',
      { href: '/hzlmrktops/integrations?channel=getir' }
    ),
    statusItem(
      'shop_id',
      'İşletme / Shop ID',
      credentialsOk ? 'done' : 'pending',
      credentialsOk ? `Shop ID: ${shopId}` : 'Getir panelinden shop ID girin.'
    ),
    statusItem(
      'webhook_portal',
      'Getir başvuru formu',
      publicUrlPending ? 'warn' : 'pending',
      publicUrlPending
        ? 'Webhook URL\'ler hazır — canlı DNS sonrası Getir formuna kaydedin.'
        : 'GetirCarsiAPI başvuru formuna iki webhook URL + x-api-key girin.',
      {
        copyLabel: 'Yeni sipariş webhook',
        copyValue: webhooks.endpoints?.getirOrdersNew || ''
      }
    ),
    statusItem(
      'webhook_cancel',
      'İptal webhook URL',
      publicUrlPending ? 'warn' : 'pending',
      'Başvuru formundaki ikinci alan — sipariş iptalleri.',
      {
        copyLabel: 'İptal webhook',
        copyValue: webhooks.endpoints?.getirOrdersCancelled || ''
      }
    ),
    statusItem(
      'connection_test',
      'Bağlantı testi',
      configMeta.lastTestOk === true ? 'done' : apiOk ? 'warn' : 'pending',
      configMeta.lastTestMessage || (apiOk ? 'Entegrasyonlar sayfasından bağlantı testi çalıştırın.' : 'API kullanıcı, şifre ve base URL girin.'),
      { href: '/hzlmrktops/health' }
    ),
    statusItem(
      'public_url',
      'Canlı webhook adresi',
      publicUrlPending ? 'warn' : 'done',
      publicUrlPending
        ? `Şu an ${publicBase} — DNS/VPS aktif olunca Getir siparişleri ulaşır.`
        : `Public URL: ${publicBase}`
    )
  ];

  const doneCount = items.filter((i) => i.status === 'done').length;
  return {
    channelId: 'getir',
    title: 'Getir Çarşı kurulum kontrol listesi',
    progress: `${doneCount}/${items.length}`,
    readyForOrders: apiOk && configMeta.lastTestOk === true,
    items
  };
}

export async function buildIntegrationSetupChecklist(channel, options = {}) {
  if (channel === 'yemeksepeti') {
    return buildYemeksepetiSetupChecklist(options);
  }
  if (channel === 'trendyol_go') {
    return buildTrendyolGoSetupChecklist(options);
  }
  if (channel === 'getir') {
    return buildGetirSetupChecklist(options);
  }
  return null;
}

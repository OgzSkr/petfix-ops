import { readEnvFile, isMissingConfigValue } from '../../env.js';
import { paths } from '../../config.js';
import { fetchYemeksepetiCatalogProducts } from '../../channels/yemeksepeti-catalog.js';
import { channelProductIdFor } from '../constants.js';
import { normalizeBarcode } from '../normalize.js';

const CHANNEL_ID = 'yemeksepeti';

async function loadYemeksepetiConfig() {
  const env = await readEnvFile(paths.platformEnv);
  return {
    chainId: env.YEMEKSEPETI_CHAIN_ID || process.env.YEMEKSEPETI_CHAIN_ID || '',
    vendorId: env.YEMEKSEPETI_VENDOR_ID || process.env.YEMEKSEPETI_VENDOR_ID || '',
    clientId: env.YEMEKSEPETI_CLIENT_ID || process.env.YEMEKSEPETI_CLIENT_ID || '',
    clientSecret: env.YEMEKSEPETI_CLIENT_SECRET || process.env.YEMEKSEPETI_CLIENT_SECRET || ''
  };
}

function isConfigured(cfg) {
  return Boolean(
    cfg.chainId &&
    cfg.vendorId &&
    cfg.clientId &&
    cfg.clientSecret &&
    !isMissingConfigValue(cfg.clientId) &&
    !isMissingConfigValue(cfg.clientSecret)
  );
}

export function mapYemeksepetiCatalogProduct(product) {
  const sku = String(product.sku || '').trim();
  const remoteId = String(product.remoteProductId || '').trim();
  const productKey = sku || remoteId;
  if (!productKey) return null;

  const barcode = normalizeBarcode(product.barcode);
  const name = String(product.title || productKey).trim() || productKey;
  const price = product.price != null && Number.isFinite(Number(product.price))
    ? Number(product.price)
    : null;

  return {
    id: channelProductIdFor(CHANNEL_ID, productKey),
    channelId: CHANNEL_ID,
    channelProductId: productKey,
    channelBarcode: barcode || productKey,
    channelName: name,
    channelPrice: price,
    ysRemoteProductId: remoteId || null,
    ysSku: sku || null,
    ysActive: product.active !== false,
    ingestSource: 'yemeksepeti_catalog',
    ingestedAt: new Date().toISOString()
  };
}

/**
 * Yemeksepeti Partner kataloğunu eşleştirme havuzuna aktarır.
 * onBatch ile sayfa sayfa ilerleyerek kısmi havuz oluşturulabilir.
 */
export async function ingestYemeksepetiCatalogProducts(options = {}) {
  const cfg = await loadYemeksepetiConfig();
  if (!isConfigured(cfg)) {
    throw new Error('Yemeksepeti Partner OAuth bilgileri eksik — Ayarlar sayfasından CHAIN_ID, VENDOR_ID, CLIENT_ID ve CLIENT_SECRET girin.');
  }

  const now = new Date().toISOString();
  const channelProducts = [];
  const seen = new Set();
  const onBatch = typeof options.onBatch === 'function' ? options.onBatch : null;

  const fetched = await fetchYemeksepetiCatalogProducts(cfg, {
    pageSize: options.pageSize,
    maxPages: options.maxPages,
    async onPage(rows, meta) {
      const batch = [];
      for (const product of rows) {
        const mapped = mapYemeksepetiCatalogProduct(product);
        if (!mapped || seen.has(mapped.channelProductId)) continue;
        seen.add(mapped.channelProductId);
        channelProducts.push(mapped);
        batch.push(mapped);
      }
      if (batch.length && onBatch) {
        await onBatch(batch, meta);
      }
    }
  });

  return {
    channelProducts,
    summary: {
      ...fetched.summary,
      scanned: fetched.products.length,
      prepared: channelProducts.length,
      ingestedAt: now
    }
  };
}

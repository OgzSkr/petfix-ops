import { readEnvFile, isMissingConfigValue } from '../../env.js';
import { paths } from '../../config.js';
import { fetchWooCommerceCatalogProducts } from '../../channels/woocommerce-catalog.js';
import { channelProductIdFor } from '../constants.js';
import { normalizeBarcode } from '../normalize.js';

const CHANNEL_ID = 'woocommerce';

async function loadWooCommerceConfig() {
  const env = await readEnvFile(paths.platformEnv);
  return {
    baseUrl: String(env.WOOCOMMERCE_URL || process.env.WOOCOMMERCE_URL || '').replace(/\/$/, ''),
    key: env.WOOCOMMERCE_KEY || process.env.WOOCOMMERCE_KEY || '',
    secret: env.WOOCOMMERCE_SECRET || process.env.WOOCOMMERCE_SECRET || ''
  };
}

function isConfigured(cfg) {
  return Boolean(cfg.baseUrl && cfg.key && cfg.secret && !isMissingConfigValue(cfg.key));
}

export function mapWooCommerceCatalogProduct(product) {
  const sku = normalizeBarcode(product.sku);
  if (!sku) return null;

  const ean = normalizeBarcode(product.ean);
  const matchBarcode = ean || sku;
  const name = String(product.name || sku).trim() || sku;

  return {
    id: channelProductIdFor(CHANNEL_ID, sku),
    channelId: CHANNEL_ID,
    channelProductId: sku,
    channelBarcode: matchBarcode,
    channelName: name,
    channelPrice: product.price ?? null,
    wcProductId: product.wcProductId ?? null,
    wcSku: sku,
    wcEan: ean || null,
    ingestSource: 'woocommerce_catalog',
    ingestedAt: new Date().toISOString()
  };
}

/**
 * petfix.com.tr WooCommerce kataloğunu eşleştirme havuzuna aktarır.
 */
export async function ingestWooCommerceCatalogProducts(options = {}) {
  const cfg = await loadWooCommerceConfig();
  if (!isConfigured(cfg)) {
    throw new Error('WooCommerce REST bilgileri eksik — Ayarlar sayfasından mağaza URL ve anahtarları girin.');
  }

  const fetched = await fetchWooCommerceCatalogProducts(cfg, options);
  const now = new Date().toISOString();
  const channelProducts = [];

  for (const product of fetched.products) {
    const mapped = mapWooCommerceCatalogProduct(product);
    if (mapped) channelProducts.push(mapped);
  }

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

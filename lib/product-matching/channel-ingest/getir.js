import { loginGetirApi, fetchGetirShopProducts, isGetirApiConfigComplete } from '../../channels/getir-api.js';
import { getChannelCredentials } from '../../channels/credentials.js';
import { isMissingConfigValue } from '../../env.js';
import { channelProductIdFor } from '../constants.js';
import { normalizeBarcode, dedupeBarcodes } from '../normalize.js';

const CHANNEL_ID = 'getir';

async function loadGetirConfig(options = {}) {
  const cfg = await getChannelCredentials({ channel: 'getir', branchId: options.branchId || null });
  // Katalog ingest hattı tarihsel olarak base URL yoksa canlıyı varsayar.
  return { ...cfg, apiEnv: cfg.apiEnv || 'prod' };
}

function productTitle(product) {
  const name = product?.productName || product?.name;
  if (name && typeof name === 'object') {
    return String(name.tr || name.en || '').trim();
  }
  return String(name || product?.productName || '').trim();
}

function barcodeFromApi(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    return normalizeBarcode(
      value.barcode ?? value.value ?? value.code ?? value.ean ?? value.gtin ?? ''
    );
  }
  return normalizeBarcode(value);
}

/** Getir panel/API farklı alanlarda barkod döndürebilir; çoklu barkod listesini birleştir. */
export function collectGetirProductBarcodes(product = {}) {
  const raw = [];
  if (Array.isArray(product.barcodes)) {
    for (const entry of product.barcodes) raw.push(barcodeFromApi(entry));
  }
  for (const field of ['barcode', 'productBarcode', 'barcodeNo', 'ean', 'gtin', 'sku']) {
    raw.push(barcodeFromApi(product[field]));
  }
  return dedupeBarcodes(raw);
}

function pickPrimaryBarcode(allBarcodes, productKey) {
  if (!allBarcodes.length) return productKey || '';
  const trEan = allBarcodes.find((code) => /^86[89]\d{10}$/.test(code));
  return trEan || allBarcodes[0];
}

export function mapGetirCatalogProduct(product) {
  const menuProductId = String(product?.menuProductId || '').trim();
  const catalogProductId = String(product?.catalogProductId || '').trim();
  const productKey = menuProductId || catalogProductId;
  if (!productKey) return null;

  // Getir bir ürüne birden fazla (3-4) barkod tanımlayabiliyor; hepsini taşı.
  const allBarcodes = collectGetirProductBarcodes(product);
  const barcode = pickPrimaryBarcode(allBarcodes, '');
  const name = productTitle(product) || productKey;
  const price = product?.price != null && Number.isFinite(Number(product.price))
    ? Number(product.price)
    : null;
  const images = Array.isArray(product?.images) ? product.images : [];
  const imageUrl = String(images[0] || '').trim() || null;

  return {
    id: channelProductIdFor(CHANNEL_ID, productKey),
    channelId: CHANNEL_ID,
    channelProductId: productKey,
    channelBarcode: barcode || productKey,
    channelBarcodes: allBarcodes,
    channelName: name,
    channelPrice: price,
    channelImageUrl: imageUrl,
    getirMenuProductId: menuProductId || null,
    getirCatalogProductId: catalogProductId || null,
    getirActive: Number(product?.status) === 100,
    catalogQuantity: product?.quantity != null && Number.isFinite(Number(product.quantity))
      ? Math.max(0, Math.floor(Number(product.quantity)))
      : null,
    ingestSource: 'getir_catalog',
    ingestedAt: new Date().toISOString()
  };
}

export async function ingestGetirCatalogProducts(options = {}) {
  const cfg = await loadGetirConfig(options);
  if (!isGetirApiConfigComplete(cfg)) {
    const missing = [];
    if (!String(cfg.shopId || '').trim()) missing.push('GETIR_SHOP_ID');
    if (!String(cfg.apiUsername || '').trim()) missing.push('GETIR_API_USERNAME');
    if (!String(cfg.apiPassword || '').trim() || isMissingConfigValue(cfg.apiPassword)) {
      missing.push('GETIR_API_PASSWORD');
    }
    throw new Error(
      missing.length
        ? `Getir API bilgileri eksik — ${missing.join(', ')} gerekli. Integrations → Getir Çarşı ekranından kaydedin.`
        : 'Getir API bilgileri eksik — GETIR_SHOP_ID, kullanıcı adı ve şifre gerekli.'
    );
  }

  const session = await loginGetirApi(cfg);
  const rows = await fetchGetirShopProducts(cfg, session, {
    pageSize: options.pageSize,
    maxPages: options.maxPages,
    onProgress: options.onProgress
  });

  const channelProducts = [];
  const seen = new Set();

  for (const product of rows) {
    const mapped = mapGetirCatalogProduct(product);
    if (!mapped || seen.has(mapped.channelProductId)) continue;
    seen.add(mapped.channelProductId);
    channelProducts.push(mapped);
  }

  return {
    channelProducts,
    summary: {
      channelId: CHANNEL_ID,
      fetched: rows.length,
      mapped: channelProducts.length,
      ingestedAt: new Date().toISOString()
    }
  };
}

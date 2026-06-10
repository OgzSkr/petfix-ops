import { UberEatsAdapter } from '../../channels/uber-eats.js';
import { fetchUberEatsCatalogProducts } from '../../channels/uber-eats-catalog.js';
import { channelProductIdFor } from '../constants.js';
import { detectVariantKey, normalizeBarcode, parseWeightGrams } from '../normalize.js';

const CHANNEL_ID = 'uber-eats';

/** Uber Finance API çoğu satırda gerçek ürün adı vermez — yalnızca "Satış" gelir. */
export function isPlaceholderChannelName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'satış' || normalized === 'satis' || normalized === 'sale';
}

function normalizeBrandToken(text) {
  return String(text || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

/** Ürün adı marka ile zaten başlıyorsa tekrar ekleme. */
export function nameAlreadyHasBrand(productName, brand) {
  const name = normalizeBrandToken(productName);
  const brandToken = normalizeBrandToken(brand);
  if (!name || !brandToken) return false;
  return name.startsWith(brandToken);
}

/** Ana havuzdaki gibi markayı ürün adının başına ekler. */
export function prependBrandToProductName(productName, brand) {
  const name = String(productName || '').trim();
  const brandName = String(brand || '').trim();
  if (!name || !brandName || nameAlreadyHasBrand(name, brandName)) return name;
  return `${brandName} ${name}`;
}

function resolveMasterFromArg(masterOrName) {
  if (masterOrName && typeof masterOrName === 'object') {
    return {
      name: masterOrName.name || null,
      brand: masterOrName.brand || masterOrName.categoryName || null
    };
  }
  if (typeof masterOrName === 'string' && masterOrName.trim()) {
    return { name: masterOrName.trim(), brand: null };
  }
  return { name: null, brand: null };
}

export function resolveUberBrand(channelProduct) {
  return String(channelProduct?.uberBrand || '').trim();
}

/** Eşleştirme tablosunda yalnızca Uber katalog markası kullanılır — ana havuz markası karıştırılmaz. */
export function resolveBrandForChannelProduct(channelProduct, _master = null) {
  return resolveUberBrand(channelProduct);
}

export function resolveChannelDisplayName(channelProduct, masterOrName = null) {
  const masterInfo = resolveMasterFromArg(masterOrName);
  const raw = String(channelProduct?.channelName || '').trim();
  const fallbackName = masterInfo.name
    || channelProduct?.suggestedMasterName
    || channelProduct?.masterProductName
    || null;

  if (isPlaceholderChannelName(raw)) {
    if (fallbackName) return String(fallbackName).trim();
    return raw || String(channelProduct?.channelBarcode || '—');
  }

  return prependBrandToProductName(raw, resolveUberBrand(channelProduct));
}

export function mergeIncomingChannelProduct(existing, incoming, masterName = null) {
  const merged = { ...existing, ...incoming };
  const existingName = existing?.channelName;
  const incomingName = incoming?.channelName;

  if (!isPlaceholderChannelName(existingName) && isPlaceholderChannelName(incomingName)) {
    merged.channelName = existingName;
  } else if (isPlaceholderChannelName(merged.channelName) && masterName) {
    merged.channelName = masterName;
  }

  return merged;
}

export function mergeCatalogChannelProduct(existing, incoming) {
  const masterName = !isPlaceholderChannelName(incoming.channelName) ? incoming.channelName : null;
  const merged = mergeIncomingChannelProduct(existing || {}, incoming, masterName);

  if (!isPlaceholderChannelName(incoming.channelName)) {
    merged.channelName = incoming.channelName;
    merged.normalizedWeightG = incoming.normalizedWeightG || merged.normalizedWeightG;
    merged.variantKey = incoming.variantKey || merged.variantKey;
  }

  merged.orderCount = 0;
  merged.orderLineCount = 0;
  merged.ingestSource = 'catalog';
  merged.catalogOnSale = incoming.catalogOnSale;
  merged.catalogQuantity = incoming.catalogQuantity;
  merged.catalogStoreId = incoming.catalogStoreId;
  merged.catalogSyncedAt = incoming.catalogSyncedAt;
  merged.uberProductId = incoming.uberProductId;
  merged.uberCategory = incoming.uberCategory;
  merged.uberBrand = incoming.uberBrand;
  merged.lastUnitPrice = incoming.lastUnitPrice ?? merged.lastUnitPrice;

  return merged;
}

/**
 * Uber Go Market katalog API — mağazadaki tüm ürünler (api.tgoapis.com).
 */
export async function ingestUberEatsCatalogProducts(options = {}) {
  const adapter = new UberEatsAdapter();
  const cfg = await adapter.loadConfig();
  if (!adapter.isConfigured(cfg)) {
    throw new Error('Uber Eats API bilgileri eksik — Ayarlar sayfasından UBER_EATS_* alanlarını doldurun.');
  }

  const catalog = await fetchUberEatsCatalogProducts(cfg, options);
  const now = new Date().toISOString();
  const channelProducts = catalog.products.map((row) => ({
    id: channelProductIdFor(CHANNEL_ID, row.barcode),
    channelId: CHANNEL_ID,
    channelProductId: row.barcode,
    channelBarcode: row.barcode,
    channelName: row.title || row.barcode,
    normalizedWeightG: parseWeightGrams(row.title),
    variantKey: detectVariantKey(row.title),
    orderLineCount: 0,
    orderCount: 0,
    lastUnitPrice: row.sellingPrice || 0,
    firstSeenAt: now,
    lastSeenAt: now,
    ingestedAt: now,
    ingestSource: 'catalog',
    catalogOnSale: row.onSale,
    catalogQuantity: row.quantity,
    catalogStoreId: row.storeId,
    catalogSyncedAt: now,
    uberProductId: row.uberProductId,
    uberCategory: row.categoryName || '',
    uberBrand: row.brandName || ''
  }));

  return {
    channelProducts,
    summary: {
      channelId: CHANNEL_ID,
      source: 'catalog',
      storeId: catalog.storeId,
      distinctProducts: channelProducts.length,
      ...catalog.summary,
      ingestedAt: now
    }
  };
}

/**
 * Uber kanal ürünleri — sipariş geçmişi ve/veya Go Market katalog API.
 */
export async function ingestUberEatsChannelProducts(days = 90) {
  const adapter = new UberEatsAdapter();
  const cfg = await adapter.loadConfig();
  if (!adapter.isConfigured(cfg)) {
    throw new Error('Uber Eats API bilgileri eksik — Ayarlar sayfasından UBER_EATS_* alanlarını doldurun.');
  }

  const packages = await adapter.fetchOrders({ days });
  const byBarcode = new Map();
  const now = new Date().toISOString();

  for (const pkg of packages) {
    const orderDate = pkg.orderDate
      ? new Date(Number(pkg.orderDate)).toISOString()
      : now;

    for (const line of pkg.lines || []) {
      const barcode = normalizeBarcode(line.barcode);
      if (!barcode) continue;

      const rawName = String(line.productName || '').trim();
      const existing = byBarcode.get(barcode) || {
        id: channelProductIdFor(CHANNEL_ID, barcode),
        channelId: CHANNEL_ID,
        channelProductId: barcode,
        channelBarcode: barcode,
        channelName: rawName,
        normalizedWeightG: parseWeightGrams(rawName),
        variantKey: detectVariantKey(rawName),
        orderLineCount: 0,
        orderCount: 0,
        lastUnitPrice: 0,
        firstSeenAt: orderDate,
        lastSeenAt: orderDate,
        ingestedAt: now
      };

      existing.orderLineCount += Number(line.quantity) || 1;
      existing.orderCount += 1;
      if (line.lineUnitPrice) existing.lastUnitPrice = Number(line.lineUnitPrice);
      if (orderDate > existing.lastSeenAt) existing.lastSeenAt = orderDate;
      if (orderDate < existing.firstSeenAt) existing.firstSeenAt = orderDate;

      if (rawName && !isPlaceholderChannelName(rawName)
        && isPlaceholderChannelName(existing.channelName)) {
        existing.channelName = rawName;
        existing.normalizedWeightG = parseWeightGrams(rawName) || existing.normalizedWeightG;
        existing.variantKey = detectVariantKey(rawName) || existing.variantKey;
      }

      byBarcode.set(barcode, existing);
    }
  }

  return {
    channelProducts: [...byBarcode.values()],
    summary: {
      channelId: CHANNEL_ID,
      days,
      orderPackages: packages.length,
      distinctProducts: byBarcode.size,
      ingestedAt: now
    }
  };
}

export function enrichChannelProductsFromMaster(channelProducts, masterProducts) {
  const masterByBarcode = new Map(
    masterProducts.map((m) => [normalizeBarcode(m.benimposBarcode), m])
  );

  for (const cp of channelProducts) {
    const master = masterByBarcode.get(normalizeBarcode(cp.channelBarcode));
    if (!master) continue;

    cp.suggestedMasterProductId = master.id;
    cp.suggestedMasterName = master.name;

    if (!cp.channelName || isPlaceholderChannelName(cp.channelName)) {
      cp.channelName = master.name;
    }
    if (!cp.normalizedWeightG && master.normalizedWeightG) {
      cp.normalizedWeightG = master.normalizedWeightG;
    }
    if (!cp.variantKey && master.variantKey) {
      cp.variantKey = master.variantKey;
    }
  }

  return channelProducts;
}

/** Eşleştirme merkezi için sipariş geçmişi metadatasını temizler (katalog tek kaynak). */
export function stripUberOrderMetadataFromChannelProducts(channelProducts = []) {
  let cleaned = 0;
  for (const cp of channelProducts) {
    if (cp.channelId !== CHANNEL_ID) continue;
    const hadOrderMeta = (cp.orderCount || 0) > 0
      || (cp.orderLineCount || 0) > 0
      || cp.ingestSource === 'catalog+orders'
      || cp.ingestSource === 'orders';
    if (!hadOrderMeta) continue;
    cp.orderCount = 0;
    cp.orderLineCount = 0;
    cp.ingestSource = cp.catalogSyncedAt ? 'catalog' : cp.ingestSource;
    cleaned += 1;
  }
  return cleaned;
}

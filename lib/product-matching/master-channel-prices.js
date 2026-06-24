import { listSalesMatchingChannels } from './constants.js';
import { barcodesEquivalent, barcodeLookupKeys, normalizeBarcode, dedupeBarcodes } from './normalize.js';
import { priceDiffPercent } from './price-compare.js';

function channelProductBarcodeList(cp = {}) {
  return dedupeBarcodes([...(Array.isArray(cp.channelBarcodes) ? cp.channelBarcodes : []), cp.channelBarcode]);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function channelSalePriceFromProduct(cp, channelId, db) {
  if (!cp) return null;
  if (channelId === 'uber-eats') {
    const price = Number(cp.lastUnitPrice) || 0;
    return price > 0 ? price : null;
  }
  const channelPrice = Number(cp.channelPrice);
  if (Number.isFinite(channelPrice) && channelPrice > 0) return channelPrice;
  return null;
}

/** Tek seferlik indeks — binlerce ürün × kanal filtresinde O(n²) taramayı önler. */
export function createMasterChannelResolver(pm) {
  const mappingByMasterChannel = new Map();
  for (const mapping of pm.mappings || []) {
    mappingByMasterChannel.set(`${mapping.masterProductId}:${mapping.channelId}`, mapping);
  }

  const channelProductByKey = new Map();
  const mappingOwnerByChannelProduct = new Map();
  for (const mapping of pm.mappings || []) {
    mappingOwnerByChannelProduct.set(`${mapping.channelId}:${mapping.channelProductId}`, mapping.masterProductId);
  }
  for (const row of pm.channelProducts || []) {
    channelProductByKey.set(`${row.channelId}:${row.channelProductId}`, row);
  }

  const barcodeHitIndex = new Map();
  for (const row of pm.channelProducts || []) {
    const ownerMasterId = mappingOwnerByChannelProduct.get(`${row.channelId}:${row.channelProductId}`) || null;
    for (const code of channelProductBarcodeList(row)) {
      for (const key of barcodeLookupKeys(code)) {
        const indexKey = `${row.channelId}:${key}`;
        if (!barcodeHitIndex.has(indexKey)) {
          barcodeHitIndex.set(indexKey, { cp: row, ownerMasterId });
        }
      }
    }
  }

  function resolve(master, channelId) {
    const mapping = mappingByMasterChannel.get(`${master.id}:${channelId}`) || null;
    if (mapping) {
      const mapped = channelProductByKey.get(`${channelId}:${mapping.channelProductId}`);
      if (mapped) return { cp: mapped, mapping };
    }

    for (const key of barcodeLookupKeys(master.benimposBarcode)) {
      const hit = barcodeHitIndex.get(`${channelId}:${key}`);
      if (!hit) continue;
      if (hit.ownerMasterId && hit.ownerMasterId !== master.id) continue;
      return { cp: hit.cp, mapping: mapping || null };
    }

    return { cp: null, mapping: mapping || null };
  }

  return { resolve };
}

function resolveChannelProductForMaster(pm, master, channelId, resolver = null) {
  if (resolver) return resolver.resolve(master, channelId);

  const mapping = pm.mappings.find(
    (m) => m.masterProductId === master.id && m.channelId === channelId
  );
  if (mapping) {
    const mapped = pm.channelProducts.find(
      (row) => row.channelId === channelId && row.channelProductId === mapping.channelProductId
    );
    if (mapped) return { cp: mapped, mapping };
  }

  const barcodeHit = pm.channelProducts.find((row) => {
    if (row.channelId !== channelId) return false;
    const taken = pm.mappings.find(
      (m) => m.channelId === channelId && m.channelProductId === row.channelProductId
    );
    if (taken?.masterProductId && taken.masterProductId !== master.id) return false;
    return channelProductBarcodeList(row).some((code) => barcodesEquivalent(code, master.benimposBarcode));
  }) || null;

  return { cp: barcodeHit, mapping: mapping || null };
}

function resolveChannelCatalogOnSale(cp, channelId) {
  if (!cp) return null;
  if (channelId === 'yemeksepeti') {
    if (cp.ysActive === false) return false;
    if (cp.ysActive === true) return true;
  }
  if (channelId === 'getir') {
    if (cp.getirActive === false) return false;
    if (cp.getirActive === true) return true;
  }
  if (channelId === 'uber-eats') {
    if (cp.catalogOnSale === true) return true;
    if (Array.isArray(cp.catalogListTypes) && cp.catalogListTypes.includes('ON_SALE') && cp.catalogOnSale !== false) {
      return true;
    }
    if (cp.catalogOnSale === false) return false;
  }
  if (cp.catalogOnSale === true) return true;
  if (cp.catalogOnSale === false) return false;
  return null;
}

/**
 * Ana ürün satırı için kanal satış fiyatları ve BenimPOS satış/alış farkları (%).
 */
export function buildMasterChannelPrices(db, master, resolver = null) {
  const pm = db.productMatching;
  const channelResolver = resolver || createMasterChannelResolver(pm);
  const masterSale = roundMoney(master.salePrice1);
  const masterBuy = roundMoney(master.buyingPrice);
  const comparePrice = masterSale > 1 ? masterSale : (masterBuy > 0 ? masterBuy : null);
  const compareBasis = masterSale > 1 ? 'sale' : (masterBuy > 0 ? 'cost' : 'none');

  return listSalesMatchingChannels()
    .filter((channel) => channel.status !== 'planned')
    .map((channel) => {
      const { cp, mapping } = channelResolver.resolve(master, channel.id);
      const rawPrice = channelSalePriceFromProduct(cp, channel.id, db);
      const channelPrice = rawPrice != null ? roundMoney(rawPrice) : null;

      return {
        channelId: channel.id,
        channelProductId: cp?.channelProductId || null,
        channelName: cp?.channelDisplayName || cp?.channelName || null,
        channelImageUrl: cp?.channelImageUrl || cp?.imageUrl || cp?.catalogImageUrl || null,
        channelSku: cp?.channelBarcode || cp?.channelProductId || null,
        channelPrice,
        channelStock: cp?.catalogQuantity != null && Number.isFinite(Number(cp.catalogQuantity))
          ? Math.max(0, Math.floor(Number(cp.catalogQuantity)))
          : null,
        linked: Boolean(cp),
        saleDiffPct: channelPrice != null && comparePrice
          ? priceDiffPercent(channelPrice, comparePrice)
          : null,
        compareBasis,
        mappingStatus: mapping?.status || (cp ? 'unmapped' : null),
        hasConfirmedMapping: mapping?.status === 'manual_confirmed' || mapping?.status === 'auto_matched',
        hasMapping: Boolean(mapping),
        barcodeMatchOnly: Boolean(cp && !mapping),
        canUnmap: Boolean(mapping),
        onSale: resolveChannelCatalogOnSale(cp, channel.id)
      };
    });
}

export function computeMasterSyncStatus(row, channelPrices) {
  const stock = Number(row.stock) || 0;
  if (stock <= 0) return 'no-stock';
  const linked = (channelPrices || []).filter((item) => item.linked);
  if (!linked.length) return 'waiting';
  const hasDiff = linked.some((cp) => {
    if (Math.abs(Number(cp.saleDiffPct) || 0) > 3) return true;
    if (cp.channelStock != null && Number(cp.channelStock) !== stock) return true;
    return false;
  });
  return hasDiff ? 'diff' : 'ready';
}

export function channelNeedsAttention(row, channelPriceRow) {
  if (!channelPriceRow?.linked) return true;
  const stock = Number(row.stock) || 0;
  if (Math.abs(Number(channelPriceRow.saleDiffPct) || 0) > 3) return true;
  if (channelPriceRow.channelStock != null && Number(channelPriceRow.channelStock) !== stock) return true;
  return false;
}

function isRawChannelProductOnSale(cp, channelId, db) {
  if (!cp) return false;
  const catalogOnSale = resolveChannelCatalogOnSale(cp, channelId);
  if (catalogOnSale === true) return true;
  if (catalogOnSale === false) return false;
  const price = channelSalePriceFromProduct(cp, channelId, db);
  if (!Number.isFinite(Number(price)) || Number(price) <= 0) return false;
  if (cp.catalogQuantity != null) return Number(cp.catalogQuantity) > 0;
  return false;
}

/** Kanal katalog verisine göre ürün satışta mı? (buildMasterChannelPrices satırı) */
export function isChannelProductOnSale(cp) {
  if (cp?.onSale === true) return true;
  if (cp?.onSale === false) return false;
  const price = Number(cp?.channelPrice);
  const stock = cp?.channelStock;
  if (!Number.isFinite(price) || price <= 0) return false;
  if (stock != null) return Number(stock) > 0;
  return false;
}

/**
 * Ana ürün listesini kanal bağlantısı / kanal satış durumuna göre süzer.
 * channelSaleStatus: '' (bağlı), 'on', 'off', 'missing'
 */
export function filterMastersByChannel(rows, db, { channelFocus = '', channelSaleStatus = '' } = {}) {
  const focus = String(channelFocus || '').trim();
  const saleStatus = String(channelSaleStatus || '').trim();
  if (!focus) return rows;

  const pm = db.productMatching;
  const resolver = createMasterChannelResolver(pm);

  return rows.filter((row) => {
    const { cp } = resolver.resolve(row, focus);
    const linked = Boolean(cp);
    if (saleStatus === 'missing') return !linked;
    if (saleStatus === 'on') return linked && isRawChannelProductOnSale(cp, focus, db);
    if (saleStatus === 'off') return linked && !isRawChannelProductOnSale(cp, focus, db);
    return linked;
  });
}

export { channelSalePriceFromProduct };

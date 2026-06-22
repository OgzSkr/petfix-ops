import { listSalesMatchingChannels } from './constants.js';
import { barcodesEquivalent, normalizeBarcode, dedupeBarcodes } from './normalize.js';
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

function resolveChannelProductForMaster(pm, master, channelId) {
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
export function buildMasterChannelPrices(db, master) {
  const pm = db.productMatching;
  const masterSale = roundMoney(master.salePrice1);
  const masterBuy = roundMoney(master.buyingPrice);
  const comparePrice = masterSale > 1 ? masterSale : (masterBuy > 0 ? masterBuy : null);
  const compareBasis = masterSale > 1 ? 'sale' : (masterBuy > 0 ? 'cost' : 'none');

  return listSalesMatchingChannels()
    .filter((channel) => channel.status !== 'planned')
    .map((channel) => {
      const { cp, mapping } = resolveChannelProductForMaster(pm, master, channel.id);
      const rawPrice = channelSalePriceFromProduct(cp, channel.id, db);
      const channelPrice = rawPrice != null ? roundMoney(rawPrice) : null;

      return {
        channelId: channel.id,
        channelProductId: cp?.channelProductId || null,
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

/** Kanal katalog verisine göre ürün satışta mı? */
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

  return rows.filter((row) => {
    const channelPrices = buildMasterChannelPrices(db, row);
    const cp = channelPrices.find((item) => item.channelId === focus);
    if (saleStatus === 'missing') return !cp?.linked;
    if (saleStatus === 'on') return Boolean(cp?.linked && isChannelProductOnSale(cp));
    if (saleStatus === 'off') return Boolean(cp?.linked && !isChannelProductOnSale(cp));
    return Boolean(cp?.linked);
  });
}

export { channelSalePriceFromProduct };

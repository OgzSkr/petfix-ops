import { listSalesMatchingChannels } from './constants.js';
import { barcodesEquivalent, normalizeBarcode } from './normalize.js';
import { priceDiffPercent } from './price-compare.js';

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
  if (channelId === 'trendyol-marketplace') {
    const barcode = normalizeBarcode(cp.channelBarcode);
    const product = (db.products || []).find((p) => normalizeBarcode(p.barcode) === barcode);
    const sale = Number(product?.salePrice);
    return Number.isFinite(sale) && sale > 0 ? sale : null;
  }
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

  const barcodeHit = pm.channelProducts.find(
    (row) => row.channelId === channelId && barcodesEquivalent(row.channelBarcode, master.benimposBarcode)
  ) || null;

  return { cp: barcodeHit, mapping: mapping || null };
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
        saleDiffPct: channelPrice != null && comparePrice
          ? priceDiffPercent(channelPrice, comparePrice)
          : null,
        compareBasis,
        mappingStatus: mapping?.status || (cp ? 'unmapped' : null),
        hasConfirmedMapping: mapping?.status === 'manual_confirmed' || mapping?.status === 'auto_matched',
        barcodeMatchOnly: Boolean(cp && !mapping),
        onSale: cp?.catalogOnSale ?? null
      };
    });
}

export { channelSalePriceFromProduct };

import { hasFilledProductCost } from '../product-import/benimpos-empty-costs.js';
import { normalizeBarcode } from './normalize.js';
import { masterProductAsCostItem } from './master-sync.js';

const BENIMPOS_NOTE_PREFIX = 'BenimPOS import';

function isManualCostNote(note) {
  const text = String(note || '').trim();
  if (!text) return false;
  return !text.startsWith(BENIMPOS_NOTE_PREFIX) && !text.startsWith('BenimPOS master');
}

/**
 * Ana havuz alış fiyatlarını channelCosts ile hizalar (manuel notlu kayıtlara dokunmaz).
 * Kâr hesabı buildCostByBarcode ile masterProducts birincil kaynak olarak okunur.
 */
export function syncChannelCostsFromMasterProducts(db, { sourceName = 'master sync' } = {}) {
  db.channelCosts = db.channelCosts || [];
  const masters = db.productMatching?.masterProducts || [];
  const costByBarcode = new Map(
    db.channelCosts.map((cost) => [normalizeBarcode(cost.barcode), cost])
  );
  const note = `BenimPOS master (${sourceName})`;
  const now = new Date().toISOString();
  const summary = { updated: 0, added: 0, skippedManual: 0, skippedNoCost: 0, masters: masters.length };

  for (const master of masters) {
    const barcode = normalizeBarcode(master.benimposBarcode);
    if (!barcode) continue;

    const item = masterProductAsCostItem(master);
    if (!item) {
      summary.skippedNoCost += 1;
      continue;
    }

    const existing = costByBarcode.get(barcode);
    if (existing) {
      if (isManualCostNote(existing.note)) {
        summary.skippedManual += 1;
        continue;
      }
      existing.productCost = item.productCost;
      existing.costVatRate = existing.costVatRate ?? item.costVatRate ?? 20;
      existing.note = note;
      existing.updatedAt = now;
      summary.updated += 1;
      continue;
    }

    db.channelCosts.push({
      barcode,
      productCost: item.productCost,
      desi: '',
      commissionRate: '',
      costVatRate: item.costVatRate ?? 20,
      modelCode: '',
      color: '',
      size: '',
      returnRate: 0,
      returnRateLabel: '',
      deliveryType: '',
      extraExpense: 0,
      note,
      updatedAt: now
    });
    costByBarcode.set(barcode, true);
    summary.added += 1;
  }

  db.meta = db.meta || {};
  db.meta.masterCostSync = { at: now, ...summary };
  return summary;
}

/** buildCostByBarcode için master alış fiyatı + channelCosts ek alanları birleştirir. */
export function buildMasterCostIndex(db) {
  const index = {};
  for (const master of db.productMatching?.masterProducts || []) {
    const barcode = normalizeBarcode(master.benimposBarcode);
    const buyingPrice = Number(master.buyingPrice) || 0;
    if (!barcode || buyingPrice <= 0) continue;
    index[barcode] = {
      unitCost: buyingPrice,
      desi: 0,
      extraCost: 0,
      packagingCost: 0,
      commissionRate: 0,
      costVatRate: Number(master.taxRate) > 0 ? Number(master.taxRate) : 20,
      costSource: 'master_buying_price'
    };
  }
  return index;
}

export function mergeCostIndexes(channelCostIndex = {}, masterCostIndex = {}) {
  const merged = { ...channelCostIndex };
  for (const [barcode, masterCost] of Object.entries(masterCostIndex)) {
    const channel = channelCostIndex[barcode] || {};
    merged[barcode] = {
      ...channel,
      ...masterCost,
      unitCost: masterCost.unitCost,
      desi: channel.desi || masterCost.desi,
      extraCost: channel.extraCost ?? masterCost.extraCost,
      packagingCost: channel.packagingCost ?? masterCost.packagingCost,
      commissionRate: channel.commissionRate ?? masterCost.commissionRate,
      costVatRate: channel.costVatRate ?? masterCost.costVatRate,
      costSource: 'master_buying_price'
    };
  }
  for (const [barcode, channel] of Object.entries(channelCostIndex)) {
    if (merged[barcode]) continue;
    if (hasFilledProductCost(channel.unitCost)) {
      merged[barcode] = { ...channel, costSource: channel.costSource || 'channel_cost' };
    }
  }
  return merged;
}

import { findByBarcode } from '../utils.js';

const BENIMPOS_NOTE_PREFIX = 'BenimPOS import';

export function hasFilledProductCost(value) {
  if (value === '' || value === null || value === undefined) {
    return false;
  }
  const amount = Number(String(value).replace(',', '.'));
  return Number.isFinite(amount) && amount > 0;
}

function isManualCostNote(note) {
  const text = String(note || '').trim();
  if (!text) return false;
  return !text.startsWith(BENIMPOS_NOTE_PREFIX);
}

export function mergeBenimposEmptyCosts(db, items = [], { sourceName = 'BenimPOS' } = {}) {
  db.costs = db.costs || [];
  db.products = db.products || [];

  const benimposByBarcode = new Map(
    items.map((item) => [String(item.barcode || '').trim(), item]).filter(([barcode]) => barcode)
  );

  const costByBarcode = new Map(db.costs.map((cost) => [String(cost.barcode || ''), cost]));
  const productBarcodes = new Set(db.products.map((product) => String(product.barcode || '')).filter(Boolean));
  const tariffBarcodes = new Set(Object.keys(db.commissionTariff?.byBarcode || {}));

  const summary = {
    filled: 0,
    added: 0,
    skippedHasCost: 0,
    skippedManualCost: 0,
    skippedNotInCatalog: 0,
    skippedNoBenimposMatch: 0,
    benimposItems: benimposByBarcode.size
  };

  const note = `${BENIMPOS_NOTE_PREFIX} (${sourceName})`;
  const now = new Date().toISOString();

  for (const cost of db.costs) {
    const barcode = String(cost.barcode || '').trim();
    if (!barcode) continue;

    if (hasFilledProductCost(cost.productCost)) {
      summary.skippedHasCost += 1;
      continue;
    }

    if (isManualCostNote(cost.note)) {
      summary.skippedManualCost += 1;
      continue;
    }

    const benimpos = benimposByBarcode.get(barcode);
    if (!benimpos) {
      summary.skippedNoBenimposMatch += 1;
      continue;
    }

    cost.productCost = benimpos.productCost;
    cost.costVatRate = cost.costVatRate ?? benimpos.costVatRate ?? 20;
    cost.note = note;
    cost.updatedAt = now;
    summary.filled += 1;
  }

  for (const [barcode, benimpos] of benimposByBarcode) {
    if (costByBarcode.has(barcode)) continue;
    if (!productBarcodes.has(barcode) && !tariffBarcodes.has(barcode)) {
      summary.skippedNotInCatalog += 1;
      continue;
    }

    db.costs.push({
      barcode,
      productCost: benimpos.productCost,
      desi: '',
      commissionRate: '',
      costVatRate: benimpos.costVatRate ?? 20,
      modelCode: '',
      color: '',
      size: '',
      returnRate: 0,
      returnRateLabel: '',
      deliveryType: 'Bugün Kargoda',
      extraExpense: 0,
      note,
      updatedAt: now
    });
    costByBarcode.set(barcode, true);
    summary.added += 1;
  }

  db.meta = db.meta || {};
  db.meta.updatedAt = now;
  db.meta.benimposEmptyCostImport = {
    source: sourceName,
    importedAt: now,
    ...summary
  };

  return summary;
}

export function findByBarcodeInCosts(db, barcode) {
  return findByBarcode(db.costs || [], barcode);
}

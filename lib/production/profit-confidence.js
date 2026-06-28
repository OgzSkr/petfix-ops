import { toNumber } from '../utils.js';
import { ORDER_SOURCES, PROFIT_CONFIDENCE } from './constants.js';

export function computeProfitConfidence(row) {
  if (!row?.orderNumber && !row?.shipmentPackageId) {
    return PROFIT_CONFIDENCE.INVALID_DATA;
  }

  const sales = toNumber(row.salesAmount);
  if (!sales) {
    return PROFIT_CONFIDENCE.INVALID_DATA;
  }

  const hasCost = toNumber(row.productCost) > 0 || toNumber(row.extraCost) > 0;
  const matchingWarnings = row.matchingWarnings || [];
  const unmapped = matchingWarnings.some((w) => /eşleş|mapping|unmapped/i.test(w));
  const missingMapping = row.lines?.some?.((line) => !line.barcode && !line.stockCode);

  if (!hasCost) {
    return PROFIT_CONFIDENCE.MISSING_COST;
  }
  if (unmapped || missingMapping) {
    return PROFIT_CONFIDENCE.MISSING_MAPPING;
  }
  if (row.shippingCostEstimated || row.dataWarnings?.some?.((w) => /tahmin|estimated/i.test(w))) {
    return PROFIT_CONFIDENCE.ESTIMATED;
  }
  return PROFIT_CONFIDENCE.COMPLETE;
}

export function isKpiEligibleRow(row, { excludeSources = [ORDER_SOURCES.FIXTURE] } = {}) {
  const source = row.ingestSource || row.source || ORDER_SOURCES.PARTNER_API;
  if (excludeSources.includes(source)) {
    return false;
  }
  const confidence = row.profitConfidence || computeProfitConfidence(row);
  return confidence !== PROFIT_CONFIDENCE.INVALID_DATA;
}

export function isProfitKpiIncluded(row) {
  const confidence = row.profitConfidence || computeProfitConfidence(row);
  if (!isKpiEligibleRow(row)) return false;
  return confidence === PROFIT_CONFIDENCE.COMPLETE || confidence === PROFIT_CONFIDENCE.ESTIMATED;
}

export function summarizeProfitConfidence(rows) {
  const counts = {
    complete: 0,
    estimated: 0,
    missing_cost: 0,
    missing_mapping: 0,
    invalid_data: 0
  };
  let kpiIncluded = 0;
  let kpiExcluded = 0;

  for (const row of rows) {
    const confidence = row.profitConfidence || computeProfitConfidence(row);
    counts[confidence] = (counts[confidence] || 0) + 1;
    if (isProfitKpiIncluded(row)) kpiIncluded += 1;
    else kpiExcluded += 1;
  }

  return { counts, kpiIncluded, kpiExcluded, total: rows.length };
}

export function labelProfitConfidence(confidence) {
  const labels = {
    complete: 'Tam',
    estimated: 'Tahmini',
    missing_cost: 'Maliyet eksik',
    missing_mapping: 'Eşleşme eksik',
    invalid_data: 'Geçersiz veri'
  };
  return labels[confidence] || confidence;
}

/** Kârlılık raporu Veri sütunu — kısa yönlendirme metni. */
export function labelProfitConfidenceForRow(row = {}) {
  const confidence = row.profitConfidence || computeProfitConfidence(row);
  const base = labelProfitConfidence(confidence);
  if (confidence === 'missing_mapping') {
    return `${base} · Ürünler → kanal eşleştir`;
  }
  if (confidence === 'missing_cost') {
    return `${base} · BenimPOS alış fiyatı yok`;
  }
  if (confidence === 'invalid_data') {
    return `${base} · tutar/satır kontrol`;
  }
  return base;
}

export function labelOrderSource(source) {
  const labels = {
    webhook: 'Webhook',
    partner_api: 'Partner API',
    fixture: 'Fixture',
    manual: 'Manuel'
  };
  return labels[source] || source || '—';
}

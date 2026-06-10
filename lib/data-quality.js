import { toNumber } from './utils.js';
import { computeProfitConfidence } from './production/profit-confidence.js';

export function assessDashboardRow(row) {
  const warnings = [];

  if (row.status === 'EKSIK_VERI' && Array.isArray(row.missing)) {
    for (const field of row.missing) {
      warnings.push(`${field} eksik`);
    }
  }

  if (!toNumber(row.buyboxPrice)) {
    warnings.push('BuyBox fiyatı yok');
  }

  if (!toNumber(row.productCost)) {
    warnings.push('Maliyet girilmemiş');
  }

  if (!toNumber(row.desi)) {
    warnings.push('Desi girilmemiş');
  }

  if (!toNumber(row.commissionRate)) {
    warnings.push('Komisyon oranı yok');
  }

  if (row.status === 'ZARAR') {
    warnings.push('Zararda');
  }

  if (row.updatedAt) {
    const ageHours = (Date.now() - new Date(row.updatedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
      warnings.push('BuyBox verisi 24 saatten eski');
    }
  }

  return [...new Set(warnings)];
}

export function assessOrderRow(row) {
  const warnings = [];

  if (!row.orderNumber) warnings.push('Sipariş numarası eksik');
  if (!row.orderDateMs) warnings.push('Sipariş tarihi eksik');
  if (!toNumber(row.salesAmount)) warnings.push('Satış tutarı sıfır veya eksik');
  if (!toNumber(row.productCost) && !toNumber(row.extraCost)) {
    warnings.push('Maliyet verisi eksik — kâr hesabı güvenilir olmayabilir');
  }
  if (!toNumber(row.commissionAmount) && toNumber(row.salesAmount)) {
    warnings.push('Komisyon hesaplanamadı');
  }
  if (row.netProfit === '' || row.netProfit === null || row.netProfit === undefined) {
    warnings.push('Net kâr hesaplanamadı');
  }
  for (const note of row.matchingWarnings || []) {
    warnings.push(note);
  }

  const confidence = row.profitConfidence || computeProfitConfidence(row);
  if (confidence === 'missing_cost') {
    warnings.push('Maliyet eksik — net kâr KPI dışında gösterilir');
  }
  if (confidence === 'missing_mapping') {
    warnings.push('Ürün eşleşmesi eksik');
  }
  if (confidence === 'estimated') {
    warnings.push('Kâr tahmini — bazı maliyetler eksik olabilir');
  }

  return [...new Set(warnings)];
}

export function enrichOrderRowQuality(row) {
  row.profitConfidence = row.profitConfidence || computeProfitConfidence(row);
  row.dataWarnings = assessOrderRow(row);
  return row;
}

export function summarizeDataQuality(rows, assessFn) {
  let withWarnings = 0;
  const byType = {};
  let missingCost = 0;
  let missingMapping = 0;
  let estimated = 0;
  let matchedProducts = 0;
  let totalLines = 0;
  let missingBarcode = 0;

  for (const row of rows) {
    const warnings = assessFn(row);
    row.dataWarnings = warnings;
    row.profitConfidence = row.profitConfidence || computeProfitConfidence(row);
    if (row.profitConfidence === 'missing_cost') missingCost += 1;
    if (row.profitConfidence === 'missing_mapping') missingMapping += 1;
    if (row.profitConfidence === 'estimated') estimated += 1;
    for (const line of row.lines || []) {
      totalLines += 1;
      if (line.barcode || line.stockCode) matchedProducts += 1;
      else missingBarcode += 1;
    }
    if (!warnings.length) continue;
    withWarnings += 1;
    for (const warning of warnings) {
      byType[warning] = (byType[warning] || 0) + 1;
    }
  }

  const mappingRate = totalLines ? Math.round((matchedProducts / totalLines) * 100) : 0;
  const costRate = rows.length
    ? Math.round(((rows.length - missingCost) / rows.length) * 100)
    : 0;

  return {
    withWarnings,
    byType,
    total: rows.length,
    missingCostOrders: missingCost,
    missingMappingOrders: missingMapping,
    estimatedProfitOrders: estimated,
    missingBarcodeLines: missingBarcode,
    productMappingRatePercent: mappingRate,
    productCostRatePercent: costRate
  };
}

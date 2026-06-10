import { CARGO_BY_DESI, SERVICE_FEE, VAT_RATE } from '../../profit-constants.js';
import { roundMoney, toNumber } from '../../utils.js';

export function includedVat(value) {
  const amount = toNumber(value);
  return amount - amount / (1 + VAT_RATE);
}

export function calculateProfitBreakdown(input) {
  const salePrice = toNumber(input.buyboxPrice);
  const commissionRate = toNumber(input.commissionRate);
  const productCost = toNumber(input.productCost);
  const desi = Math.ceil(toNumber(input.desi));
  const missing = [];

  if (!salePrice) missing.push('Satış fiyatı');
  if (!commissionRate) missing.push('Komisyon');
  if (!productCost) missing.push('Ürün maliyeti');
  if (!desi) missing.push('Desi');

  if (missing.length) {
    return {
      netProfit: '',
      profitRate: '',
      status: 'EKSIK_VERI',
      missing,
      breakdown: null
    };
  }

  const shippingFee = CARGO_BY_DESI[Math.min(Math.max(desi, 1), 25)] || CARGO_BY_DESI[25];
  const commission = salePrice * (commissionRate / 100);
  const withholding = (salePrice / (1 + VAT_RATE)) * 0.01;
  const salesVat = includedVat(salePrice);
  const purchaseVat = includedVat(productCost);
  const shippingVat = includedVat(shippingFee);
  const commissionVat = includedVat(commission);
  const serviceVat = includedVat(SERVICE_FEE);
  const payableVat = Math.max(0, salesVat - purchaseVat - shippingVat - commissionVat - serviceVat);
  const netProfit = salePrice - commission - shippingFee - SERVICE_FEE - withholding - payableVat - productCost;
  const profitRate = salePrice ? netProfit / salePrice : '';

  return {
    netProfit: roundMoney(netProfit),
    profitRate,
    status: netProfit > 0 ? 'KARLI' : 'ZARAR',
    missing: [],
    breakdown: {
      salePrice: roundMoney(salePrice),
      priceLabel: input.priceLabel || 'Satış fiyatı',
      commissionRate,
      commissionTier: input.commissionTier ?? null,
      productCost: roundMoney(productCost),
      desi,
      shippingFee: roundMoney(shippingFee),
      serviceFee: roundMoney(SERVICE_FEE),
      commission: roundMoney(commission),
      withholding: roundMoney(withholding),
      salesVat: roundMoney(salesVat),
      purchaseVat: roundMoney(purchaseVat),
      shippingVat: roundMoney(shippingVat),
      commissionVat: roundMoney(commissionVat),
      serviceVat: roundMoney(serviceVat),
      payableVat: roundMoney(payableVat),
      vatRatePercent: VAT_RATE * 100
    }
  };
}

export function calculateProfit(input) {
  const result = calculateProfitBreakdown(input);
  return {
    netProfit: result.netProfit,
    profitRate: result.profitRate,
    status: result.status,
    missing: result.missing
  };
}

export function sheetMissingFields(snapshot) {
  const missing = [];

  if (snapshot.missingCommission) missing.push(snapshot.missingCommission);
  if (snapshot.missingCost) missing.push(snapshot.missingCost);
  if (snapshot.missingDesi) missing.push(snapshot.missingDesi);

  return missing;
}

export function latestByBarcodeMap(snapshots) {
  const latest = {};

  for (const snapshot of snapshots) {
    const current = latest[snapshot.barcode];

    if (!current || String(snapshot.updatedAt || '') > String(current.updatedAt || '')) {
      latest[snapshot.barcode] = snapshot;
    }
  }

  return latest;
}

export function autoTrackMap(items) {
  const map = {};

  for (const item of items) {
    map[String(item.barcode)] = item;
  }

  return map;
}

import { roundMoney } from '../utils.js';
import { computeGetirOrderFinancials } from '../channels/getir-portal-financials.js';

function lineGross(line) {
  const qty = Number(line.quantity) || 1;
  const explicit = Number(line.lineGrossAmount ?? line.lineSalesAmount);
  if (Number.isFinite(explicit) && explicit !== 0) return explicit;
  const unit = Number(line.lineUnitPrice ?? line.unitPrice ?? line.price) || 0;
  return unit * qty;
}

/**
 * Trendyol Go partner portalı komisyonu indirim sonrası net tutar üzerinden gösterir.
 * Settlement API Satış satırı ise brüt (credit) üzerinden commissionAmount döner.
 */
export function resolveLinePortalCommission(line) {
  const gross = lineGross(line);
  const discount = Number(line.lineSellerDiscount) || 0;
  const rate = Number(line.commission) || 0;
  const saleCommission = Number(line.saleCommissionAmount) || 0;
  const discountCommission = Number(line.discountCommissionAmount) || 0;
  const totalCommission = Number(line.commissionAmount) || 0;

  if (saleCommission > 0 && discountCommission > 0) {
    return roundMoney(Math.max(0, saleCommission - discountCommission));
  }

  if (saleCommission > 0 && discount > 0 && rate > 0) {
    const grossExpected = roundMoney(gross * rate / 100);
    if (Math.abs(saleCommission - grossExpected) < 0.05) {
      return roundMoney(Math.max(0, gross - discount) * rate / 100);
    }
  }

  if (totalCommission > 0 && discountCommission > 0) {
    return roundMoney(Math.max(0, totalCommission - discountCommission));
  }

  if (rate > 0 && gross > 0) {
    return roundMoney(Math.max(0, gross - discount) * rate / 100);
  }

  if (saleCommission > 0) {
    return roundMoney(saleCommission);
  }

  return roundMoney(totalCommission);
}

function financialsFromPortal(portal) {
  const gross = roundMoney(portal.price);
  const net = roundMoney(portal.netEarning);
  const totalDeductions = gross > 0 ? roundMoney(Math.max(0, gross - net)) : 0;
  const discountRate = gross > 0 && totalDeductions > 0
    ? roundMoney((totalDeductions / gross) * 10000) / 100
    : 0;

  return {
    grossAmount: gross,
    sellerDiscount: roundMoney(portal.discount),
    commissionAmount: roundMoney(portal.commission),
    commissionRate: portal.commissionRate ?? null,
    provisionAmount: roundMoney(Math.abs(portal.provision)),
    provisionCredit: portal.provision > 0 ? roundMoney(portal.provision) : 0,
    partialRefund: roundMoney(portal.partialRefund),
    deliveryFee: roundMoney(portal.deliveryFee),
    netAmount: net,
    totalDeductions,
    discountRate,
    settlementLoaded: true
  };
}

function resolveProvisionNet(orderPackage) {
  if (orderPackage?.portalFinancials?.loaded) {
    return roundMoney(-Number(orderPackage.portalFinancials.provision) || 0);
  }
  if (orderPackage?.packageProvisionNet != null && orderPackage.packageProvisionNet !== '') {
    return roundMoney(Number(orderPackage.packageProvisionNet));
  }
  const abs = Number(orderPackage?.packageProvisionAmount) || 0;
  return abs > 0 ? roundMoney(abs) : 0;
}

function resolvePackagePortalCommission(orderPackage, lineCommissionSum) {
  if (orderPackage?.portalFinancials?.loaded) {
    return roundMoney(orderPackage.portalFinancials.commission);
  }

  const fromPackage = roundMoney(Number(orderPackage?.packagePortalCommissionAmount) || 0);
  if (fromPackage > 0) {
    return fromPackage;
  }

  const saleCommission = roundMoney(Number(orderPackage?.packageSaleCommissionAmount) || 0);
  const discountCommission = roundMoney(Number(orderPackage?.packageDiscountCommissionAmount) || 0);
  if (saleCommission > 0 && discountCommission > 0) {
    return roundMoney(Math.max(0, saleCommission - discountCommission));
  }

  return roundMoney(lineCommissionSum);
}

/**
 * Uber / Trendyol Go settlement siparişinden brüt, indirim, komisyon, provizyon ve net hakediş.
 */
export function summarizeUberOrderFinancials(orderPackage) {
  if (orderPackage?.portalFinancials?.loaded) {
    return financialsFromPortal(orderPackage.portalFinancials);
  }

  const lines = orderPackage?.lines || [];
  let gross = 0;
  let sellerDiscount = 0;
  let commission = 0;
  let sellerRevenue = 0;

  for (const line of lines) {
    gross += lineGross(line);
    sellerDiscount += Number(line.lineSellerDiscount) || 0;
    commission += resolveLinePortalCommission(line);
    sellerRevenue += Number(line.sellerRevenue) || 0;
  }

  if (!gross) {
    gross = Number(orderPackage?.packageGrossAmount) || 0;
  }
  if (!sellerDiscount) {
    sellerDiscount = Number(orderPackage?.packageTotalDiscount) || 0;
  }

  const provisionNet = resolveProvisionNet(orderPackage);
  const provisionAmount = roundMoney(Math.abs(provisionNet));

  gross = roundMoney(gross);
  sellerDiscount = roundMoney(sellerDiscount);
  commission = resolvePackagePortalCommission(orderPackage, commission);

  const packageSellerRevenue = roundMoney(Number(orderPackage?.packageSellerRevenue) || 0);
  if (packageSellerRevenue > sellerRevenue) {
    sellerRevenue = packageSellerRevenue;
  }
  sellerRevenue = roundMoney(sellerRevenue);

  const discountSellerRevenue = roundMoney(Number(orderPackage?.packageDiscountSellerRevenue) || 0);

  let net;
  if (sellerRevenue > 0 && discountSellerRevenue > 0) {
    net = roundMoney(Math.max(0, sellerRevenue - discountSellerRevenue - provisionNet));
  } else {
    net = roundMoney(Math.max(0, gross - sellerDiscount - commission - provisionNet));
  }

  const totalDeductions = gross > 0
    ? roundMoney(Math.max(0, gross - net))
    : roundMoney(sellerDiscount + commission + provisionNet);
  const discountRate = gross > 0 && totalDeductions > 0
    ? roundMoney((totalDeductions / gross) * 10000) / 100
    : 0;

  return {
    grossAmount: gross,
    sellerDiscount,
    commissionAmount: commission,
    provisionAmount,
    provisionNet,
    netAmount: net,
    totalDeductions,
    discountRate,
    settlementLoaded: false
  };
}

export function formatUberFinancialNote(financials) {
  const fmt = (value) => Number(value).toFixed(2).replace('.', ',');
  const parts = [
    `Brüt: ${fmt(financials.grossAmount)} TL`,
    `İnd: ${fmt(financials.sellerDiscount)}`,
    `Kom: ${fmt(financials.commissionAmount)}`
  ];
  if (Number(financials.provisionAmount) > 0) {
    const sign = Number(financials.provisionCredit) > 0 ? '+' : '-';
    parts.push(`Prov: ${sign}${fmt(financials.provisionAmount)}`);
  }
  parts.push(`Net: ${fmt(financials.netAmount)} TL`);
  return parts.join(' | ');
}

export function summarizeGetirOrderFinancials(orderPackage) {
  if (orderPackage?.getirFinancials?.loaded) {
    return { ...orderPackage.getirFinancials };
  }
  if (orderPackage?.portalFinancials?.loaded && orderPackage?.channel === 'getir') {
    return financialsFromPortal(orderPackage.portalFinancials);
  }
  return computeGetirOrderFinancials(orderPackage);
}

export function formatGetirFinancialNote(financials) {
  const fmt = (value) => Number(value).toFixed(2).replace('.', ',');
  const parts = [
    `Brüt: ${fmt(financials.grossAmount)} TL`,
    `İnd: ${fmt(financials.sellerDiscount)}`
  ];
  if (Number(financials.orderCommission) > 0) {
    parts.push(`Kom: ${fmt(financials.orderCommission)}`);
  } else if (Number(financials.commissionAmount) > 0) {
    parts.push(`Kom: ${fmt(financials.commissionAmount)}`);
  }
  if (Number(financials.courierFee) > 0) {
    parts.push(`Kurye: ${fmt(financials.courierFee)}`);
  }
  if (Number(financials.withholdingAmount) > 0) {
    parts.push(`Stopaj: ${fmt(financials.withholdingAmount)}`);
  }
  parts.push(`Net: ${fmt(financials.netAmount)} TL`);
  return parts.join(' | ');
}

/**
 * BenimPOS satışına Getir indirim + komisyon düşümünü uygular (discountRate + not).
 */
export function applyGetirBenimposFinancials(payload, orderPackage, financials) {
  const resolved = financials || summarizeGetirOrderFinancials(orderPackage);
  if (!resolved?.grossAmount) {
    return { payload, financials: resolved };
  }

  if (resolved.discountRate > 0) {
    payload.data.discountRate = resolved.discountRate;
  }

  const detail = formatGetirFinancialNote(resolved);
  const base = String(payload.data.note || '').trim();
  payload.data.note = (base ? `${base} | ${detail}` : detail).slice(0, 500);

  return { payload, financials: resolved };
}

/**
 * BenimPOS satışına Uber indirim + komisyon düşümünü uygular (discountRate + not).
 */
export function applyUberBenimposFinancials(payload, orderPackage) {
  const financials = summarizeUberOrderFinancials(orderPackage);
  if (!financials.grossAmount) {
    return { payload, financials };
  }

  if (financials.discountRate > 0) {
    payload.data.discountRate = financials.discountRate;
  }

  const detail = formatUberFinancialNote(financials);
  const base = String(payload.data.note || '').trim();
  payload.data.note = (base ? `${base} | ${detail}` : detail).slice(0, 500);

  return { payload, financials };
}

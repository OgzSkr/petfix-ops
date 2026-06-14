import { roundMoney } from '../utils.js';

function lineGross(line) {
  const qty = Number(line.quantity) || 1;
  const explicit = Number(line.lineGrossAmount ?? line.lineSalesAmount);
  if (Number.isFinite(explicit) && explicit !== 0) return explicit;
  const unit = Number(line.lineUnitPrice ?? line.unitPrice ?? line.price) || 0;
  return unit * qty;
}

/**
 * Uber / Trendyol Go settlement siparişinden brüt, indirim, komisyon ve net hakediş.
 */
export function summarizeUberOrderFinancials(orderPackage) {
  const lines = orderPackage?.lines || [];
  let gross = 0;
  let sellerDiscount = 0;
  let commission = 0;

  for (const line of lines) {
    gross += lineGross(line);
    sellerDiscount += Number(line.lineSellerDiscount) || 0;
    commission += Number(line.commissionAmount) || 0;
  }

  if (!gross) {
    gross = Number(orderPackage?.packageGrossAmount) || 0;
  }
  if (!sellerDiscount) {
    sellerDiscount = Number(orderPackage?.packageTotalDiscount) || 0;
  }

  gross = roundMoney(gross);
  sellerDiscount = roundMoney(sellerDiscount);
  commission = roundMoney(commission);
  const totalDeductions = roundMoney(sellerDiscount + commission);
  const net = roundMoney(Math.max(0, gross - totalDeductions));
  const discountRate = gross > 0 && totalDeductions > 0
    ? roundMoney((totalDeductions / gross) * 10000) / 100
    : 0;

  return {
    grossAmount: gross,
    sellerDiscount,
    commissionAmount: commission,
    totalDeductions,
    netAmount: net,
    discountRate
  };
}

export function formatUberFinancialNote(financials) {
  const fmt = (value) => Number(value).toFixed(2).replace('.', ',');
  return [
    `Brüt: ${fmt(financials.grossAmount)} TL`,
    `İnd: ${fmt(financials.sellerDiscount)}`,
    `Kom: ${fmt(financials.commissionAmount)}`,
    `Net: ${fmt(financials.netAmount)} TL`
  ].join(' | ');
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

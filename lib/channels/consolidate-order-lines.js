import { roundMoney } from '../utils.js';

/** Satır birim + toplam tutarını hizalar (TGO: birim × adet = satır toplamı). */
export function normalizeOrderLinePricingFields(raw = {}) {
  const qty = Number(raw.quantity) || 1;
  let unit = Number(
    raw.lineUnitPrice ?? raw.unitPrice ?? raw.unitSalesPrice ?? raw.unit_price
  ) || 0;
  let gross = Number(raw.lineGrossAmount ?? raw.lineSalesAmount) || 0;
  const paidGross = Number(raw.paidLineGross);
  const hasPaidGross = Number.isFinite(paidGross) && paidGross > 0;

  if (unit > 0 && gross > 0 && Math.abs(gross - unit) < 0.02 && qty > 1 && !hasPaidGross) {
    gross = roundMoney(unit * qty);
  } else if (unit > 0 && !gross) {
    gross = roundMoney(unit * qty);
  } else if (gross > 0 && !unit) {
    unit = roundMoney(gross / qty);
  } else if (unit > 0 && gross > 0 && Math.abs(gross - unit * qty) > 0.05 && !hasPaidGross) {
    gross = roundMoney(unit * qty);
  }

  unit = roundMoney(unit);
  gross = roundMoney(gross || unit * qty);

  return {
    ...raw,
    quantity: qty,
    lineUnitPrice: unit,
    unitPrice: unit,
    unitSalesPrice: unit,
    lineGrossAmount: gross,
    lineSalesAmount: gross,
    paidLineGross: hasPaidGross ? roundMoney(paidGross) : gross
  };
}

function lineUnitPrice(line) {
  const normalized = normalizeOrderLinePricingFields(line);
  return normalized.lineUnitPrice;
}

function lineGrossTotal(line) {
  return normalizeOrderLinePricingFields(line).lineGrossAmount;
}

function lineKey(line) {
  const barcode = String(line.barcode || '').trim();
  const unitPrice = roundMoney(lineUnitPrice(line));
  if (barcode) return `bc:${barcode}@${unitPrice.toFixed(2)}`;
  const name = String(line.productName || line.title || '').trim().toLowerCase();
  if (name) return `nm:${name}@${unitPrice.toFixed(2)}`;
  return '';
}

/** Aynı barkod + birim fiyat satırlarını tek satırda toplar (TGO settlement satırları). */
export function consolidateOrderLines(lines = []) {
  const input = (lines || []).map((line) => normalizeOrderLinePricingFields(line));
  if (!input.length) return [];
  if (input.length <= 1) return input;

  const buckets = new Map();
  const passthrough = [];

  for (const raw of input) {
    if (!raw) continue;
    const key = lineKey(raw);
    if (!key) {
      passthrough.push(raw);
      continue;
    }

    const qty = Number(raw.quantity) || 1;
    const unitPrice = roundMoney(lineUnitPrice(raw));
    const gross = lineGrossTotal(raw);
    const sellerDiscount = Number(raw.lineSellerDiscount) || 0;
    const saleCommissionAmount = Number(raw.saleCommissionAmount) || 0;
    const discountCommissionAmount = Number(raw.discountCommissionAmount) || 0;
    const portalCommissionAmount = Number(raw.portalCommissionAmount) || 0;
    const commissionAmount = Number(raw.commissionAmount) || 0;
    const sellerRevenue = Number(raw.sellerRevenue) || 0;

    if (!buckets.has(key)) {
      buckets.set(key, {
        ...raw,
        quantity: qty,
        lineUnitPrice: unitPrice,
        unitPrice: unitPrice,
        unitSalesPrice: unitPrice,
        lineGrossAmount: roundMoney(gross),
        lineSalesAmount: roundMoney(gross),
        lineSellerDiscount: roundMoney(sellerDiscount),
        saleCommissionAmount: roundMoney(saleCommissionAmount),
        discountCommissionAmount: roundMoney(discountCommissionAmount),
        portalCommissionAmount: roundMoney(portalCommissionAmount),
        commissionAmount: roundMoney(commissionAmount),
        sellerRevenue: roundMoney(sellerRevenue)
      });
      continue;
    }

    const merged = buckets.get(key);
    merged.quantity += qty;
    merged.lineGrossAmount = roundMoney((Number(merged.lineGrossAmount) || 0) + gross);
    merged.lineSalesAmount = merged.lineGrossAmount;
    merged.lineSellerDiscount = roundMoney((Number(merged.lineSellerDiscount) || 0) + sellerDiscount);
    merged.saleCommissionAmount = roundMoney((Number(merged.saleCommissionAmount) || 0) + saleCommissionAmount);
    merged.discountCommissionAmount = roundMoney((Number(merged.discountCommissionAmount) || 0) + discountCommissionAmount);
    merged.portalCommissionAmount = roundMoney((Number(merged.portalCommissionAmount) || 0) + portalCommissionAmount);
    merged.commissionAmount = roundMoney((Number(merged.commissionAmount) || 0) + commissionAmount);
    merged.sellerRevenue = roundMoney((Number(merged.sellerRevenue) || 0) + sellerRevenue);
    if (!merged.productName && raw.productName) merged.productName = raw.productName;
    if (!merged.title && raw.title) merged.title = raw.title;
    if (!merged.imageUrl && raw.imageUrl) merged.imageUrl = raw.imageUrl;
    if (!merged.brandName && raw.brandName) merged.brandName = raw.brandName;
  }

  return [...buckets.values(), ...passthrough];
}

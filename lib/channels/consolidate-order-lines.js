import { roundMoney } from '../utils.js';

function lineUnitPrice(line) {
  const qty = Number(line.quantity) || 1;
  if (line.lineUnitPrice != null && line.lineUnitPrice !== '') return Number(line.lineUnitPrice);
  if (line.unitPrice != null && line.unitPrice !== '') return Number(line.unitPrice);
  if (line.unitSalesPrice != null && line.unitSalesPrice !== '') return Number(line.unitSalesPrice);
  const gross = Number(line.lineGrossAmount ?? line.lineSalesAmount) || 0;
  return qty > 0 ? gross / qty : gross;
}

function lineGrossTotal(line) {
  const qty = Number(line.quantity) || 1;
  const explicit = Number(line.lineGrossAmount ?? line.lineSalesAmount);
  if (Number.isFinite(explicit) && explicit !== 0) return explicit;
  return roundMoney(lineUnitPrice(line) * qty);
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
  if (!Array.isArray(lines) || lines.length <= 1) return [...(lines || [])];

  const buckets = new Map();
  const passthrough = [];

  for (const raw of lines) {
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
    const commissionAmount = Number(raw.commissionAmount) || 0;

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
        commissionAmount: roundMoney(commissionAmount)
      });
      continue;
    }

    const merged = buckets.get(key);
    merged.quantity += qty;
    merged.lineGrossAmount = roundMoney((Number(merged.lineGrossAmount) || 0) + gross);
    merged.lineSalesAmount = merged.lineGrossAmount;
    merged.lineSellerDiscount = roundMoney((Number(merged.lineSellerDiscount) || 0) + sellerDiscount);
    merged.commissionAmount = roundMoney((Number(merged.commissionAmount) || 0) + commissionAmount);
    if (!merged.productName && raw.productName) merged.productName = raw.productName;
    if (!merged.title && raw.title) merged.title = raw.title;
    if (!merged.imageUrl && raw.imageUrl) merged.imageUrl = raw.imageUrl;
    if (!merged.brandName && raw.brandName) merged.brandName = raw.brandName;
  }

  return [...buckets.values(), ...passthrough];
}

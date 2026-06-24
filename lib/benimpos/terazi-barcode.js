import {
  looksLikeMultipack,
  normalizeBarcode,
  parseWeightGrams
} from '../product-matching/normalize.js';

/** Sipariş satırı adından gramaj (multipack hariç). */
export function parseOrderLineWeightGrams(productName) {
  const text = String(productName || '').trim();
  if (!text || looksLikeMultipack(text)) return null;
  return parseWeightGrams(text);
}

/** Sabit paket (konserv, pouch vb.) — isim gramaj farkında terazi uygulanmaz. */
export function isFixedPackageProduct(name = '') {
  return /\bKONSERV|\bPOUCH|\bPAUCH|\bSASET|\bSACHET|\bTUP\b|\bTÜP\b/i.test(String(name || ''));
}

/** BenimPOS master kartının referans birim ağırlığı (gram). */
export function masterUnitWeightGrams(master) {
  if (!master) return null;
  const fromField = Number(master.normalizedWeightG);
  if (Number.isFinite(fromField) && fromField > 0) return Math.round(fromField);
  const parsed = parseWeightGrams(master.name);
  if (parsed) return parsed;
  const unit = String(master.unitValue || '').trim().toUpperCase();
  const name = String(master.name || '');
  if (unit === 'KG' || /\bAÇIK\b|\bACIK\b|GRAMAJLI|TERAZI/i.test(name)) {
    return 1000;
  }
  return null;
}

/**
 * Terazi barkodu: {anaBarkod}{gramaj 4 hane}
 * Örn. 2900052 + 0500 → 29000520500 (0,5 birim), 1000 g → 2900052 (ana kart).
 */
export function buildTeraziBarcode(baseBarcode, orderGrams) {
  const base = normalizeBarcode(baseBarcode);
  if (!base) return '';

  const grams = Math.round(Number(orderGrams));
  if (!Number.isFinite(grams) || grams <= 0 || grams > 9999) return base;

  return `${base}${String(grams).padStart(4, '0')}`;
}

/**
 * Satış / maliyet için terazi barkodu çözümü.
 * Master'da birim gramaj yoksa veya sipariş satırında gramaj okunamazsa ana barkod kullanılır.
 */
function resolveOrderLineGrams(orderLineName, explicitOrderGrams) {
  const explicit = Math.round(Number(explicitOrderGrams));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return parseOrderLineWeightGrams(orderLineName);
}

export function resolveTeraziSaleBarcode({
  baseBarcode,
  master = null,
  orderLineName = '',
  orderGrams: explicitOrderGrams = null
} = {}) {
  const base = normalizeBarcode(baseBarcode);
  const unitGrams = masterUnitWeightGrams(master);
  const explicitGrams = Math.round(Number(explicitOrderGrams));
  const hasExplicitOrderGrams = Number.isFinite(explicitGrams) && explicitGrams > 0;
  const orderGrams = resolveOrderLineGrams(orderLineName, explicitOrderGrams);

  if (!hasExplicitOrderGrams && isFixedPackageProduct(`${master?.name || ''} ${orderLineName}`)) {
    return {
      saleBarcode: base,
      teraziApplied: false,
      orderGrams: null,
      unitGrams,
      costRatio: 1,
      orderGramsIsTotal: false
    };
  }

  if (!base || !unitGrams || !orderGrams) {
    return {
      saleBarcode: base,
      teraziApplied: false,
      orderGrams,
      unitGrams,
      costRatio: 1,
      orderGramsIsTotal: hasExplicitOrderGrams
    };
  }

  if (orderGrams === unitGrams) {
    return {
      saleBarcode: base,
      teraziApplied: false,
      orderGrams,
      unitGrams,
      costRatio: 1,
      orderGramsIsTotal: hasExplicitOrderGrams
    };
  }

  // BenimPOS satışı: ana barkod + birim adet (1 kg kart → 2000 g = 2 adet, 500 g = 0,5).
  // Suffix barkod (29007102000) yalnızca buildTeraziBarcode ile referans; POS kartı ana barkoddur.
  return {
    saleBarcode: base,
    teraziApplied: true,
    orderGrams,
    unitGrams,
    costRatio: Math.round((orderGrams / unitGrams) * 10000) / 10000,
    suffixBarcode: buildTeraziBarcode(base, orderGrams),
    // Kanal totalWeight/orderGrams zaten satır toplamıdır — adet ile tekrar çarpma.
    orderGramsIsTotal: hasExplicitOrderGrams
  };
}

/** Terazi satırında BenimPOS adet — sipariş adedi × (gram / birim gram). */
export function resolveTeraziSaleQuantity(terazi, orderQuantity = 1) {
  const qty = Number(orderQuantity) || 1;
  if (!terazi?.teraziApplied) return qty;
  const ratio = terazi.costRatio || 1;
  if (terazi.orderGramsIsTotal) return roundTeraziQuantity(ratio);
  return roundTeraziQuantity(qty * ratio);
}

/** Kanal satır birim fiyatını kg birim fiyatına çevir (toplam tutar korunur). */
export function resolveTeraziSaleUnitPrice(lineUnitPrice, terazi) {
  const price = Number(lineUnitPrice) || 0;
  if (!terazi?.teraziApplied || !terazi.costRatio) return price;
  return roundTeraziQuantity(price / terazi.costRatio);
}

function roundTeraziQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

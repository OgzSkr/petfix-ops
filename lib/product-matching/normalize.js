const VARIANT_PATTERNS = [
  { key: 'kitten', re: /\bkitten\b|\byavru\b/i },
  { key: 'sterilised', re: /\bsteril/i },
  { key: 'adult', re: /\badult\b|\byetişkin\b/i },
  { key: 'senior', re: /\bsenior\b|\byaşlı\b/i },
  { key: 'puppy', re: /\bpuppy\b|\byavru\b.*\bköpek\b/i }
];

const WEIGHT_RE = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram|kilogram)\b/i;
const MULTIPACK_RE = /\b(\d+)\s*[x×]\s*|\b(\d+)\s*['']?li\b|\b\d+\s*adet\b/i;

export function normalizeBarcode(value) {
  let text = String(value ?? '').trim();
  if (!text) return '';
  if (/\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
  return text;
}

/** Sayısal barkodlar için eşdeğer anahtarlar (baştaki 0, UPC-A ↔ EAN-13) */
export function barcodeLookupKeys(value) {
  const raw = normalizeBarcode(value);
  if (!raw) return [];

  const keys = new Set([raw]);
  if (!/^\d+$/.test(raw)) return [...keys];

  const stripped = raw.replace(/^0+/, '') || '0';
  keys.add(stripped);

  if (stripped.length >= 11 && stripped.length <= 13) {
    keys.add(`0${stripped}`);
  }

  return [...keys];
}

/** Bir listeyi normalize eder, boşları atar ve sırayı koruyarak tekilleştirir. */
export function dedupeBarcodes(values = []) {
  const list = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  for (const value of list) {
    const normalized = normalizeBarcode(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function barcodesEquivalent(a, b) {
  const left = new Set(barcodeLookupKeys(a));
  for (const key of barcodeLookupKeys(b)) {
    if (left.has(key)) return true;
  }
  return false;
}

export function findMasterByBarcodeKeys(masterProducts, barcode) {
  const lookup = new Set(barcodeLookupKeys(barcode));
  if (!lookup.size) return null;

  let match = null;
  for (const master of masterProducts) {
    for (const key of barcodeLookupKeys(master.benimposBarcode)) {
      if (!lookup.has(key)) continue;
      if (match && match.id !== master.id) {
        return { conflict: true, masters: [match, master] };
      }
      match = master;
    }
  }
  return match ? { master: match, conflict: false } : null;
}

export function parseWeightGrams(text) {
  const source = String(text || '');
  const match = source.match(WEIGHT_RE);
  if (!match) return null;

  const amount = Number(String(match[1]).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  if (unit.startsWith('k')) return Math.round(amount * 1000);
  return Math.round(amount);
}

export function detectVariantKey(text) {
  const source = String(text || '');
  for (const { key, re } of VARIANT_PATTERNS) {
    if (re.test(source)) return key;
  }
  return null;
}

export function looksLikeMultipack(text) {
  return MULTIPACK_RE.test(String(text || ''));
}

/** Kanal ürün adından marka, gramaj, paket ve varyant ipuçları (otomatik kayıt için değil, öneri). */
export function parseChannelNameHints(text) {
  const source = String(text || '').trim();
  if (!source) return [];

  const hints = [];
  const grams = parseWeightGrams(source);
  if (grams) {
    hints.push({ field: 'gramaj', label: 'Gramaj', value: `${grams} g` });
  }

  const in1 = source.match(/\b(\d+)\s*in\s*1\b|\b(\d+)in1\b/i);
  if (in1) {
    hints.push({ field: 'varyant', label: 'Varyant', value: `${in1[1] || in1[2]}in1` });
  }

  const packLi = source.match(/\b(\d+)\s*['']?[lL][iıİI]\b/);
  const packX = source.match(/\b(\d+)\s*[x×]\s*\d/i);
  if (packLi) {
    hints.push({ field: 'paket', label: 'Paket adedi', value: packLi[1] });
  } else if (packX) {
    hints.push({ field: 'paket', label: 'Paket adedi', value: packX[1] });
  }

  const brandLead = source.match(/^([A-Za-z0-9][A-Za-z0-9+\-]{1,24})\b/);
  if (brandLead) {
    hints.push({ field: 'marka', label: 'Marka', value: brandLead[1] });
  }

  const seen = new Set();
  return hints.filter((hint) => {
    const key = `${hint.field}:${hint.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tokenizeName(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöç\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** 0–100 basit token overlap skoru */
export function nameSimilarityScore(a, b) {
  const ta = new Set(tokenizeName(a));
  const tb = new Set(tokenizeName(b));
  if (!ta.size || !tb.size) return 0;

  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }
  return Math.round((overlap / Math.max(ta.size, tb.size)) * 100);
}

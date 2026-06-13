function isGenericLineProductName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'satış' || normalized === 'satis' || normalized === 'sale';
}

function lineDisplayName(line) {
  return String(line?.productName || line?.title || '').trim();
}

function barcodeMatchKey(barcode) {
  const digits = String(barcode || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 13 ? digits.slice(-13) : digits;
}

function mergeLineFields(baseLine, extraLine) {
  if (!extraLine) return baseLine;
  const merged = { ...baseLine };
  const extraName = lineDisplayName(extraLine);
  if (extraName && isGenericLineProductName(lineDisplayName(merged))) {
    merged.productName = extraName;
  }
  if (!merged.imageUrl && extraLine.imageUrl) merged.imageUrl = extraLine.imageUrl;
  if (!merged.brandName && extraLine.brandName) merged.brandName = extraLine.brandName;
  return merged;
}

export function mergeOrderLines(baseLines, extraLines) {
  const base = Array.isArray(baseLines) ? baseLines.map((line) => ({ ...line })) : [];
  const extras = Array.isArray(extraLines) ? extraLines : [];
  if (!extras.length) return base;
  if (!base.length) return extras.map((line) => ({ ...line }));

  const extraByBarcode = new Map();
  for (const line of extras) {
    const key = barcodeMatchKey(line.barcode);
    if (key && !extraByBarcode.has(key)) extraByBarcode.set(key, line);
  }

  const usedExtra = new Set();
  const merged = base.map((line, index) => {
    const key = barcodeMatchKey(line.barcode);
    let match = key ? extraByBarcode.get(key) : null;
    if (!match && extras[index]) match = extras[index];
    if (match) usedExtra.add(match);
    return mergeLineFields(line, match);
  });

  for (const line of extras) {
    if (usedExtra.has(line)) continue;
    if (extras.length > base.length) merged.push({ ...line });
  }

  return merged;
}

/**
 * Kanal sipariş paketlerini birleştirir; müşteri/teslimat gibi zengin alanları korur.
 */
export function dedupeOrderPackages(packages) {
  const index = new Map();
  const out = [];

  function pkgKeys(pkg) {
    return [pkg.shipmentPackageId, pkg.orderNumber, pkg.id]
      .map((k) => String(k || '').trim())
      .filter(Boolean);
  }

  function mergePackages(base, extra) {
    const merged = { ...base };
    for (const field of ['customerName', 'customerPhone', 'customerAddress', 'deliveryMethod', 'paymentMethod']) {
      if (extra[field]) merged[field] = extra[field];
    }
    if (Array.isArray(extra.lines) && extra.lines.length) {
      merged.lines = mergeOrderLines(merged.lines, extra.lines);
    }
    if (!merged.packageGrossAmount && extra.packageGrossAmount) {
      merged.packageGrossAmount = extra.packageGrossAmount;
    }
    return merged;
  }

  for (const pkg of packages || []) {
    const keys = pkgKeys(pkg);
    if (!keys.length) continue;

    let existingIdx = null;
    for (const k of keys) {
      if (index.has(k)) {
        existingIdx = index.get(k);
        break;
      }
    }

    if (existingIdx != null) {
      out[existingIdx] = mergePackages(out[existingIdx], pkg);
      continue;
    }

    const idx = out.length;
    keys.forEach((k) => index.set(k, idx));
    out.push(pkg);
  }

  return out;
}

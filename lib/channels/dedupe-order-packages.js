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

const ORDER_STATUS_PRIORITY = Object.freeze({
  completed: 100,
  delivered: 100,
  cancelled: 90,
  canceled: 90,
  failed: 85,
  dispatched: 60,
  ready: 55,
  picked: 50,
  picking: 25,
  received: 20,
  created: 15,
  900: 100,
  1500: 100,
  1600: 90
});

function orderStatusPriority(status) {
  const raw = String(status || '').trim();
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  if (ORDER_STATUS_PRIORITY[lower] != null) return ORDER_STATUS_PRIORITY[lower];
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && ORDER_STATUS_PRIORITY[numeric] != null) {
    return ORDER_STATUS_PRIORITY[numeric];
  }
  if (/deliver|complete|tamam/i.test(raw)) return 100;
  if (/cancel|iptal/i.test(raw)) return 90;
  if (/pick|hazir|prepar/i.test(raw)) return 25;
  return 10;
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

  // Settlement satırları komisyon/indirim taşır; TGO paketi ürün detayı taşır.
  const extraCommission = Number(extraLine.commissionAmount ?? extraLine.commission) || 0;
  const baseCommission = Number(merged.commissionAmount ?? merged.commission) || 0;
  if (extraCommission && !baseCommission) {
    merged.commissionAmount = extraLine.commissionAmount ?? extraLine.commission;
    if (extraLine.commission != null) merged.commission = extraLine.commission;
  }

  const extraSaleCommission = Number(extraLine.saleCommissionAmount) || 0;
  const baseSaleCommission = Number(merged.saleCommissionAmount) || 0;
  if (extraSaleCommission && !baseSaleCommission) {
    merged.saleCommissionAmount = extraLine.saleCommissionAmount;
  }

  const extraPortalCommission = Number(extraLine.portalCommissionAmount) || 0;
  const basePortalCommission = Number(merged.portalCommissionAmount) || 0;
  if (extraPortalCommission && !basePortalCommission) {
    merged.portalCommissionAmount = extraLine.portalCommissionAmount;
  }

  const extraDiscountCommission = Number(extraLine.discountCommissionAmount) || 0;
  const baseDiscountCommission = Number(merged.discountCommissionAmount) || 0;
  if (extraDiscountCommission && !baseDiscountCommission) {
    merged.discountCommissionAmount = extraLine.discountCommissionAmount;
  }

  const extraDiscount = Number(extraLine.lineSellerDiscount) || 0;
  const baseDiscount = Number(merged.lineSellerDiscount) || 0;
  if (extraDiscount && !baseDiscount) {
    merged.lineSellerDiscount = extraLine.lineSellerDiscount;
  }

  const extraSellerRevenue = Number(extraLine.sellerRevenue) || 0;
  const baseSellerRevenue = Number(merged.sellerRevenue) || 0;
  if (extraSellerRevenue && !baseSellerRevenue) {
    merged.sellerRevenue = extraLine.sellerRevenue;
  }

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
    for (const field of [
      'customerName',
      'customerPhone',
      'customerAddress',
      'customerIdentityNumber',
      'customerNote',
      'customerLocationMasked',
      'deliveryMethod',
      'paymentMethod',
      'tgoPackageId'
    ]) {
      if (extra[field]) merged[field] = extra[field];
    }
    if (Array.isArray(extra.lines) && extra.lines.length) {
      merged.lines = mergeOrderLines(merged.lines, extra.lines);
    }
    if (!merged.packageGrossAmount && extra.packageGrossAmount) {
      merged.packageGrossAmount = extra.packageGrossAmount;
    }
    if (!merged.packageTotalDiscount && extra.packageTotalDiscount) {
      merged.packageTotalDiscount = extra.packageTotalDiscount;
    }
    const extraProvisionNet = Number(extra.packageProvisionNet);
    if (Number.isFinite(extraProvisionNet) && extraProvisionNet !== 0) {
      merged.packageProvisionNet = (Number(merged.packageProvisionNet) || 0) + extraProvisionNet;
      merged.packageProvisionAmount = Math.round(Math.abs(merged.packageProvisionNet) * 100) / 100;
    } else {
      const extraProvision = Number(extra.packageProvisionAmount) || 0;
      if (extraProvision > 0) {
        merged.packageProvisionAmount =
          (Number(merged.packageProvisionAmount) || 0) + extraProvision;
        merged.packageProvisionNet = (Number(merged.packageProvisionNet) || 0) + extraProvision;
      }
    }
    const extraSaleCommission = Number(extra.packageSaleCommissionAmount) || 0;
    if (extraSaleCommission > (Number(merged.packageSaleCommissionAmount) || 0)) {
      merged.packageSaleCommissionAmount = extraSaleCommission;
    }
    const extraPortalCommission = Number(extra.packagePortalCommissionAmount) || 0;
    if (extraPortalCommission > (Number(merged.packagePortalCommissionAmount) || 0)) {
      merged.packagePortalCommissionAmount = extraPortalCommission;
    }
    if (extra.portalFinancials?.loaded) {
      merged.portalFinancials = extra.portalFinancials;
    }
    const extraDiscountCommission = Number(extra.packageDiscountCommissionAmount) || 0;
    if (extraDiscountCommission > (Number(merged.packageDiscountCommissionAmount) || 0)) {
      merged.packageDiscountCommissionAmount = extraDiscountCommission;
    }
    const extraDiscountSellerRevenue = Number(extra.packageDiscountSellerRevenue) || 0;
    if (extraDiscountSellerRevenue > (Number(merged.packageDiscountSellerRevenue) || 0)) {
      merged.packageDiscountSellerRevenue = extraDiscountSellerRevenue;
    }
    const extraCommission = Number(extra.packageCommissionAmount) || 0;
    if (extraCommission > (Number(merged.packageCommissionAmount) || 0)) {
      merged.packageCommissionAmount = extraCommission;
    }
    const extraSellerRevenue = Number(extra.packageSellerRevenue) || 0;
    if (extraSellerRevenue > (Number(merged.packageSellerRevenue) || 0)) {
      merged.packageSellerRevenue = extraSellerRevenue;
    }
    if (orderStatusPriority(extra.status) > orderStatusPriority(merged.status)) {
      merged.status = extra.status;
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

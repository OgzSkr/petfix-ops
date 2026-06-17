import { roundMoney } from '../utils.js';

/** Getir Çarşı sabit hakediş oranları (işletme teyidi). */
export const GETIR_FINANCIAL_RATES = Object.freeze({
  routingCommissionRate: 13.2,
  courierFeeRate: 14.4,
  withholdingRate: 1.0,
  vatRate: 20
});

function pickRawOrder(orderPackage = {}) {
  return orderPackage.rawPayload || orderPackage.raw_payload || orderPackage;
}

function pickPortalSettlement(raw = {}) {
  const nested = raw.financialMovement || raw.financial_movement
    || raw.portalSettlement || raw.portal_settlement
    || raw.financialSummary || raw.financial_summary;
  return nested && typeof nested === 'object' ? nested : {};
}

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function extractBagFee(raw = {}) {
  const packaging = raw.packagingInfo || raw.packaging_info;
  if (!packaging || typeof packaging !== 'object') return 0;
  return roundMoney(
    Number(packaging.totalPackagingPrice ?? packaging.total_packaging_price) || 0
  );
}

function extractOrderAmount(raw = {}, orderPackage = {}) {
  return roundMoney(
    pickNumber(
      raw.totalPrice,
      raw.orderAmount,
      raw.grossAmount,
      orderPackage.packageGrossAmount
    )
  );
}

function sumProductGross(products = []) {
  let gross = 0;
  let final = 0;
  for (const item of products) {
    const qty = Number(item?.count ?? item?.quantity) || 1;
    gross += (Number(item?.price ?? item?.unitPrice) || 0) * qty;
    final += Number(item?.finalTotalPrice ?? item?.totalPrice) || 0;
  }
  return { gross: roundMoney(gross), final: roundMoney(final) };
}

/**
 * Kampanya katılım = işletmenin indirim karşılığı.
 * API: totalDiscountAmount veya totalSupplierSupportAmount (d427: 250).
 */
export function extractGetirCampaignAmount(raw = {}) {
  const portal = pickPortalSettlement(raw);
  const explicit = roundMoney(
    pickNumber(
      portal.merchantCampaignAmount,
      portal.isletmeKampanyaKatilimTutari,
      raw.merchantCampaignAmount,
      raw.totalDiscountAmount
    )
  );
  if (explicit > 0) return explicit;

  const supplierSupport = roundMoney(Number(raw.totalSupplierSupportAmount) || 0);
  if (supplierSupport > 0) return supplierSupport;

  const products = raw.products || raw.items || raw.orderProducts || [];
  if (Array.isArray(products) && products.length) {
    const { gross, final } = sumProductGross(products);
    if (gross > final) return roundMoney(gross - final);
  }

  const orderAmount = extractOrderAmount(raw);
  const withSupport = roundMoney(Number(raw.totalPriceWithSupplierSupport) || 0);
  const bagFee = extractBagFee(raw);
  if (orderAmount > 0 && withSupport > 0) {
    const implied = roundMoney(orderAmount - (withSupport - bagFee));
    if (implied > 0) return implied;
  }

  return 0;
}

export function isGetirCourierDelivery(raw = {}) {
  const deliveryType = Number(raw.deliveryType ?? raw.delivery?.type);
  return deliveryType === 1;
}

/** Getir panel stopaj düzeltmesi — d427 ve Finansal Hareketler ile doğrulandı. */
export function computeGetirStopajRoutingAdjustmentDivisor() {
  const vatDivisor = 1 + GETIR_FINANCIAL_RATES.vatRate / 100;
  return vatDivisor
    * (100 / GETIR_FINANCIAL_RATES.routingCommissionRate)
    * (100 / GETIR_FINANCIAL_RATES.withholdingRate)
    * 2.844;
}

/**
 * Stopaj = %1 (KDV-hariç indirimli sepet) − komisyon düzeltmesi.
 * Panel d427: 27,74 − 0,17 = 27,57 → işletme alacağı 2.864,00.
 */
function computeWithholdingAmount(discountedBasket, routingCommission, explicitAmount = 0, explicitRate = null) {
  if (explicitAmount > 0) {
    return {
      withholdingAmount: roundMoney(Math.abs(explicitAmount)),
      withholdingRate: explicitRate ?? GETIR_FINANCIAL_RATES.withholdingRate
    };
  }

  const vatDivisor = 1 + (GETIR_FINANCIAL_RATES.vatRate / 100);
  const vatExclusiveBasket = roundMoney(discountedBasket / vatDivisor);
  const fromBasket = roundMoney(vatExclusiveBasket * (GETIR_FINANCIAL_RATES.withholdingRate / 100));
  const routingAdjustment = routingCommission > 0
    ? roundMoney(routingCommission / computeGetirStopajRoutingAdjustmentDivisor())
    : 0;

  return {
    withholdingAmount: roundMoney(Math.max(0, fromBasket - routingAdjustment)),
    withholdingRate: GETIR_FINANCIAL_RATES.withholdingRate
  };
}

function computeRuleBasedFees(discountedBasket, deliveryTypeRaw, overrides = {}) {
  const routingCommission = roundMoney(
    overrides.orderCommission
      || discountedBasket * (GETIR_FINANCIAL_RATES.routingCommissionRate / 100)
  );
  const courierFee = roundMoney(
    overrides.courierFee
      || (isGetirCourierDelivery(deliveryTypeRaw)
        ? discountedBasket * (GETIR_FINANCIAL_RATES.courierFeeRate / 100)
        : 0)
  );

  return {
    orderCommission: routingCommission,
    courierFee,
    routingCommissionRate: GETIR_FINANCIAL_RATES.routingCommissionRate,
    courierFeeRate: courierFee > 0 ? GETIR_FINANCIAL_RATES.courierFeeRate : null
  };
}

/**
 * Getir Finansal Hareketler kuralları + delivered API.
 */
export function computeGetirOrderFinancials(orderPackage = {}) {
  const raw = pickRawOrder(orderPackage);
  const portal = pickPortalSettlement(raw);

  const orderAmount = roundMoney(
    pickNumber(portal.orderAmount, portal.siparisTutari, extractOrderAmount(raw, orderPackage))
  );
  const bagFee = roundMoney(
    pickNumber(portal.bagAmount, portal.posetTutari, extractBagFee(raw))
  );
  const gross = roundMoney(
    pickNumber(
      portal.totalPriceWithPackaging,
      raw.totalPriceWithPackaging,
      orderAmount + bagFee,
      orderAmount
    )
  );

  const campaignAmount = roundMoney(
    pickNumber(
      portal.merchantCampaignAmount,
      portal.isletmeKampanyaKatilimTutari,
      extractGetirCampaignAmount(raw)
    )
  );

  let discountedBasket = roundMoney(
    pickNumber(
      portal.discountedBasketAmount,
      portal.isletmeIndirimliSepetTutari,
      raw.discountedBasketAmount
    )
  );
  if (!discountedBasket && orderAmount > 0) {
    discountedBasket = roundMoney(Math.max(0, orderAmount - campaignAmount));
  }
  if (!discountedBasket && gross > 0) {
    discountedBasket = roundMoney(Math.max(0, gross - bagFee - campaignAmount));
  }

  const apiMerchantReceivable = roundMoney(
    pickNumber(
      portal.merchantReceivable,
      portal.isletmeAlacagi,
      raw.merchantReceivable,
      raw.totalChargedAmountAfterProvisionOrRefund
    )
  );

  let orderCommission = roundMoney(
    pickNumber(
      portal.orderCompletionCommission,
      portal.siparisSonlandirmaKomisyonu,
      portal.orderRoutingCommission,
      raw.orderCompletionCommission,
      raw.orderRoutingCommission,
      raw.commissionAmount
    )
  );
  let courierFee = roundMoney(
    pickNumber(
      portal.courierServiceFee,
      portal.kuryeHizmetBedeli,
      raw.courierServiceFee,
      raw.deliveryServiceFee
    )
  );
  const fixedDistribution = roundMoney(
    pickNumber(
      portal.fixedDistributionAmount,
      portal.sabitDagitimTutari,
      raw.fixedDistributionAmount
    )
  );

  let withholdingRate = pickNumber(portal.withholdingTaxRate, portal.stopajOrani, raw.withholdingTaxRate)
    || null;
  let withholdingAmount = roundMoney(
    Math.abs(pickNumber(portal.withholdingTaxAmount, portal.stopajTutari, raw.withholdingTaxAmount))
  );

  let routingCommissionRate = portal.routingCommissionRate ?? null;
  let courierFeeRate = portal.courierFeeRate ?? null;
  let source = portal.orderAmount || portal.merchantReceivable ? 'portal' : 'delivered_api';

  if (!orderCommission && discountedBasket > 0 && !portal.orderCompletionCommission) {
    const ruled = computeRuleBasedFees(discountedBasket, raw, { courierFee });
    orderCommission = ruled.orderCommission;
    if (!courierFee) courierFee = ruled.courierFee;
    routingCommissionRate = ruled.routingCommissionRate;
    courierFeeRate = ruled.courierFeeRate;
    source = 'rules';
  }

  if (!withholdingAmount && discountedBasket > 0) {
    const withholding = computeWithholdingAmount(
      discountedBasket,
      orderCommission,
      pickNumber(portal.withholdingTaxAmount, portal.stopajTutari, raw.withholdingTaxAmount),
      withholdingRate
    );
    withholdingAmount = withholding.withholdingAmount;
    if (!withholdingRate) withholdingRate = withholding.withholdingRate;
  }

  let commissionAmount = roundMoney(orderCommission + courierFee + fixedDistribution);
  let merchantReceivable = apiMerchantReceivable;

  if (!merchantReceivable && discountedBasket > 0) {
    merchantReceivable = roundMoney(
      Math.max(0, discountedBasket + bagFee - orderCommission - courierFee - fixedDistribution - withholdingAmount)
    );
    if (source === 'delivered_api') source = 'rules';
  }

  let totalDeductions = roundMoney(
    pickNumber(portal.totalDeduction, portal.toplamKesinti, raw.totalDeductionAmount)
  );
  if (!totalDeductions && gross > 0 && merchantReceivable > 0) {
    totalDeductions = roundMoney(Math.max(0, gross - merchantReceivable));
  }
  if (!totalDeductions && merchantReceivable > 0) {
    totalDeductions = roundMoney(
      campaignAmount + orderCommission + courierFee + fixedDistribution + withholdingAmount
    );
  }

  if (!commissionAmount && totalDeductions > 0) {
    commissionAmount = roundMoney(Math.max(0, totalDeductions - campaignAmount - withholdingAmount));
  }

  const netAmount = merchantReceivable > 0 ? merchantReceivable : roundMoney(Math.max(0, gross - totalDeductions));
  const sellerDiscount = campaignAmount;
  const discountRate = gross > 0 && totalDeductions > 0
    ? roundMoney((totalDeductions / gross) * 10000) / 100
    : 0;
  const commissionRate = routingCommissionRate
    ?? (gross > 0 && orderCommission > 0
      ? roundMoney((orderCommission / gross) * 10000) / 100
      : null);

  const settlementLoaded = merchantReceivable > 0 || (discountedBasket > 0 && orderCommission > 0);

  return {
    loaded: gross > 0 && settlementLoaded,
    grossAmount: gross,
    orderAmount,
    bagFee,
    sellerDiscount,
    campaignAmount,
    discountedBasket,
    commissionAmount,
    orderCommission,
    courierFee,
    fixedDistribution,
    commissionRate,
    routingCommissionRate,
    courierFeeRate,
    withholdingRate,
    withholdingAmount,
    provisionAmount: 0,
    provisionCredit: 0,
    totalDeductions,
    netAmount,
    merchantReceivable: netAmount,
    discountRate,
    supplierSupport: roundMoney(Number(raw.totalSupplierSupportAmount) || 0),
    settlementLoaded,
    deliveryType: isGetirCourierDelivery(raw) ? 'getir' : 'merchant',
    source
  };
}

export function applyGetirFinancialsToPackage(pkg, financials) {
  if (!pkg || !financials) return pkg;

  pkg.getirFinancials = financials;
  if (financials.loaded || financials.grossAmount > 0) {
    pkg.portalFinancials = {
      loaded: financials.settlementLoaded,
      price: financials.grossAmount,
      orderAmount: financials.orderAmount,
      discount: financials.sellerDiscount,
      campaignAmount: financials.campaignAmount,
      discountedBasket: financials.discountedBasket,
      bagFee: financials.bagFee,
      commission: financials.commissionAmount,
      orderCommission: financials.orderCommission,
      commissionRate: financials.commissionRate,
      courierFee: financials.courierFee,
      fixedDistribution: financials.fixedDistribution,
      totalDeductions: financials.totalDeductions,
      withholdingRate: financials.withholdingRate,
      withholdingAmount: financials.withholdingAmount,
      partialRefund: 0,
      deliveryFee: financials.courierFee,
      provision: financials.provisionCredit > 0
        ? financials.provisionCredit
        : -financials.provisionAmount,
      netEarning: financials.netAmount
    };
    pkg.packageGrossAmount = financials.grossAmount;
    pkg.packageTotalDiscount = financials.sellerDiscount;
    pkg.packagePortalCommissionAmount = financials.commissionAmount;
    pkg.packageDeliveryFee = financials.courierFee;
  }

  return pkg;
}

export function orderPackageHasGetirFinancials(orderPackage) {
  const financials = computeGetirOrderFinancials(orderPackage);
  return financials.settlementLoaded && financials.grossAmount > 0;
}

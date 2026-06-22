import { roundMoney } from '../utils.js';

/** Getir Çarşı sabit hakediş oranları (işletme teyidi) — PetFix kural hesabı. */
export const GETIR_FINANCIAL_RATES = Object.freeze({
  routingCommissionRate: 13.2,
  courierFeeRate: 14.4,
  withholdingRate: 1.0,
  vatRate: 20
});

function pickRawOrder(orderPackage = {}) {
  return orderPackage.rawPayload || orderPackage.raw_payload || orderPackage;
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
 * Kampanya katılım — yalnızca sipariş/webhook payload alanları (Getir finans API yok).
 */
export function extractGetirCampaignAmount(raw = {}) {
  const explicit = roundMoney(
    pickNumber(
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
 */
function computeWithholdingAmount(discountedBasket, routingCommission) {
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

function computeRuleBasedFees(discountedBasket, raw = {}) {
  const orderCommission = roundMoney(
    discountedBasket * (GETIR_FINANCIAL_RATES.routingCommissionRate / 100)
  );
  const courierFee = roundMoney(
    isGetirCourierDelivery(raw)
      ? discountedBasket * (GETIR_FINANCIAL_RATES.courierFeeRate / 100)
      : 0
  );

  return {
    orderCommission,
    courierFee,
    fixedDistribution: 0,
    routingCommissionRate: GETIR_FINANCIAL_RATES.routingCommissionRate,
    courierFeeRate: courierFee > 0 ? GETIR_FINANCIAL_RATES.courierFeeRate : null
  };
}

/**
 * Getir gider özeti — PetFix kural hesabı (webhook/sipariş payload + sabit oranlar).
 * Getir teslim sonrası finans API veya panel settlement kullanılmaz.
 */
export function computeGetirOrderFinancials(orderPackage = {}) {
  const raw = pickRawOrder(orderPackage);

  const orderAmount = roundMoney(extractOrderAmount(raw, orderPackage));
  const bagFee = roundMoney(extractBagFee(raw));
  const gross = roundMoney(
    pickNumber(raw.totalPriceWithPackaging, orderAmount + bagFee, orderAmount)
  );

  const sellerDiscount = roundMoney(extractGetirCampaignAmount(raw));
  let discountedBasket = roundMoney(Math.max(0, orderAmount - sellerDiscount));
  if (!discountedBasket && gross > 0) {
    discountedBasket = roundMoney(Math.max(0, gross - bagFee - sellerDiscount));
  }

  const fees = discountedBasket > 0
    ? computeRuleBasedFees(discountedBasket, raw)
    : {
      orderCommission: 0,
      courierFee: 0,
      fixedDistribution: 0,
      routingCommissionRate: GETIR_FINANCIAL_RATES.routingCommissionRate,
      courierFeeRate: null
    };

  const withholding = discountedBasket > 0
    ? computeWithholdingAmount(discountedBasket, fees.orderCommission)
    : { withholdingAmount: 0, withholdingRate: GETIR_FINANCIAL_RATES.withholdingRate };

  const commissionAmount = roundMoney(
    fees.orderCommission + fees.courierFee + fees.fixedDistribution
  );
  const merchantReceivable = discountedBasket > 0
    ? roundMoney(
      Math.max(
        0,
        discountedBasket + bagFee - commissionAmount - withholding.withholdingAmount
      )
    )
    : 0;

  const totalDeductions = merchantReceivable > 0
    ? roundMoney(
      sellerDiscount + fees.orderCommission + fees.courierFee + fees.fixedDistribution + withholding.withholdingAmount
    )
    : 0;

  const discountRate = gross > 0 && totalDeductions > 0
    ? roundMoney((totalDeductions / gross) * 10000) / 100
    : 0;
  const commissionRate = discountedBasket > 0 && fees.orderCommission > 0
    ? fees.routingCommissionRate
    : GETIR_FINANCIAL_RATES.routingCommissionRate;

  const hasBasket = gross > 0 && (discountedBasket > 0 || orderAmount > 0);
  const settlementLoaded = hasBasket && fees.orderCommission > 0;

  return {
    loaded: hasBasket,
    grossAmount: gross,
    orderAmount,
    bagFee,
    sellerDiscount,
    campaignAmount: sellerDiscount,
    discountedBasket,
    commissionAmount,
    orderCommission: fees.orderCommission,
    courierFee: fees.courierFee,
    fixedDistribution: fees.fixedDistribution,
    commissionRate,
    routingCommissionRate: fees.routingCommissionRate,
    courierFeeRate: fees.courierFeeRate,
    withholdingRate: withholding.withholdingRate,
    withholdingAmount: withholding.withholdingAmount,
    provisionAmount: 0,
    provisionCredit: 0,
    totalDeductions,
    netAmount: merchantReceivable,
    merchantReceivable,
    discountRate,
    supplierSupport: roundMoney(Number(raw.totalSupplierSupportAmount) || 0),
    settlementLoaded,
    deliveryType: isGetirCourierDelivery(raw) ? 'getir' : 'merchant',
    source: 'rules'
  };
}

export function applyGetirFinancialsToPackage(pkg, financials) {
  if (!pkg || !financials) return pkg;

  pkg.getirFinancials = financials;
  if (financials.grossAmount > 0) {
    pkg.portalFinancials = {
      loaded: true,
      source: 'rules',
      price: financials.grossAmount,
      orderAmount: financials.orderAmount,
      discount: financials.sellerDiscount,
      campaignAmount: financials.campaignAmount,
      discountedBasket: financials.discountedBasket,
      bagFee: financials.bagFee,
      commission: financials.orderCommission,
      orderCommission: financials.orderCommission,
      commissionRate: financials.commissionRate,
      courierFee: financials.courierFee,
      courierFeeRate: financials.courierFeeRate,
      fixedDistribution: financials.fixedDistribution,
      totalDeductions: financials.totalDeductions,
      withholdingRate: financials.withholdingRate,
      withholdingAmount: financials.withholdingAmount,
      partialRefund: 0,
      deliveryFee: financials.courierFee,
      provision: 0,
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

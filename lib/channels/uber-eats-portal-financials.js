import { roundMoney } from '../utils.js';

function sumRows(rows, picker) {
  return (rows || []).reduce((sum, row) => sum + (Number(picker(row)) || 0), 0);
}

function rowsForOrder(rows, orderNumber) {
  const wanted = String(orderNumber || '').trim();
  return (rows || []).filter((row) => String(row.orderNumber || '').trim() === wanted);
}

/**
 * Trendyol Go partner portalı "Günlük Kayıtlar" satırı — settlement API satırlarından türetilir.
 *
 * KOMİSYON = Satış komisyonu − İndirim komisyonu + Provizyon satırı komisyonu
 * NET HAKEDİŞ = Fiyat − İndirim − Kısmi iade − Komisyon + Provizyon − Teslimat
 */
export function computeUberPortalFinancials(settlement, orderNumber) {
  const sales = rowsForOrder(settlement?.sales, orderNumber);
  const discounts = rowsForOrder(settlement?.discounts, orderNumber);
  const returns = rowsForOrder(settlement?.returns, orderNumber);
  const provisionNegative = rowsForOrder(settlement?.provisionNegative, orderNumber);
  const provisionPositive = rowsForOrder(settlement?.provisionPositive, orderNumber);

  if (!sales.length) {
    return { loaded: false, orderNumber: String(orderNumber || '').trim() };
  }

  const price = roundMoney(sumRows(sales, (row) => row.credit));
  const discount = roundMoney(sumRows(discounts, (row) => row.debt));
  const partialRefund = roundMoney(sumRows(returns, (row) => row.debt || row.credit));
  const deliveryFee = 0;

  const saleCommission = sumRows(sales, (row) => row.commissionAmount);
  const discountCommission = sumRows(discounts, (row) => row.commissionAmount);
  const provisionCommission = sumRows(
    [...provisionNegative, ...provisionPositive],
    (row) => row.commissionAmount
  );
  const commission = roundMoney(Math.max(0, saleCommission - discountCommission + provisionCommission));

  const provisionCredit = sumRows(provisionPositive, (row) => row.credit);
  const provisionDebt = sumRows(provisionNegative, (row) => row.debt);
  const provision = roundMoney(provisionCredit - provisionDebt);

  const commissionRate = sales.find((row) => Number(row.commissionRate) > 0)?.commissionRate ?? null;

  const netEarning = roundMoney(Math.max(
    0,
    price - discount - partialRefund - commission + provision - deliveryFee
  ));

  return {
    loaded: true,
    orderNumber: String(orderNumber || '').trim(),
    price,
    discount,
    commission,
    commissionRate,
    partialRefund,
    deliveryFee,
    provision,
    netEarning
  };
}

export function applyPortalFinancialsToPackage(pkg, portalFinancials) {
  if (!pkg || !portalFinancials?.loaded) return pkg;

  pkg.portalFinancials = portalFinancials;
  pkg.packageGrossAmount = portalFinancials.price;
  pkg.packageTotalDiscount = portalFinancials.discount;
  pkg.packagePortalCommissionAmount = portalFinancials.commission;
  pkg.packagePartialRefund = portalFinancials.partialRefund;
  pkg.packageDeliveryFee = portalFinancials.deliveryFee;
  pkg.packageProvisionAmount = Math.abs(portalFinancials.provision);
  pkg.portalProvisionCredit = portalFinancials.provision;

  return pkg;
}

export function applyPortalFinancialsToPackages(packages, settlement) {
  return (packages || []).map((pkg) => {
    const portalFinancials = computeUberPortalFinancials(settlement, pkg.orderNumber);
    return applyPortalFinancialsToPackage(pkg, portalFinancials);
  });
}

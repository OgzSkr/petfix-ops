import { mergeChannelOrderSources } from './ops-orders-bridge.js';
import {
  computeGetirOrderFinancials,
  applyGetirFinancialsToPackage,
  orderPackageHasGetirFinancials
} from './getir-portal-financials.js';
import { loginGetirApi, fetchGetirDeliveredOrders } from './getir-api.js';

function matchesOrderNumber(pkg, orderNumber) {
  const wanted = String(orderNumber || '').trim();
  if (!wanted) return false;
  return [
    pkg.orderNumber,
    pkg.shipmentPackageId,
    pkg.rawPayload?.confirmationId,
    pkg.rawPayload?.orderNumber,
    pkg.rawPayload?.id
  ].some((value) => String(value || '').trim() === wanted);
}

async function enrichGetirPackageFromApi(cfg, pkg, options = {}) {
  if (orderPackageHasGetirFinancials(pkg)) return pkg;

  const orderMs = Number(options.orderDateMs || pkg.orderDate || pkg.orderDateMs) || 0;
  const endDate = orderMs ? new Date(orderMs + 86400000) : new Date();
  const startDate = orderMs
    ? new Date(orderMs - 3 * 86400000)
    : new Date(endDate.getTime() - (Number(options.days) || 14) * 86400000);

  const session = await loginGetirApi(cfg);
  const delivered = await fetchGetirDeliveredOrders(cfg, session, {
    startDate,
    endDate,
    maxPages: 5,
    pageSize: 50
  });

  const wanted = String(pkg.orderNumber || pkg.shipmentPackageId || '').trim();
  const apiOrder = delivered.find((row) => {
    const candidates = [
      row?.confirmationId,
      row?.orderNumber,
      row?.code,
      row?.id,
      row?.orderId
    ];
    return candidates.some((value) => String(value || '').trim() === wanted);
  });

  if (!apiOrder) return pkg;

  const mergedRaw = {
    ...(pkg.rawPayload || {}),
    ...apiOrder,
    shopId: apiOrder.shopId || pkg.rawPayload?.shopId || session.shopId
  };

  const enriched = {
    ...pkg,
    rawPayload: mergedRaw,
    packageGrossAmount: Number(
      mergedRaw.totalPriceWithPackaging ?? mergedRaw.totalPrice ?? pkg.packageGrossAmount
    ) || pkg.packageGrossAmount
  };

  return applyGetirFinancialsToPackage(enriched, computeGetirOrderFinancials(enriched));
}

/**
 * Ops DB + Getir raw_payload üzerinden tek sipariş paketi (BenimPOS satışı için).
 */
export async function fetchGetirOrderPackageByNumber(cfg, orderNumber, options = {}) {
  const days = Math.min(Math.max(Number(options.days) || 14, 1), 90);
  let packages = await mergeChannelOrderSources('getir', [], {
    days,
    startDate: options.startDate,
    endDate: options.endDate
  });

  let pkg = packages.find((row) => matchesOrderNumber(row, orderNumber));

  if (!pkg && options.orderDateMs) {
    const orderMs = Number(options.orderDateMs) || 0;
    if (orderMs) {
      const windowStart = orderMs - 3 * 86400000;
      const windowEnd = orderMs + 86400000;
      packages = await mergeChannelOrderSources('getir', [], {
        startDate: new Date(windowStart).toISOString(),
        endDate: new Date(windowEnd).toISOString()
      });
      pkg = packages.find((row) => matchesOrderNumber(row, orderNumber));
    }
  }

  if (!pkg) {
    throw new Error(`Sipariş bulunamadı: ${orderNumber} (son ${days} gün)`);
  }

  pkg = await enrichGetirPackageFromApi(cfg, pkg, options);
  const financials = computeGetirOrderFinancials(pkg);
  return applyGetirFinancialsToPackage(pkg, financials);
}

export { orderPackageHasGetirFinancials };

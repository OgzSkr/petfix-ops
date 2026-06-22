import { mergeChannelOrderSources } from './ops-orders-bridge.js';
import {
  computeGetirOrderFinancials,
  applyGetirFinancialsToPackage,
  orderPackageHasGetirFinancials
} from './getir-portal-financials.js';

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

/**
 * Ops DB sipariş paketi — Getir finansal API çağrısı yok; gider özeti kural hesabı.
 */
export async function fetchGetirOrderPackageByNumber(_cfg, orderNumber, options = {}) {
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

  const financials = computeGetirOrderFinancials(pkg);
  return applyGetirFinancialsToPackage(pkg, financials);
}

export { orderPackageHasGetirFinancials };

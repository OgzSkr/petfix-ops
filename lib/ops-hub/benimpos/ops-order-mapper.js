import {
  enrichGetirOrderLinesWithWeight,
  extractGetirLines,
  findGetirProductForLine,
  resolveGetirFulfilledLineQuantity
} from '../channels/getir-normalize.js';
import { resolveTgoLinePricing } from '../../channels/tgo-line-pricing.js';
import { sumTgoLineQuantity } from '../../channels/tgo-line-pricing.js';

const OPS_TO_BUYBOX_CHANNEL = Object.freeze({
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
});

export function mapOpsChannelToBuybox(channel) {
  return OPS_TO_BUYBOX_CHANNEL[String(channel || '').trim()] || null;
}

/** BenimPOS satışına girecek adet — eksik/çıkartılan ürünler hariç. */
export function resolveBenimposSaleQuantity(line, options = {}) {
  const ordered = Number(line?.quantity) || 0;
  if (!ordered) return 0;

  if (options.channel === 'getir' && options.rawProduct) {
    return resolveGetirFulfilledLineQuantity(line, options.rawProduct, options);
  }

  if (options.channel === 'trendyol_go' && options.tgoSourceLine) {
    const qty = sumTgoLineQuantity(options.tgoSourceLine);
    if (options.usePickedQty) {
      const picked = Number(line?.picked_qty ?? line?.pickedQty);
      if (Number.isFinite(picked) && picked >= 0) {
        return Math.max(0, Math.min(qty, picked));
      }
    }
    return qty;
  }

  if (options.usePickedQty) {
    const picked = Number(line?.picked_qty ?? line?.pickedQty);
    if (Number.isFinite(picked) && picked >= 0) {
      return Math.max(0, Math.min(ordered, picked));
    }
  }

  return ordered;
}

function shouldUsePickedQtyForBenimpos(order, lines = []) {
  if (String(order?.channel || '').trim() === 'getir' && order?.picking_completed_at) {
    return true;
  }
  if (order?.picking_completed_at) return true;
  return lines.some((line) => Number(line?.picked_qty ?? line?.pickedQty) > 0);
}

function resolveTgoBenimposLinePricing(order, line, lineIndex) {
  const sourceLines = order?.raw_payload?.tgoSourceLines;
  if (!Array.isArray(sourceLines) || !sourceLines.length) {
    return {
      lineUnitPrice: line.unit_price != null ? Number(line.unit_price) : undefined,
      listUnitPrice: null,
      tgoSourceLine: null
    };
  }

  const sourceLine = sourceLines[lineIndex]
    || sourceLines.find((row) => String(row?.barcode || '').trim() === String(line.barcode || '').trim());
  if (!sourceLine) {
    return {
      lineUnitPrice: line.unit_price != null ? Number(line.unit_price) : undefined,
      listUnitPrice: null,
      tgoSourceLine: null
    };
  }

  const pricing = resolveTgoLinePricing(sourceLine);
  return {
    lineUnitPrice: pricing.unitPrice ?? pricing.paidUnitPrice,
    listUnitPrice: pricing.listUnitPrice ?? pricing.unitPrice,
    tgoSourceLine: sourceLine
  };
}

export function opsOrderToBenimposPackage(order, lines) {
  const rawPayload = order?.raw_payload || {};
  const channel = String(order?.channel || '').trim();
  const getirProducts = channel === 'getir' ? extractGetirLines(rawPayload) : [];
  const dbLines = channel === 'getir'
    ? enrichGetirOrderLinesWithWeight(lines || [], rawPayload)
    : (lines || []);
  const usePickedQty = shouldUsePickedQtyForBenimpos(order, lines);

  const mappedLines = dbLines.map((line, index) => {
    const getirProduct = channel === 'getir'
      ? findGetirProductForLine(getirProducts, line, index)
      : null;
    const tgoPricing = channel === 'trendyol_go'
      ? resolveTgoBenimposLinePricing(order, line, index)
      : { lineUnitPrice: undefined, listUnitPrice: null, tgoSourceLine: null };
    const paidUnit = tgoPricing.lineUnitPrice ?? (line.unit_price != null ? Number(line.unit_price) : undefined);
    const listUnit = tgoPricing.listUnitPrice ?? paidUnit;
    const saleQty = resolveBenimposSaleQuantity(line, {
      channel,
      rawProduct: getirProduct,
      tgoSourceLine: tgoPricing.tgoSourceLine,
      usePickedQty
    });

    return {
      barcode: line.barcode,
      productName: line.title,
      name: line.title,
      title: line.title,
      quantity: saleQty,
      lineUnitPrice: paidUnit,
      listUnitPrice: listUnit,
      price: listUnit ?? paidUnit,
      orderGrams: line.orderGrams ?? line.totalWeightGrams ?? null,
      vatRate: 20
    };
  }).filter((line) => Number(line.quantity) > 0);

  return {
    orderNumber: order.display_id || order.external_id,
    id: order.external_id,
    orderDate: order.ordered_at || order.orderDate || null,
    channel: mapOpsChannelToBuybox(channel) || channel || null,
    rawPayload,
    raw_payload: rawPayload,
    portalFinancials: rawPayload.portalFinancials || order.portalFinancials || null,
    getirFinancials: rawPayload.getirFinancials || order.getirFinancials || null,
    packageGrossAmount: rawPayload.packageGrossAmount ?? rawPayload.grossAmount ?? rawPayload.totalPrice,
    packageTotalDiscount: rawPayload.packageTotalDiscount ?? rawPayload.totalDiscount,
    packagePortalCommissionAmount: rawPayload.packagePortalCommissionAmount,
    packageProvisionAmount: rawPayload.packageProvisionAmount,
    packageProvisionNet: rawPayload.packageProvisionNet,
    packageSellerRevenue: rawPayload.packageSellerRevenue,
    packageDiscountSellerRevenue: rawPayload.packageDiscountSellerRevenue,
    lines: mappedLines
  };
}

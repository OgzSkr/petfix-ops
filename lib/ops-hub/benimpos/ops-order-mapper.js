import { enrichGetirOrderLinesWithWeight } from '../channels/getir-normalize.js';
import { resolveTgoLinePricing } from '../../channels/tgo-line-pricing.js';

const OPS_TO_BUYBOX_CHANNEL = Object.freeze({
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
});

export function mapOpsChannelToBuybox(channel) {
  return OPS_TO_BUYBOX_CHANNEL[String(channel || '').trim()] || null;
}

function resolveTgoBenimposLinePricing(order, line, lineIndex) {
  const sourceLines = order?.raw_payload?.tgoSourceLines;
  if (!Array.isArray(sourceLines) || !sourceLines.length) {
    return {
      lineUnitPrice: line.unit_price != null ? Number(line.unit_price) : undefined,
      listUnitPrice: null
    };
  }

  const sourceLine = sourceLines[lineIndex]
    || sourceLines.find((row) => String(row?.barcode || '').trim() === String(line.barcode || '').trim());
  if (!sourceLine) {
    return {
      lineUnitPrice: line.unit_price != null ? Number(line.unit_price) : undefined,
      listUnitPrice: null
    };
  }

  const pricing = resolveTgoLinePricing(sourceLine);
  return {
    lineUnitPrice: pricing.paidUnitPrice ?? pricing.unitPrice,
    listUnitPrice: pricing.unitPrice
  };
}

export function opsOrderToBenimposPackage(order, lines) {
  const dbLines = order?.channel === 'getir'
    ? enrichGetirOrderLinesWithWeight(lines || [], order?.raw_payload || {})
    : (lines || []);

  return {
    orderNumber: order.display_id || order.external_id,
    id: order.external_id,
    orderDate: order.ordered_at || order.orderDate || null,
    lines: dbLines.map((line, index) => {
      const tgoPricing = order?.channel === 'trendyol_go'
        ? resolveTgoBenimposLinePricing(order, line, index)
        : { lineUnitPrice: undefined, listUnitPrice: null };
      const paidUnit = tgoPricing.lineUnitPrice ?? (line.unit_price != null ? Number(line.unit_price) : undefined);
      const listUnit = tgoPricing.listUnitPrice ?? paidUnit;

      return {
        barcode: line.barcode,
        productName: line.title,
        name: line.title,
        title: line.title,
        quantity: Number(line.quantity),
        lineUnitPrice: paidUnit,
        listUnitPrice: listUnit,
        price: listUnit ?? paidUnit,
        orderGrams: line.orderGrams ?? line.totalWeightGrams ?? null,
        vatRate: 20
      };
    })
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { fetchYemeksepetiOrderById, isYemeksepetiOrderUuid, normalizeYemeksepetiOrder } from './yemeksepeti-orders.js';
import { extractYemeksepetiOrderItems } from '../ops-hub/channels/yemeksepeti-normalize.js';

const PLACEHOLDER_SKUS = new Set(['portal-summary']);

export function isYsPortalPlaceholderLine(line) {
  if (!line || typeof line !== 'object') return false;
  const stockCode = String(line.stockCode || line.channel_product_id || line.channelProductId || '').trim();
  if (PLACEHOLDER_SKUS.has(stockCode)) return true;
  const name = String(line.productName || line.title || '').trim().toLowerCase();
  return name.includes('portal sipariş özeti') || name.includes('portal siparis ozeti');
}

export function hasRealYemeksepetiLines(lines = []) {
  return (lines || []).some((line) => line && !isYsPortalPlaceholderLine(line));
}

export function loadYemeksepetiOrderUuidMap() {
  const map = new Map();
  const filePath = path.join(paths.root, 'data', 'ys-portal-order-map.json');
  if (!fs.existsSync(filePath)) {
    return map;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw?.pairs || raw?.orders || [];
    for (const row of rows) {
      const code = String(row.code || row.orderCode || row.orderNumber || '').trim();
      const orderId = String(row.orderId || row.uuid || row.partnerOrderId || '').trim();
      if (code && isYemeksepetiOrderUuid(orderId)) {
        map.set(code, orderId);
      }
    }
  } catch {
    /* ignore corrupt map */
  }

  return map;
}

export function resolveYemeksepetiPartnerOrderUuid({ externalId, displayId, rawPayload = {}, uuidMap = null } = {}) {
  const raw = rawPayload || {};
  const candidates = [
    raw.partnerOrderId,
    raw.partnerOrderUuid,
    raw.yemeksepetiOrder?.order_id,
    raw.order?.order_id,
    externalId,
    displayId
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (isYemeksepetiOrderUuid(value)) {
      return value;
    }
  }

  const code = String(displayId || externalId || raw.orderId || '').trim();
  const map = uuidMap || loadYemeksepetiOrderUuidMap();
  return map.get(code) || '';
}

export async function fetchYemeksepetiPackageByPartnerUuid(cfg, partnerOrderId, options = {}) {
  const uuid = String(partnerOrderId || '').trim();
  if (!uuid || !isYemeksepetiOrderUuid(uuid)) {
    return null;
  }

  const fetched = await fetchYemeksepetiOrderById(cfg, uuid, options);
  if (!fetched?.lines?.length) {
    return null;
  }

  return {
    ...fetched,
    partnerOrderId: uuid,
    ingestSource: fetched.ingestSource || 'partner_api'
  };
}

export function yemeksepetiOrderToProfitPackage(order, meta = {}) {
  if (!order || typeof order !== 'object') {
    return null;
  }

  const items = extractYemeksepetiOrderItems(order);
  if (!items.length) {
    return null;
  }

  return {
    ...normalizeYemeksepetiOrder(order),
    ...meta,
    ingestSource: meta.ingestSource || 'partner_api',
    partnerOrderId: String(order.order_id || order.id || meta.partnerOrderId || '').trim() || null
  };
}

export async function enrichYemeksepetiOrderPackages(packages, cfg, options = {}) {
  if (!cfg || !Array.isArray(packages) || !packages.length) {
    return packages || [];
  }

  const uuidMap = options.uuidMap || loadYemeksepetiOrderUuidMap();
  const enriched = [];

  for (const pkg of packages) {
    if (hasRealYemeksepetiLines(pkg.lines)) {
      enriched.push(pkg);
      continue;
    }

    const partnerOrderId = resolveYemeksepetiPartnerOrderUuid({
      externalId: pkg.shipmentPackageId || pkg.orderNumber,
      displayId: pkg.orderNumber,
      rawPayload: pkg.rawPayload || pkg.portalSummary || {},
      uuidMap
    });

    if (!partnerOrderId) {
      enriched.push(pkg);
      continue;
    }

    try {
      const full = await fetchYemeksepetiPackageByPartnerUuid(cfg, partnerOrderId, options);
      if (full?.lines?.length) {
        enriched.push({
          ...pkg,
          ...full,
          orderNumber: pkg.orderNumber || full.orderNumber,
          shipmentPackageId: pkg.shipmentPackageId || full.shipmentPackageId,
          orderDate: pkg.orderDate || full.orderDate,
          status: pkg.status || full.status,
          deliveryMethod: pkg.deliveryMethod || full.deliveryMethod,
          customerName: pkg.customerName || full.customerName,
          customerPhone: pkg.customerPhone || full.customerPhone,
          customerAddress: pkg.customerAddress || full.customerAddress,
          paymentMethod: pkg.paymentMethod || full.paymentMethod,
          ingestSource: pkg.ingestSource || full.ingestSource,
          partnerOrderId
        });
        continue;
      }
    } catch {
      /* Partner API — sıradaki paket */
    }

    enriched.push(pkg);
  }

  return enriched;
}

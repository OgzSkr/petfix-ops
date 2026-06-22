import { readDb } from '../../db/store.js';
import { ensureProductMatching } from '../../product-matching/schema.js';
import { normalizeBarcode } from '../../product-matching/normalize.js';
import { resolveChannelLine } from '../../product-matching/resolve.js';
import { insertShadowEvent } from '../db/repository.js';
import { mapOpsChannelToBuybox } from '../benimpos/ops-order-mapper.js';
import { mapMatchingToOpsStatus } from '../channels/tgo-normalize.js';
import { getOrderDetail } from './picking-service.js';

function catalogBarcode(channelProduct) {
  return (
    channelProduct?.barcode ||
    channelProduct?.channelBarcode ||
    channelProduct?.getirBarcode ||
    channelProduct?.ysBarcode ||
    null
  );
}

function isCatalogProductActive(channelProduct, buyboxChannelId) {
  if (buyboxChannelId === 'yemeksepeti') {
    return channelProduct?.ysActive !== false;
  }
  if (buyboxChannelId === 'getir') {
    return channelProduct?.getirActive !== false;
  }
  if (buyboxChannelId === 'uber-eats') {
    return channelProduct?.tgoActive !== false && channelProduct?.uberActive !== false;
  }
  return true;
}

function resolveCatalogUnitPrice(channelProduct) {
  const candidates = [
    channelProduct?.salePrice,
    channelProduct?.listPrice,
    channelProduct?.price,
    channelProduct?.channelPrice
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

export async function listChannelCatalogForOrder(pool, orderId, { search, limit = 80 } = {}) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const opsChannel = detail.order.channel;
  const buyboxChannelId = mapOpsChannelToBuybox(opsChannel);
  if (!buyboxChannelId) {
    return {
      channel: opsChannel,
      buyboxChannelId: null,
      products: []
    };
  }

  const db = await readDb();
  const pm = ensureProductMatching(db);
  const query = String(search || '').trim().toLowerCase();
  const max = Math.min(Math.max(Number(limit) || 80, 1), 200);

  let products = pm.channelProducts
    .filter((cp) => cp.channelId === buyboxChannelId)
    .filter((cp) => isCatalogProductActive(cp, buyboxChannelId))
    .map((cp) => {
      const barcode = normalizeBarcode(catalogBarcode(cp)) || null;
      return {
        channelProductId: cp.channelProductId,
        title: String(cp.channelName || cp.name || cp.channelProductId || '').trim(),
        barcode,
        unitPrice: resolveCatalogUnitPrice(cp)
      };
    })
    .filter((cp) => cp.title.length > 0);

  if (query) {
    products = products.filter((cp) => {
      const haystack = [
        cp.title,
        cp.channelProductId,
        cp.barcode || ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  products.sort((a, b) => a.title.localeCompare(b.title, 'tr-TR'));

  return {
    channel: opsChannel,
    buyboxChannelId,
    products: products.slice(0, max)
  };
}

export async function replacePickingLine(pool, orderId, lineId, { channelProductId } = {}) {
  const detail = await getOrderDetail(pool, orderId);
  if (!detail) {
    return null;
  }

  const { order, lines } = detail;
  if (!['received', 'picking'].includes(order.status)) {
    const error = new Error('Ürün değiştirme yalnızca hazırlama aşamasında yapılabilir.');
    error.statusCode = 409;
    throw error;
  }

  const line = lines.find((row) => row.id === lineId);
  if (!line) {
    const error = new Error('Sipariş satırı bulunamadı.');
    error.statusCode = 404;
    throw error;
  }

  const nextProductId = String(channelProductId || '').trim();
  if (!nextProductId) {
    const error = new Error('channelProductId zorunlu');
    error.statusCode = 400;
    throw error;
  }

  const buyboxChannelId = mapOpsChannelToBuybox(order.channel);
  if (!buyboxChannelId) {
    const error = new Error('Kanal kataloğu desteklenmiyor.');
    error.statusCode = 400;
    throw error;
  }

  const db = await readDb();
  const pm = ensureProductMatching(db);
  const catalogProduct = pm.channelProducts.find(
    (cp) => cp.channelId === buyboxChannelId && cp.channelProductId === nextProductId
  );

  if (!catalogProduct) {
    const error = new Error('Seçilen ürün bu kanalın kataloğunda yok.');
    error.statusCode = 422;
    throw error;
  }

  if (!isCatalogProductActive(catalogProduct, buyboxChannelId)) {
    const error = new Error('Seçilen ürün kanalda pasif.');
    error.statusCode = 422;
    throw error;
  }

  const barcode = normalizeBarcode(catalogBarcode(catalogProduct)) || null;
  const title = String(catalogProduct.channelName || catalogProduct.name || nextProductId).trim();
  const resolved = resolveChannelLine(db, {
    channelId: buyboxChannelId,
    channelBarcode: barcode || nextProductId,
    mode: 'hybrid'
  });
  const matchingStatus = mapMatchingToOpsStatus(resolved, 'hybrid');
  const unitPrice = line.unit_price != null
    ? Number(line.unit_price)
    : resolveCatalogUnitPrice(catalogProduct);

  await pool.query(
    `UPDATE ops_order_lines
     SET channel_product_id = $1,
         barcode = $2,
         title = $3,
         matching_status = $4,
         picked_qty = 0,
         unit_price = COALESCE($5, unit_price),
         updated_at = NOW()
     WHERE id = $6`,
    [nextProductId, barcode, title, matchingStatus, unitPrice, lineId]
  );

  await insertShadowEvent(pool, {
    branchId: order.branch_id,
    orderId,
    eventType: 'picking_line_replaced',
    payload: {
      lineId,
      lineIndex: line.line_index,
      previousChannelProductId: line.channel_product_id,
      previousTitle: line.title,
      channelProductId: nextProductId,
      title,
      barcode,
      matchingStatus,
      channel: order.channel
    }
  });

  return getOrderDetail(pool, orderId);
}

import { readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import {
  loginGetirApi,
  updateGetirPriceAndQuantity,
  fetchGetirPriceQuantityBatchResult
} from '../../channels/getir-api.js';
import { resolveGetirOpsConfig } from '../integrations/branch-config-resolver.js';

const MAX_BATCH = 1000;

/** @param {'full'|'price'|'stock'} mode */
export function buildGetirStockPayload(items = [], cfg, options = {}) {
  const mode = options.mode === 'price' || options.mode === 'stock' ? options.mode : 'full';
  const includeStock = mode === 'full' || mode === 'stock';
  const includePrice = mode === 'full' || mode === 'price';
  const shopId = String(cfg?.shopId || '').trim();

  const products = [];
  for (const item of items) {
    const getirId = String(item.channelProductId || item.getirMenuProductId || '').trim();
    if (!getirId || !shopId) continue;

    const row = { getirId, shopId };
    if (includeStock) {
      row.quantity = Math.max(0, Math.floor(Number(item.targetQuantity) || 0));
    }
    if (includePrice) {
      const price = Number(item.targetPrice);
      if (Number.isFinite(price) && price > 0) {
        row.price = price;
      }
    }
    products.push(row);
  }

  return { products };
}

export async function pushGetirStockUpdates(cfg, items = [], options = {}) {
  if (!Array.isArray(items) || !items.length) {
    return { batches: [], totalItems: 0 };
  }

  const session = await loginGetirApi(cfg);
  const batches = [];

  for (let offset = 0; offset < items.length; offset += MAX_BATCH) {
    const chunk = items.slice(offset, offset + MAX_BATCH);
    const body = buildGetirStockPayload(chunk, cfg, options);
    if (!body.products.length) continue;

    const ticket = await updateGetirPriceAndQuantity(cfg, session, body);
    const batchRequestId = String(
      ticket?.batchRequestId || ticket?.batch_request_id || ticket?.id || ''
    ).trim();

    let batchResult = null;
    if (batchRequestId) {
      try {
        batchResult = await fetchGetirPriceQuantityBatchResult(cfg, session, batchRequestId);
      } catch {
        batchResult = { batchRequestId, pending: true };
      }
    }

    batches.push({
      offset,
      count: body.products.length,
      batchRequestId: batchRequestId || null,
      ticket,
      result: batchResult
    });
  }

  return { batches, totalItems: items.length };
}

export async function writeGetirStock(items, platformEnv, options = {}) {
  const env = platformEnv || (await readEnvFile(paths.platformEnv));
  const cfg = await resolveGetirOpsConfig(null, { platformEnv: env });
  return pushGetirStockUpdates(cfg, items, options);
}

import { fetchTgoJson } from '../../channels/tgo-market-api.js';
import { isTgoOpsConfigured, loadTgoOpsConfig } from './tgo-normalize.js';

const MAX_BATCH = 1000;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function priceInventoryPath(supplierId) {
  return `/integrator/product/grocery/suppliers/${encodeURIComponent(String(supplierId || '').trim())}/products/price-and-inventory`;
}

function batchResultPath(supplierId, batchRequestId) {
  return `/integrator/product/grocery/suppliers/${encodeURIComponent(String(supplierId || '').trim())}`
    + `/products/batch-requests/${encodeURIComponent(String(batchRequestId || '').trim())}`;
}

/** @param {'full'|'price'|'stock'} mode */
export function buildTgoPriceInventoryPayload(items = [], options = {}) {
  const mode = options.mode === 'price' || options.mode === 'stock' ? options.mode : 'full';
  const includeStock = mode === 'full' || mode === 'stock';
  const includePrice = mode === 'full' || mode === 'price';

  return {
    items: items.map((item) => {
      const barcode = String(item.barcode || item.channelProductId || '').trim();
      const row = { barcode };
      if (includeStock) {
        row.quantity = Math.max(0, Math.floor(Number(item.targetQuantity) || 0));
      }
      if (includePrice) {
        const salePrice = Number(item.targetPrice);
        if (Number.isFinite(salePrice) && salePrice > 0) {
          row.salePrice = roundMoney(salePrice);
          const listPrice = Number(item.targetListPrice);
          row.listPrice = Number.isFinite(listPrice) && listPrice >= salePrice
            ? roundMoney(listPrice)
            : roundMoney(salePrice);
        }
      }
      return row;
    }).filter((row) => row.barcode)
  };
}

export function buildTgoStockPushSimulation(items = [], pushOptions = {}) {
  return {
    channel: 'trendyol_go',
    dryRun: true,
    mode: pushOptions.mode || 'full',
    payload: buildTgoPriceInventoryPayload(items, pushOptions),
    itemCount: items.length,
    note: 'FF_STOCK_PUSH kapalı — TGO price-and-inventory çağrılmadı'
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchTgoPriceInventoryBatchResult(cfg, batchRequestId) {
  return fetchTgoJson(cfg, batchResultPath(cfg.supplierId, batchRequestId));
}

async function waitForTgoBatch(cfg, batchRequestId, options = {}) {
  const attempts = Number(options.attempts) > 0 ? Number(options.attempts) : 6;
  const delayMs = Number(options.delayMs) > 0 ? Number(options.delayMs) : 1500;
  let last = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(delayMs);
    last = await fetchTgoPriceInventoryBatchResult(cfg, batchRequestId);
    if (String(last?.status || '').toUpperCase() === 'COMPLETED') {
      return last;
    }
  }

  return last;
}

function summarizeBatchFailures(batchResult) {
  const rows = Array.isArray(batchResult?.items) ? batchResult.items : [];
  const failed = rows.filter((row) => String(row?.status || '').toUpperCase() !== 'SUCCESS');
  return {
    status: batchResult?.status || null,
    failedItemCount: Number(batchResult?.failedItemCount) || failed.length,
    failures: failed.map((row) => ({
      barcode: row?.requestItem?.barcode || row?.barcode || null,
      reasons: row?.failureReasons || []
    }))
  };
}

export async function pushTgoPriceAndInventoryUpdates(cfg, items = [], options = {}) {
  if (!Array.isArray(items) || !items.length) {
    return { batches: [], totalItems: 0 };
  }

  const body = buildTgoPriceInventoryPayload(items, options);
  if (!body.items.length) {
    throw Object.assign(new Error('TGO gönderimi için geçerli ürün satırı yok'), { statusCode: 400 });
  }

  const batches = [];
  const waitForBatch = options.waitForBatch !== false;

  for (let offset = 0; offset < body.items.length; offset += MAX_BATCH) {
    const chunk = body.items.slice(offset, offset + MAX_BATCH);
    const response = await fetchTgoJson(cfg, priceInventoryPath(cfg.supplierId), {
      method: 'POST',
      body: { items: chunk }
    });

    const batchRequestId = response.batchRequestId || response.batchRequestID || null;
    let batchResult = null;
    if (batchRequestId && waitForBatch) {
      batchResult = await waitForTgoBatch(cfg, batchRequestId, options);
    }

    const summary = batchResult ? summarizeBatchFailures(batchResult) : null;
    if (summary?.failedItemCount > 0) {
      throw Object.assign(
        new Error(`TGO batch ${batchRequestId}: ${summary.failedItemCount} satır başarısız`),
        { statusCode: 502, batchRequestId, batchResult, summary }
      );
    }

    batches.push({
      offset,
      count: chunk.length,
      batchRequestId,
      batchResult,
      summary
    });
  }

  return {
    channel: 'trendyol_go',
    mode: options.mode || 'full',
    totalItems: body.items.length,
    batches
  };
}

export async function writeTgoStock(items, platformEnv, options = {}) {
  const cfg = await loadTgoOpsConfig(platformEnv);
  if (!isTgoOpsConfigured(cfg)) {
    throw Object.assign(
      new Error('TGO API kimlik bilgileri eksik — UBER_EATS_* ayarlarını kontrol edin.'),
      { statusCode: 400 }
    );
  }
  return pushTgoPriceAndInventoryUpdates(cfg, items, options);
}

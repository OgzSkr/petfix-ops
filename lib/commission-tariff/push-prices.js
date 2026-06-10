import { findByBarcode, toNumber } from '../utils.js';
import {
  fetchTrendyolBatchResult,
  readTrendyolPricingConfig,
  sleep,
  updateTrendyolPriceAndInventory
} from '../channels/trendyol-pricing.js';

const MAX_BATCH = 1000;

function roundPrice(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

export function resolveListPrice(salePrice, product = {}, item = {}) {
  const sale = roundPrice(salePrice);
  const currentList = roundPrice(product.listPrice) || roundPrice(item.currentTsf) || sale;
  const currentSale = roundPrice(product.salePrice) || roundPrice(item.currentTsf) || sale;

  if (currentList >= sale) return currentList;
  if (currentSale > sale) return currentSale;
  return roundPrice(sale * 1.01);
}

function resolveQuantity(product = {}, item = {}) {
  const stock = toNumber(item.stock ?? product.stock);
  return Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0;
}

export function buildTariffPricePushPlan(db, options = {}) {
  const tariff = db.commissionTariff;
  if (!tariff?.byBarcode) {
    throw Object.assign(new Error('Komisyon tarifesi yüklenmemiş.'), { statusCode: 400 });
  }

  const profitableOnly = options.profitableOnly !== false;
  const priceOverride = options.price !== undefined && options.price !== null && options.price !== ''
    ? roundPrice(options.price)
    : null;
  const barcodeFilter = new Set(
    Array.isArray(options.barcodes)
      ? options.barcodes.map((barcode) => String(barcode || '').trim()).filter(Boolean)
      : []
  );
  const singleBarcodeMode = barcodeFilter.size === 1 && priceOverride > 0;

  const items = [];
  const preview = [];
  const skipped = {
    notSelected: 0,
    notProfitable: 0,
    unchanged: 0,
    invalidPrice: 0,
    filteredOut: 0
  };

  for (const item of Object.values(tariff.byBarcode)) {
    const barcode = String(item.barcode || '').trim();
    if (!barcode) continue;
    if (barcodeFilter.size && !barcodeFilter.has(barcode)) {
      skipped.filteredOut += 1;
      continue;
    }
    if (!item.selectedTier && !(singleBarcodeMode && barcodeFilter.has(barcode))) {
      skipped.notSelected += 1;
      continue;
    }

    let salePrice = 0;
    if (singleBarcodeMode && barcodeFilter.has(barcode)) {
      salePrice = priceOverride;
    } else {
      salePrice = roundPrice(item.selectedPrice);
    }

    if (!salePrice) {
      skipped.invalidPrice += 1;
      continue;
    }

    const netProfit = toNumber(item.selectionProfit);
    if (profitableOnly && !singleBarcodeMode && netProfit < 0) {
      skipped.notProfitable += 1;
      continue;
    }

    const currentTsf = roundPrice(item.currentTsf);
    if (currentTsf && Math.abs(currentTsf - salePrice) < 0.005) {
      skipped.unchanged += 1;
      continue;
    }

    const product = findByBarcode(db.products, barcode) || {};
    const listPrice = resolveListPrice(salePrice, product, item);
    const quantity = resolveQuantity(product, item);

    items.push({
      barcode,
      quantity,
      salePrice,
      listPrice
    });

    preview.push({
      barcode,
      title: item.title || product.title || '',
      brand: item.brand || product.brand || '',
      selectedTier: item.selectedTier,
      currentTsf,
      salePrice,
      listPrice,
      quantity,
      selectionProfit: item.selectionProfit,
      selectionProfitRate: item.selectionProfitRate
    });
  }

  return { items, preview, skipped };
}

function applyLocalPriceUpdates(db, updates) {
  let tariffUpdated = 0;
  let productsUpdated = 0;

  for (const update of updates) {
    const tariffItem = db.commissionTariff?.byBarcode?.[update.barcode];
    if (tariffItem) {
      tariffItem.currentTsf = update.salePrice;
      tariffUpdated += 1;
    }

    const product = findByBarcode(db.products, update.barcode);
    if (product) {
      product.salePrice = update.salePrice;
      product.listPrice = update.listPrice;
      product.updatedAt = new Date().toISOString();
      productsUpdated += 1;
    }
  }

  return { tariffUpdated, productsUpdated };
}

function collectSuccessfulUpdates(batchResult, sentItems) {
  const byBarcode = new Map(sentItems.map((item) => [String(item.barcode), item]));
  const successful = [];
  const failed = [];

  for (const entry of batchResult?.items || []) {
    const barcode = String(
      entry?.requestItem?.barcode
      || entry?.requestItem?.updateRequest?.barcode
      || entry?.requestItem?.product?.barcode
      || ''
    ).trim();
    if (!barcode) continue;

    const sent = byBarcode.get(barcode);
    if (!sent) continue;

    if (String(entry.status || '').toUpperCase() === 'SUCCESS') {
      successful.push(sent);
    } else {
      failed.push({
        barcode,
        reasons: entry.failureReasons || []
      });
    }
  }

  return { successful, failed };
}

export async function pushTariffPricesToTrendyol(db, options = {}) {
  const { items, preview, skipped } = buildTariffPricePushPlan(db, options);

  if (!items.length) {
    return {
      ok: false,
      message: 'Gönderilecek fiyat değişikliği yok. Önce kademe seçin veya manuel fiyat girin.',
      sent: 0,
      preview,
      skipped
    };
  }

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      message: `${items.length} ürün Trendyol'a gönderilecek (önizleme).`,
      sent: 0,
      preview,
      skipped
    };
  }

  const config = await readTrendyolPricingConfig();
  const batches = [];
  for (let index = 0; index < items.length; index += MAX_BATCH) {
    batches.push(items.slice(index, index + MAX_BATCH));
  }

  const batchResults = [];
  for (const chunk of batches) {
    const result = await updateTrendyolPriceAndInventory(config, chunk);
    batchResults.push({ chunk, ...result });
  }

  let batchStatus = null;
  let successful = [];
  let failed = [];

  const primaryBatchId = batchResults[0]?.batchRequestId || '';
  if (primaryBatchId && options.waitForBatch !== false) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(attempt === 0 ? 1500 : 2000);
      batchStatus = await fetchTrendyolBatchResult(config, primaryBatchId);
      if (String(batchStatus.status || '').toUpperCase() === 'COMPLETED') break;
    }

    if (batchStatus) {
      const parsed = collectSuccessfulUpdates(batchStatus, items);
      successful = parsed.successful;
      failed = parsed.failed;
    }
  }

  let localUpdates = { tariffUpdated: 0, productsUpdated: 0 };
  const batchCompleted = String(batchStatus?.status || '').toUpperCase() === 'COMPLETED';

  if (successful.length) {
    localUpdates = applyLocalPriceUpdates(db, successful);
  } else if (batchCompleted && !batchStatus?.failedItemCount) {
    localUpdates = applyLocalPriceUpdates(db, items);
    successful = items;
  }

  const sent = items.length;
  const successCount = successful.length || (batchStatus ? sent - (batchStatus.failedItemCount || 0) : sent);
  const failCount = failed.length || batchStatus?.failedItemCount || 0;

  return {
    ok: true,
    message: failCount
      ? `${successCount} ürün güncellendi, ${failCount} başarısız.`
      : `${sent} ürün fiyatı Trendyol'a gönderildi.`,
    sent,
    successCount,
    failCount,
    batchRequestId: primaryBatchId,
    batchStatus: batchStatus?.status || 'SUBMITTED',
    preview: preview.slice(0, 25),
    skipped,
    failed: failed.slice(0, 20),
    localUpdates,
    batchResults: batchResults.map((entry) => ({
      batchRequestId: entry.batchRequestId,
      count: entry.chunk.length
    }))
  };
}

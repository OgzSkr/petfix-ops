import { MAPPING_STATUS } from '../../product-matching/mapping-types.js';
import { ensureProductMatching } from '../../product-matching/schema.js';
import { mapOpsChannelToBuybox } from '../benimpos/ops-order-mapper.js';

const CONFIRMED_STATUSES = new Set([
  MAPPING_STATUS.AUTO_MATCHED,
  MAPPING_STATUS.MANUAL_CONFIRMED
]);

export const STOCK_CHANNEL_CAPABILITIES = Object.freeze({
  trendyol_go: {
    livePush: true,
    driftSource: 'catalogQuantity',
    reason: null
  },
  yemeksepeti: {
    livePush: true,
    driftSource: 'none',
    reason: null
  },
  getir: {
    livePush: false,
    driftSource: 'none',
    reason: 'G3_FAIL — Getir credential yok'
  }
});

function floorStock(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return 0;
  return Math.max(0, Math.floor(qty));
}

function resolveChannelQuantity(channelProduct, capability) {
  if (!channelProduct) return null;
  if (capability?.driftSource === 'catalogQuantity') {
    const qty = channelProduct.catalogQuantity;
    return qty != null && Number.isFinite(Number(qty)) ? floorStock(qty) : null;
  }
  return null;
}

export function buildStockSyncPlan(db, opsChannel, options = {}) {
  const buyboxChannelId = mapOpsChannelToBuybox(opsChannel);
  if (!buyboxChannelId) {
    throw Object.assign(new Error(`Desteklenmeyen kanal: ${opsChannel}`), { statusCode: 400 });
  }

  const capability = STOCK_CHANNEL_CAPABILITIES[opsChannel] || {
    livePush: false,
    driftSource: 'none',
    reason: 'Bilinmeyen kanal'
  };

  const pm = ensureProductMatching(db);
  const minCoveragePercent = Number(options.minCoveragePercent ?? 0);
  const barcodeFilter = new Set(
    Array.isArray(options.barcodes)
      ? options.barcodes.map((barcode) => String(barcode || '').trim()).filter(Boolean)
      : []
  );
  const maxItems = options.maxItems != null ? Math.max(1, Number(options.maxItems) || 1) : null;
  const pushMode = options.mode === 'price' || options.mode === 'stock' ? options.mode : 'full';

  const channelProductsById = new Map(
    pm.channelProducts
      .filter((cp) => cp.channelId === buyboxChannelId)
      .map((cp) => [cp.channelProductId, cp])
  );

  const mastersById = new Map(pm.masterProducts.map((row) => [row.id, row]));

  const items = [];
  const preview = [];
  const skipped = {
    unconfirmed: 0,
    missingMaster: 0,
    missingChannelProduct: 0,
    unchanged: 0,
    filteredOut: 0,
    inactiveChannelProduct: 0,
    negativeMasterStock: 0
  };

  let confirmedMappings = 0;

  for (const mapping of pm.mappings) {
    if (mapping.channelId !== buyboxChannelId) continue;
    if (!CONFIRMED_STATUSES.has(mapping.status)) {
      skipped.unconfirmed += 1;
      continue;
    }

    confirmedMappings += 1;
    const master = mastersById.get(mapping.masterProductId);
    if (!master?.benimposBarcode) {
      skipped.missingMaster += 1;
      continue;
    }

    if (barcodeFilter.size && !barcodeFilter.has(master.benimposBarcode)) {
      skipped.filteredOut += 1;
      continue;
    }

    const channelProduct = channelProductsById.get(mapping.channelProductId);
    if (!channelProduct) {
      skipped.missingChannelProduct += 1;
      continue;
    }

    if (channelProduct.ysActive === false && pushMode !== 'price') {
      skipped.inactiveChannelProduct += 1;
      continue;
    }

    const targetQuantity = floorStock(master.stock);
    if (master.stock < 0) {
      skipped.negativeMasterStock += 1;
    }

    const channelQuantity = resolveChannelQuantity(channelProduct, capability);
    const drift = channelQuantity == null ? null : targetQuantity - channelQuantity;
    const forcePush = options.forcePush === true;

    if (!forcePush && channelQuantity != null && channelQuantity === targetQuantity) {
      skipped.unchanged += 1;
      preview.push({
        barcode: master.benimposBarcode,
        channelProductId: mapping.channelProductId,
        title: master.name || channelProduct.channelName,
        targetQuantity,
        channelQuantity,
        drift: 0,
        action: 'skip'
      });
      continue;
    }

    const row = {
      barcode: master.benimposBarcode,
      channelProductId: mapping.channelProductId,
      channelRemoteId: channelProduct.ysRemoteProductId || null,
      title: master.name || channelProduct.channelName,
      targetQuantity,
      targetPrice: Number(master.salePrice1) > 0 ? Number(master.salePrice1) : null,
      channelQuantity,
      drift,
      masterStock: master.stock,
      action: 'push'
    };

    items.push(row);
    preview.push(row);

    if (maxItems != null && items.length >= maxItems) {
      break;
    }
  }

  const channelProductCount = pm.channelProducts.filter((cp) => cp.channelId === buyboxChannelId).length;
  const coveragePercent =
    channelProductCount === 0
      ? 0
      : Number(((confirmedMappings / channelProductCount) * 100).toFixed(1));

  const driftRows = preview.filter((row) => row.drift != null && row.drift !== 0);
  const driftSummary = {
    comparedRows: preview.filter((row) => row.channelQuantity != null).length,
    driftRows: driftRows.length,
    maxAbsDrift: driftRows.reduce((max, row) => Math.max(max, Math.abs(row.drift)), 0),
    totalAbsDrift: driftRows.reduce((sum, row) => sum + Math.abs(row.drift), 0)
  };

  const blockedByCoverage = minCoveragePercent > 0 && coveragePercent < minCoveragePercent;

  return {
    opsChannel,
    buyboxChannelId,
    capability,
    summary: {
      channelProductCount,
      confirmedMappings,
      coveragePercent,
      pushCount: items.length,
      previewCount: preview.length,
      blockedByCoverage,
      minCoveragePercent
    },
    driftSummary,
    items,
    preview,
    skipped
  };
}

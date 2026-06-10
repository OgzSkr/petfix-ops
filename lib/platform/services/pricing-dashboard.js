import fs from 'node:fs/promises';
import { paths } from '../../config.js';
import { readDb } from '../../db/store.js';
import { findByBarcode, roundMoney, toNumber } from '../../utils.js';
import {
  autoTrackMap,
  calculateProfit,
  latestByBarcodeMap
} from './profitability.js';
import { getCommissionTariffMeta } from './commission-tariff.js';
import { resolveCommissionTier } from '../../commission-tariff/resolve.js';
import { analyzeTierProfit } from '../../commission-tariff/bulk-select.js';

const CRITICAL_STOCK_MAX = 10;

async function loadHistorySince(sinceMs) {
  let text = '';
  try {
    text = await fs.readFile(paths.buyboxHistory, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (sinceMs && new Date(row.recordedAt).getTime() < sinceMs) continue;
      rows.push(row);
    } catch {
      /* skip corrupt */
    }
  }
  return rows;
}

function countDailyHistoryMetrics(historyRows) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const byBarcode = new Map();
  let priceChangesToday = 0;
  let buyboxRankChangesToday = 0;

  for (const row of historyRows) {
    const day = String(row.recordedAt || '').slice(0, 10);
    if (day !== todayKey) continue;
    const barcode = String(row.barcode || '');
    if (!barcode) continue;
    if (!byBarcode.has(barcode)) byBarcode.set(barcode, []);
    byBarcode.get(barcode).push(row);
  }

  for (const rows of byBarcode.values()) {
    rows.sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const next = rows[i];
      const prevPrice = toNumber(prev.buyboxPrice);
      const nextPrice = toNumber(next.buyboxPrice);
      if (prevPrice && nextPrice && prevPrice !== nextPrice) {
        priceChangesToday += 1;
      }
      const prevOrder = Number(prev.buyboxOrder);
      const nextOrder = Number(next.buyboxOrder);
      if (Number.isFinite(prevOrder) && Number.isFinite(nextOrder) && prevOrder !== nextOrder) {
        buyboxRankChangesToday += 1;
      }
    }
  }

  return { priceChangesToday, buyboxRankChangesToday, todayKey };
}

export async function buildPricingKpis() {
  const db = await readDb();
  const products = db.products || [];
  const costs = db.costs || [];
  const tariffByBarcode = db.commissionTariff?.byBarcode || {};
  const latestSnapshots = latestByBarcodeMap(db.buyboxSnapshots || []);
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const historyRows = await loadHistorySince(sinceMs);
  const dailyHistory = countDailyHistoryMetrics(historyRows);

  const activeProducts = products.filter((product) => {
    const stock = Number(product.stock);
    const status = String(product.status || 'active').toLowerCase();
    return status !== 'inactive' && Number.isFinite(stock) && stock > 0;
  }).length;

  let criticalStockProducts = 0;
  for (const product of products) {
    const stock = Number(product.stock);
    if (Number.isFinite(stock) && stock > 0 && stock <= CRITICAL_STOCK_MAX) {
      criticalStockProducts += 1;
    }
  }

  let buyboxWon = 0;
  let buyboxLost = 0;
  let highCompetition = 0;
  let lossProducts = 0;
  let profitOpportunities = 0;
  const marginSamples = [];

  for (const snapshot of Object.values(latestSnapshots)) {
    const order = Number(snapshot.buyboxOrder);
    if (order === 1) buyboxWon += 1;
    else if (Number.isFinite(order) && order > 1) buyboxLost += 1;

    if (snapshot.hasMultipleSeller) highCompetition += 1;

    const cost = findByBarcode(costs, snapshot.barcode) || {};
    const tariffItem = tariffByBarcode[snapshot.barcode];
    let commissionRate = toNumber(cost.commissionRate);

    if (tariffItem && snapshot.buyboxPrice) {
      const resolved = resolveCommissionTier(tariffItem, snapshot.buyboxPrice);
      if (resolved?.rate) commissionRate = resolved.rate;
    }

    const profit = calculateProfit({
      buyboxPrice: snapshot.buyboxPrice,
      commissionRate,
      productCost: cost.productCost,
      desi: cost.desi
    });

    if (profit.status === 'ZARAR') lossProducts += 1;
    if (typeof profit.profitRate === 'number' && profit.status === 'KARLI') {
      marginSamples.push(profit.profitRate);
    }

    if (tariffItem && !tariffItem.selectedTier && snapshot.buyboxPrice) {
      const context = {
        buyboxPrice: snapshot.buyboxPrice,
        currentTsf: tariffItem.currentTsf
      };
      for (const tier of [4, 3, 2, 1]) {
        const cell = analyzeTierProfit(tariffItem, tier, cost, context);
        if (cell?.status === 'KAR') {
          profitOpportunities += 1;
          break;
        }
      }
    }
  }

  const avgProfitMargin = marginSamples.length
    ? roundMoney(marginSamples.reduce((sum, v) => sum + v, 0) / marginSamples.length)
    : null;

  const trackedTotal = Object.keys(latestSnapshots).length;
  const winRate = trackedTotal ? roundMoney((buyboxWon / trackedTotal) * 100) : null;

  return {
    updatedAt: new Date().toISOString(),
    commissionTariff: getCommissionTariffMeta(db),
    autoTrackCount: (db.autoTrackList || []).filter((row) => row.enabled !== false).length,
    kpis: {
      activeProducts,
      buyboxWon,
      buyboxLost,
      trackedWithBuybox: trackedTotal,
      buyboxWinRatePct: winRate,
      avgProfitMargin,
      lossProducts,
      criticalStockProducts,
      dailyPriceChanges: dailyHistory.priceChangesToday,
      dailyBuyboxChanges: dailyHistory.buyboxRankChangesToday,
      profitOpportunities,
      highCompetitionProducts: highCompetition
    }
  };
}

export function createPricingDashboardService() {
  return { buildPricingKpis };
}

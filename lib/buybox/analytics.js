import fs from 'node:fs/promises';
import path from 'node:path';
import { paths, limits } from '../config.js';
import { readDb } from '../db/store.js';
import { findByBarcode, roundMoney, toNumber } from '../utils.js';
import { calculateProfit } from '../platform/services/profitability.js';

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

async function loadHistoryRows({ sinceMs = 0, barcode = '' } = {}) {
  let text = '';

  try {
    text = await fs.readFile(paths.buyboxHistory, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const rows = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (barcode && String(row.barcode) !== String(barcode)) continue;
      if (sinceMs && new Date(row.recordedAt).getTime() < sinceMs) continue;
      rows.push(row);
    } catch {
      // skip corrupt line
    }
  }

  return rows;
}

export async function archiveOldHistory() {
  await fs.mkdir(paths.buyboxHistoryArchive, { recursive: true });

  let text = '';
  try {
    text = await fs.readFile(paths.buyboxHistory, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { archived: 0 };
    throw error;
  }

  const lines = text.split('\n').filter(Boolean);
  if (lines.length <= limits.buyboxHistoryMaxLines) {
    return { archived: 0, kept: lines.length };
  }

  const cutoff = lines.length - limits.buyboxHistoryMaxLines;
  const archiveLines = lines.slice(0, cutoff);
  const keepLines = lines.slice(cutoff);
  const archiveName = `buybox-history-${new Date().toISOString().slice(0, 10)}.jsonl`;
  const archivePath = path.join(paths.buyboxHistoryArchive, archiveName);

  await fs.appendFile(archivePath, `${archiveLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(paths.buyboxHistory, `${keepLines.join('\n')}\n`, 'utf8');

  return { archived: archiveLines.length, kept: keepLines.length, archivePath };
}

export async function buildBuyboxAnalytics({ days = limits.buyboxAnalyticsDefaultDays, sellerId = '' } = {}) {
  const sinceMs = Date.now() - Math.max(Number(days) || 14, 1) * 24 * 60 * 60 * 1000;
  const historyRows = await loadHistoryRows({ sinceMs });
  const db = await readDb();
  const ownSellerId = String(sellerId || '').trim();

  const byBarcode = new Map();
  const dailyPriceChanges = new Map();
  let winCount = 0;
  let lossCount = 0;

  for (const row of historyRows) {
    const barcode = String(row.barcode || '');
    if (!barcode) continue;

    if (!byBarcode.has(barcode)) {
      byBarcode.set(barcode, []);
    }
    byBarcode.get(barcode).push(row);

    const order = Number(row.buyboxOrder);
    if (order === 1) {
      winCount += 1;
    } else if (Number.isFinite(order)) {
      lossCount += 1;
    }

    const day = dayKey(row.recordedAt);
    if (!dailyPriceChanges.has(day)) {
      dailyPriceChanges.set(day, { changes: 0, totalDelta: 0 });
    }
  }

  for (const [, rows] of byBarcode) {
    rows.sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    for (let i = 1; i < rows.length; i += 1) {
      const prev = toNumber(rows[i - 1].buyboxPrice);
      const next = toNumber(rows[i].buyboxPrice);
      if (!prev || !next || prev === next) continue;
      const day = dayKey(rows[i].recordedAt);
      const bucket = dailyPriceChanges.get(day) || { changes: 0, totalDelta: 0 };
      bucket.changes += 1;
      bucket.totalDelta += next - prev;
      dailyPriceChanges.set(day, bucket);
    }
  }

  const lossLeaders = [];
  for (const [barcode, rows] of byBarcode) {
    const losses = rows.filter((row) => Number(row.buyboxOrder) > 1).length;
    if (!losses) continue;
    const product = findByBarcode(db.products || [], barcode) || {};
    const cost = findByBarcode(db.costs || [], barcode) || {};
    const latest = rows[rows.length - 1];
    lossLeaders.push({
      barcode,
      title: product.title || '',
      brand: product.brand || '',
      lossEvents: losses,
      totalEvents: rows.length,
      lossRate: roundMoney(losses / rows.length),
      latestBuyboxOrder: latest?.buyboxOrder ?? '',
      latestBuyboxPrice: toNumber(latest?.buyboxPrice)
    });
  }

  lossLeaders.sort((a, b) => b.lossEvents - a.lossEvents || b.lossRate - a.lossRate);

  const profitTrend = [];
  for (const [barcode, rows] of byBarcode) {
    const product = findByBarcode(db.products || [], barcode) || {};
    const cost = findByBarcode(db.costs || [], barcode) || {};
    const sorted = [...rows].sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstProfit = calculateProfit({
      buyboxPrice: first?.buyboxPrice,
      commissionRate: product.commissionRate || cost.commissionRate,
      productCost: cost.productCost,
      desi: cost.desi
    });
    const lastProfit = calculateProfit({
      buyboxPrice: last?.buyboxPrice,
      commissionRate: product.commissionRate || cost.commissionRate,
      productCost: cost.productCost,
      desi: cost.desi
    });

    if (typeof firstProfit.netProfit !== 'number' || typeof lastProfit.netProfit !== 'number') {
      continue;
    }

    const delta = roundMoney(lastProfit.netProfit - firstProfit.netProfit);
    if (delta >= 0) continue;

    profitTrend.push({
      barcode,
      title: product.title || '',
      brand: product.brand || '',
      profitDelta: delta,
      firstNetProfit: firstProfit.netProfit,
      lastNetProfit: lastProfit.netProfit,
      firstPrice: toNumber(first?.buyboxPrice),
      lastPrice: toNumber(last?.buyboxPrice)
    });
  }

  profitTrend.sort((a, b) => a.profitDelta - b.profitDelta);

  const dailyChanges = [...dailyPriceChanges.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({
      date,
      priceChanges: stats.changes,
      avgDelta: stats.changes ? roundMoney(stats.totalDelta / stats.changes) : 0
    }));

  const totalEvents = winCount + lossCount;

  return {
    updatedAt: new Date().toISOString(),
    rangeDays: Number(days) || limits.buyboxAnalyticsDefaultDays,
    winRate: totalEvents ? roundMoney(winCount / totalEvents) : 0,
    winCount,
    lossCount,
    totalEvents,
    dailyPriceChanges: dailyChanges,
    topLossProducts: lossLeaders.slice(0, 20),
    profitDeclineTrend: profitTrend.slice(0, 20),
    sellerFilter: ownSellerId || null
  };
}

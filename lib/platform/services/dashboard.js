import fs from 'node:fs/promises';
import { paths } from '../../config.js';
import { readDb, writeDb } from '../../db/store.js';
import { assessDashboardRow, summarizeDataQuality } from '../../data-quality.js';
import { findByBarcode, roundMoney, toNumber } from '../../utils.js';
import { productLinkMeta } from '../../product-thumb.js';
import {
  autoTrackMap,
  calculateProfit,
  latestByBarcodeMap,
  sheetMissingFields
} from './profitability.js';
import { getCommissionTariffMeta } from './commission-tariff.js';
import { resolveCommissionTier } from '../../commission-tariff/resolve.js';

export function emptyDashboardShell() {
  return {
    updatedAt: new Date().toISOString(),
    summary: { trackedProducts: 0, profitable: 0, loss: 0, missingData: 0, totalNetProfit: 0 },
    liveStatus: { configured: false, live: false, missingCredentials: [] },
    rows: [],
    dataQuality: { withWarnings: 0, byType: {}, total: 0 },
    commissionTariff: getCommissionTariffMeta({})
  };
}

export async function migrateAutoTrackListFromFile(db) {
  if (Array.isArray(db.autoTrackList) && db.autoTrackList.length) {
    return false;
  }

  const text = await fs.readFile(paths.autoTrackBarcodes, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return '';
    }

    throw error;
  });
  const barcodes = [...new Set(text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')))];

  if (!barcodes.length) {
    db.autoTrackList = db.autoTrackList || [];
    return false;
  }

  db.autoTrackList = barcodes.map((barcode) => ({
    barcode,
    priority: 'normal',
    enabled: true,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: ''
  }));
  db.meta.updatedAt = new Date().toISOString();
  await writeDb(db);
  return true;
}

export function createDashboardService({ buildLiveStatus }) {
  async function buildDashboard() {
    const db = await readDb();
    await migrateAutoTrackListFromFile(db);
    const latestByBarcode = latestByBarcodeMap(db.buyboxSnapshots);
    const profitByBarcode = latestByBarcodeMap(db.profitSnapshots || []);
    const autoTrackByBarcode = autoTrackMap(db.autoTrackList || []);
    const tariffByBarcode = db.commissionTariff?.byBarcode || {};
    const rows = Object.values(latestByBarcode).map((snapshot) => {
      const product = findByBarcode(db.products, snapshot.barcode) || {};
      const cost = findByBarcode(db.costs, snapshot.barcode) || {};
      const sheetProfit = profitByBarcode[snapshot.barcode];
      const autoTrack = autoTrackByBarcode[snapshot.barcode];
      const tariffItem = tariffByBarcode[snapshot.barcode];

      let commissionRate = toNumber(cost.commissionRate || product.commissionRate);
      let commissionTier = null;
      let commissionSource = 'catalog';

      if (tariffItem && snapshot.buyboxPrice) {
        const resolved = resolveCommissionTier(tariffItem, snapshot.buyboxPrice);
        if (resolved?.rate) {
          commissionRate = resolved.rate;
          commissionTier = resolved.tier;
          commissionSource = resolved.fallback ? 'tariff-fallback' : 'tariff';
        }
      }

      const profit = calculateProfit({
        buyboxPrice: snapshot.buyboxPrice,
        commissionRate,
        productCost: cost.productCost,
        desi: cost.desi
      });
      const finalProfit = tariffItem ? profit : (sheetProfit || profit);

      const linkMeta = productLinkMeta(product);

      return {
        barcode: snapshot.barcode,
        brand: product.brand || sheetProfit?.brand || '',
        title: product.title || sheetProfit?.title || '',
        productUrl: linkMeta.productUrl,
        imageUrl: linkMeta.imageUrl,
        contentId: linkMeta.contentId,
        buyboxOrder: snapshot.buyboxOrder,
        buyboxPrice: toNumber(snapshot.buyboxPrice),
        buyboxSeller: snapshot.sellerName || snapshot.merchantName || snapshot.sellerId || snapshot.merchantId || '',
        productCost: toNumber(cost.productCost),
        desi: toNumber(cost.desi),
        commissionRate: toNumber(commissionRate),
        commissionTier,
        commissionSource,
        currentTsf: toNumber(tariffItem?.currentTsf),
        netProfit: finalProfit.netProfit,
        profitRate: finalProfit.profitRate,
        status: finalProfit.status,
        missing: sheetProfit ? sheetMissingFields(sheetProfit) : profit.missing,
        riskLevel: sheetProfit?.riskLevel || '',
        recommendedAction: sheetProfit?.recommendedAction || '',
        updatedAt: snapshot.updatedAt,
        autoTracked: Boolean(autoTrack?.enabled),
        autoPriority: autoTrack?.priority || '',
        dataWarnings: []
      };
    });

    const dataQuality = summarizeDataQuality(rows, assessDashboardRow);

    rows.sort((a, b) => (a.netProfit || -Infinity) - (b.netProfit || -Infinity));

    return {
      updatedAt: new Date().toISOString(),
      liveStatus: await buildLiveStatus(),
      dataQuality,
      summary: {
        trackedProducts: rows.length,
        profitable: rows.filter((row) => row.status === 'KARLI').length,
        loss: rows.filter((row) => row.status === 'ZARAR').length,
        missingData: rows.filter((row) => row.status === 'EKSIK_VERI').length,
        totalNetProfit: roundMoney(rows.reduce((sum, row) => sum + (row.netProfit || 0), 0))
      },
      commissionTariff: getCommissionTariffMeta(db),
      rows
    };
  }

  async function dashboardRowForBarcode(barcode) {
    const dashboard = await buildDashboard();
    return dashboard.rows.find((row) => String(row.barcode) === String(barcode)) || null;
  }

  return { buildDashboard, dashboardRowForBarcode, migrateAutoTrackListFromFile };
}

import { findByBarcode } from '../utils.js';
import { calculateProfit } from '../platform/services/profitability.js';
import { checkSqliteParity } from './sqlite-store.js';

export async function checkReadParity(jsonDb, sqliteDb) {
  const base = await checkSqliteParity(jsonDb);

  const collectionKeys = [
    'profitSnapshots',
    'commissionRules',
    'alerts',
    'autoTrackList',
    'channelCosts'
  ];

  const collectionMismatches = [];
  for (const key of collectionKeys) {
    const jsonLen = Array.isArray(jsonDb[key]) ? jsonDb[key].length : 0;
    const sqliteLen = Array.isArray(sqliteDb[key]) ? sqliteDb[key].length : 0;
    if (jsonLen !== sqliteLen) {
      collectionMismatches.push({ key, json: jsonLen, sqlite: sqliteLen });
    }
  }

  return {
    ...base,
    ok: base.ok && collectionMismatches.length === 0,
    collectionMismatches
  };
}

function latestSnapshotByBarcode(snapshots, barcode) {
  return [...(snapshots || [])]
    .filter((item) => String(item.barcode) === String(barcode))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
}

function profitForBarcode(db, barcode) {
  const snapshot = latestSnapshotByBarcode(db.buyboxSnapshots, barcode);
  if (!snapshot) {
    return null;
  }

  const product = findByBarcode(db.products || [], barcode) || {};
  const cost = findByBarcode(db.costs || [], barcode) || {};

  return calculateProfit({
    buyboxPrice: snapshot.buyboxPrice,
    commissionRate: product.commissionRate || cost.commissionRate,
    productCost: cost.productCost,
    desi: cost.desi
  });
}

export function checkProfitParity(jsonDb, sqliteDb, sampleSize = 20) {
  const barcodes = [...new Set(
    [...(jsonDb.buyboxSnapshots || []), ...(sqliteDb.buyboxSnapshots || [])]
      .map((item) => String(item.barcode || ''))
      .filter(Boolean)
  )].slice(0, sampleSize);

  const mismatches = [];

  for (const barcode of barcodes) {
    const jsonProfit = profitForBarcode(jsonDb, barcode);
    const sqliteProfit = profitForBarcode(sqliteDb, barcode);

    if (!jsonProfit || !sqliteProfit) {
      continue;
    }

    const jsonNet = jsonProfit.netProfit;
    const sqliteNet = sqliteProfit.netProfit;
    const netEqual = jsonNet === sqliteNet ||
      (typeof jsonNet === 'number' && typeof sqliteNet === 'number' && Math.abs(jsonNet - sqliteNet) <= 0.001);

    if (!netEqual || jsonProfit.status !== sqliteProfit.status) {
      mismatches.push({
        barcode,
        json: {
          netProfit: jsonProfit.netProfit,
          status: jsonProfit.status,
          profitRate: jsonProfit.profitRate
        },
        sqlite: {
          netProfit: sqliteProfit.netProfit,
          status: sqliteProfit.status,
          profitRate: sqliteProfit.profitRate
        }
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    sampled: barcodes.length,
    mismatches
  };
}

export async function buildParityReport(jsonDb, sqliteDb) {
  const readParity = await checkReadParity(jsonDb, sqliteDb);
  const profitParity = checkProfitParity(jsonDb, sqliteDb, 20);

  return {
    generatedAt: new Date().toISOString(),
    ok: readParity.ok && profitParity.ok,
    readParity,
    profitParity
  };
}

#!/usr/bin/env node
/**
 * Tarifede BuyBox eksik ürünler için önce API, sonra ürün sayfası fallback.
 * Kullanım: node scripts/fetch-missing-buybox-from-pages.js [--max=76] [--delay=300]
 */
import { readDb, writeDb } from '../lib/db/store.js';
import { fetchTrendyolBuybox } from '../lib/platform/services/worker.js';
import { fetchBuyboxFromProductPageForBarcode } from '../lib/buybox/page-scrape.js';
import { ingestSnapshots } from '../lib/snapshot-ingest.js';
import { latestByBarcodeMap } from '../lib/platform/services/profitability.js';
import { productLinkMeta } from '../lib/product-thumb.js';
import { toNumber } from '../lib/utils.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const opts = { max: 200, delay: 300 };
  for (const arg of argv) {
    if (arg.startsWith('--max=')) opts.max = Number(arg.slice(6)) || opts.max;
    if (arg.startsWith('--delay=')) opts.delay = Number(arg.slice(8)) || opts.delay;
  }
  return opts;
}

function collectMissingBarcodes(db) {
  const latest = latestByBarcodeMap(db.buyboxSnapshots || []);
  const tariff = db.commissionTariff?.byBarcode || {};
  const barcodes = [];

  for (const barcode of Object.keys(tariff)) {
    if (toNumber(latest[barcode]?.buyboxPrice)) continue;
    barcodes.push(barcode);
  }

  return barcodes;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = await readDb();
  const barcodes = collectMissingBarcodes(db).slice(0, opts.max);

  const summary = {
    total: barcodes.length,
    api: 0,
    page: 0,
    noData: 0,
    noUrl: 0,
    imported: 0
  };

  console.log(`BuyBox eksik ${barcodes.length} ürün işlenecek…`);

  for (let index = 0; index < barcodes.length; index += 10) {
    const chunk = barcodes.slice(index, index + 10);
    let items = [];
    try {
      items = await fetchTrendyolBuybox(chunk);
    } catch (error) {
      console.warn('API chunk hatası:', error.message);
    }

    const byBarcode = new Map(items.map((entry) => [String(entry.barcode || ''), entry]));

    for (const barcode of chunk) {
      const apiItem = byBarcode.get(barcode);
      if (apiItem) {
        const result = ingestSnapshots(db, [apiItem]);
        summary.api += 1;
        summary.imported += result.imported;
        console.log(`[API] ${barcode} → ₺${apiItem.buyboxPrice}`);
        continue;
      }

      const product = (db.products || []).find((row) => row.barcode === barcode);
      const linkMeta = productLinkMeta(product || {});
      if (!linkMeta.productUrl) {
        summary.noUrl += 1;
        summary.noData += 1;
        console.log(`[SKIP] ${barcode} — ürün linki yok`);
        continue;
      }

      try {
        const scraped = await fetchBuyboxFromProductPageForBarcode(db, barcode);
        if (!scraped) {
          summary.noData += 1;
          console.log(`[YOK] ${barcode} — sayfada fiyat bulunamadı`);
        } else {
          const result = ingestSnapshots(db, [scraped]);
          summary.page += 1;
          summary.imported += result.imported;
          console.log(`[SAYFA] ${barcode} → ₺${scraped.buyboxPrice} (${scraped.sellerName || '—'})`);
        }
      } catch (error) {
        summary.noData += 1;
        console.log(`[HATA] ${barcode} — ${error.message}`);
      }

      if (opts.delay > 0) await sleep(opts.delay);
    }
  }

  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  await writeDb(db);

  console.log('\nÖzet:', summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * contentId olan ama productUrl eksik ürünlere Trendyol linki yazar.
 * Kullanım: node scripts/backfill-product-urls.js [--dry-run]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../lib/env.js';
import { configureDbStore, readDb, writeDb } from '../lib/db/store.js';
import { paths, resolveRuntimeConfig } from '../lib/config.js';
import { trendyolProductUrlFromProduct } from '../lib/product-thumb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  loadEnvFile(path.join(ROOT, '.env'));
  const platformEnv = await (await import('../lib/env.js')).readEnvFile(paths.platformEnv);
  const config = resolveRuntimeConfig(platformEnv);
  await configureDbStore({
    sqliteDualWrite: config.sqliteDualWrite,
    dbReadBackend: config.dbReadBackend
  });

  const db = await readDb();
  let updated = 0;

  for (const product of db.products || []) {
    if (String(product.productUrl || '').trim()) continue;

    const url = trendyolProductUrlFromProduct(product);
    if (!url) continue;

    product.productUrl = url;
    updated += 1;
    console.log(`[URL] ${product.barcode} → ${url}`);
  }

  if (updated && !dryRun) {
    db.meta = db.meta || {};
    db.meta.updatedAt = new Date().toISOString();
    await writeDb(db);
  }

  console.log(dryRun
    ? `\nDry-run: ${updated} ürün güncellenecekti.`
    : `\n${updated} ürün linki kaydedildi.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

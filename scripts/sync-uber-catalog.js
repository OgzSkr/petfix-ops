#!/usr/bin/env node
/** TGO/Uber katalog görsellerini kanal ürün havuzuna yazar. */
import { readDb, writeDb } from '../lib/db/store.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import {
  ingestUberEatsCatalogProducts,
  mergeCatalogChannelProduct,
  enrichChannelProductsFromMaster
} from '../lib/product-matching/channel-ingest/uber-eats.js';

async function main() {
  console.log('TGO katalog senkronu başlıyor…');
  const ingest = await ingestUberEatsCatalogProducts({ allListTypes: true });
  const db = await readDb();
  const pm = ensureProductMatching(db);

  enrichChannelProductsFromMaster(ingest.channelProducts, pm.masterProducts);

  const existing = new Map(
    pm.channelProducts
      .filter((cp) => cp.channelId === 'uber-eats')
      .map((cp) => [cp.channelProductId, cp])
  );

  let added = 0;
  let updated = 0;
  let withImages = 0;

  for (const incoming of ingest.channelProducts) {
    if (incoming.channelImageUrl) withImages += 1;
    if (existing.has(incoming.channelProductId)) {
      Object.assign(existing.get(incoming.channelProductId), mergeCatalogChannelProduct(existing.get(incoming.channelProductId), incoming));
      updated += 1;
    } else {
      pm.channelProducts.push(incoming);
      existing.set(incoming.channelProductId, incoming);
      added += 1;
    }
  }

  pm.meta.channelIngest = pm.meta.channelIngest || {};
  pm.meta.channelIngest['uber-eats-catalog'] = ingest.summary;
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  await writeDb(db);

  console.log(JSON.stringify({
    ok: true,
    added,
    updated,
    total: existing.size,
    catalogProducts: ingest.channelProducts.length,
    withImages,
    storeId: ingest.summary?.storeId || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';
import { resolveChannelLine, resolveMatchingModeForChannel } from '../lib/product-matching/resolve.js';
import { orderMatchesMatchingFilter } from '../lib/order-profitability.js';
import { proposeMatchForChannelProduct, proposeFuzzyMatchForChannelProduct, runAutoMatchForChannel } from '../lib/product-matching/matcher.js';
import {
  buildChannelLookupIndexes,
  findChannelProductForLine,
  findMappingForChannelLine,
  resolveMappingForChannelLine
} from '../lib/product-matching/lookup.js';
import { auditMappingsAfterMasterSync } from '../lib/product-matching/mapping-audit.js';
import { productPoolUrlForMappingStatus } from '../lib/product-matching/pool-url.js';
import { orderDetailPageUrl } from '../lib/platform/orders-url.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MATCH_METHOD } from '../lib/product-matching/mapping-types.js';
import { parseChannelNameHints } from '../lib/product-matching/normalize.js';

function makeDb() {
  const db = {};
  ensureProductMatching(db);
  return db;
}

test('resolveChannelLine legacy mode uses channel barcode', () => {
  const db = makeDb();
  const result = resolveChannelLine(db, {
    channelId: 'trendyol-marketplace',
    channelBarcode: '8690001112223',
    mode: 'legacy'
  });

  assert.equal(result.source, 'legacy');
  assert.equal(result.costBarcode, '8690001112223');
  assert.equal(result.mappingStatus, 'legacy');
});

test('resolveChannelLine hybrid falls back when mapping missing', () => {
  const db = makeDb();
  const result = resolveChannelLine(db, {
    channelId: 'uber-eats',
    channelBarcode: '8690001112223',
    mode: 'hybrid'
  });

  assert.equal(result.source, 'legacy_fallback');
  assert.equal(result.mappingStatus, 'unmapped');
  assert.equal(result.includeInSale, true);
});

test('resolveChannelLine strict blocks unmapped lines', () => {
  const db = makeDb();
  const result = resolveChannelLine(db, {
    channelId: 'trendyol-marketplace',
    channelBarcode: '8690001112223',
    mode: 'strict'
  });

  assert.equal(result.source, 'unmapped');
  assert.equal(result.includeInSale, false);
  assert.equal(result.skipReason, 'onayli_eslestirme_yok');
});

test('resolveChannelLine uses confirmed mapping master barcode', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push({
    id: 'mp-8690001112223',
    benimposBarcode: '8690001112223',
    name: 'Royal Canin 2kg',
    buyingPrice: 450
  });
  db.productMatching.mappings.push({
    id: 'map-trendyol-8690001112223',
    channelId: 'trendyol-marketplace',
    channelProductId: '8690001112223',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-8690001112223',
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: 'manual'
  });

  const result = resolveChannelLine(db, {
    channelId: 'trendyol-marketplace',
    channelBarcode: '8690001112223',
    mode: 'hybrid'
  });

  assert.equal(result.source, 'mapping');
  assert.equal(result.mappingStatus, MAPPING_STATUS.MANUAL_CONFIRMED);
  assert.equal(result.costBarcode, '8690001112223');
  assert.equal(result.master.name, 'Royal Canin 2kg');
});

test('proposeMatchForChannelProduct auto-matches exact barcode', () => {
  const masters = [{
    id: 'mp-8690001112223',
    benimposBarcode: '8690001112223',
    name: 'Test Ürün 400g'
  }];
  const proposal = proposeMatchForChannelProduct({
    channelBarcode: '8690001112223',
    channelName: 'Test Ürün 400g'
  }, masters);

  assert.equal(proposal.status, MAPPING_STATUS.AUTO_MATCHED);
  assert.equal(proposal.masterProductId, 'mp-8690001112223');
});

test('proposeMatchForChannelProduct reports missing master', () => {
  const proposal = proposeMatchForChannelProduct({
    channelBarcode: '9999999999999',
    channelName: 'Bilinmeyen'
  }, []);

  assert.equal(proposal.status, MAPPING_STATUS.MISSING_MASTER);
});

test('productPoolUrlForMappingStatus opens map modal for unmapped barcode', () => {
  const url = productPoolUrlForMappingStatus('trendyol-marketplace', '8690001112223', 'missing_master');
  assert.match(url, /tab=workbench/);
  assert.match(url, /queueMode=missing_master/);
  assert.match(url, /q=8690001112223/);
});

test('productPoolUrlForMappingStatus opens channel tab for pending mapping', () => {
  const url = productPoolUrlForMappingStatus('uber-eats', '3182550707312', 'pending');
  assert.match(url, /tab=uber-eats/);
  assert.match(url, /openMap=1/);
  assert.match(url, /q=3182550707312/);
});

test('orderDetailPageUrl deep links to channel order detail', () => {
  assert.equal(
    orderDetailPageUrl('trendyol-marketplace', '11269278264', { days: 1 }),
    '/siparisler?order=11269278264&days=1'
  );
  assert.match(orderDetailPageUrl('uber-eats', '998877'), /^\/uber-eats\?order=998877/);
});

test('findMappingForChannelLine resolves WooCommerce SKU via order barcode', () => {
  const db = makeDb();
  db.productMatching.channelProducts.push({
    id: 'cp-woocommerce-WOO-SKU-1',
    channelId: 'woocommerce',
    channelProductId: 'WOO-SKU-1',
    channelBarcode: '8690001112223',
    channelName: 'Test Ürün'
  });
  db.productMatching.masterProducts.push({
    id: 'mp-8690001112223',
    benimposBarcode: '8690001112223',
    name: 'Test Ürün',
    buyingPrice: 100
  });
  db.productMatching.mappings.push({
    id: 'map-woo-WOO-SKU-1',
    channelId: 'woocommerce',
    channelProductId: 'WOO-SKU-1',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-8690001112223',
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: 'manual'
  });

  const mapping = findMappingForChannelLine(db, 'woocommerce', '8690001112223');
  assert.equal(mapping?.channelProductId, 'WOO-SKU-1');

  const resolved = resolveMappingForChannelLine(db, 'woocommerce', '8690001112223');
  assert.equal(resolved?.master?.name, 'Test Ürün');

  const line = resolveChannelLine(db, {
    channelId: 'woocommerce',
    channelBarcode: '8690001112223',
    mode: 'hybrid'
  });
  assert.equal(line.source, 'mapping');
  assert.equal(line.costBarcode, '8690001112223');
});

test('resolveChannelLine hybrid reports pending mapping status', () => {
  const db = makeDb();
  db.productMatching.mappings.push({
    id: 'map-pending',
    channelId: 'uber-eats',
    channelProductId: '8690001112223',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-8690001112223',
    status: MAPPING_STATUS.PENDING,
    matchMethod: 'auto_barcode'
  });

  const result = resolveChannelLine(db, {
    channelId: 'uber-eats',
    channelBarcode: '8690001112223',
    mode: 'hybrid'
  });

  assert.equal(result.source, 'legacy_fallback');
  assert.equal(result.mappingStatus, MAPPING_STATUS.PENDING);
});

test('resolveMatchingModeForChannel uses channel override', () => {
  const mode = resolveMatchingModeForChannel('hybrid', 'uber-eats', {
    'uber-eats': 'strict'
  });
  assert.equal(mode, 'strict');
  assert.equal(resolveMatchingModeForChannel('hybrid', 'trendyol-marketplace', {
    'uber-eats': 'strict'
  }), 'hybrid');
});

test('auditMappingsAfterMasterSync marks orphan confirmed mappings', () => {
  const db = makeDb();
  db.productMatching.mappings.push({
    id: 'map-orphan',
    channelId: 'uber-eats',
    channelProductId: '999',
    channelBarcode: '999',
    masterProductId: 'mp-deleted',
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: 'manual'
  });

  const audit = auditMappingsAfterMasterSync(db);
  assert.equal(audit.orphanMaster, 1);
  assert.equal(audit.markedReview, 1);
  assert.equal(db.productMatching.mappings[0].status, MAPPING_STATUS.REVIEW_REQUIRED);
  assert.ok(db.productMatching.mappings[0].reasons.includes('master_silindi'));
});

test('orderMatchesMatchingFilter detects unmapped order lines', () => {
  const row = {
    lines: [
      { mappingSource: 'mapping', mappingStatus: 'manual_confirmed' },
      { mappingSource: 'unmapped', mappingStatus: 'missing_master' }
    ]
  };
  assert.equal(orderMatchesMatchingFilter(row, 'unmapped'), true);
  assert.equal(
    orderMatchesMatchingFilter({ lines: [{ mappingSource: 'mapping', mappingStatus: 'manual_confirmed' }] }, 'unmapped'),
    false
  );
});

test('findMappingForChannelLine resolves uber mapping for order barcode', () => {
  const db = makeDb();
  db.productMatching.channelProducts.push({
    channelId: 'uber-eats',
    channelProductId: 'cp-loss-1',
    channelBarcode: '8690001112223',
    channelName: 'Zarar ürün'
  });
  db.productMatching.mappings.push({
    id: 'map-loss-1',
    channelId: 'uber-eats',
    channelProductId: 'cp-loss-1',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-1',
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: MATCH_METHOD.MANUAL
  });

  const indexes = buildChannelLookupIndexes(db, 'uber-eats');
  const mapping = findMappingForChannelLine(db, 'uber-eats', '8690001112223', indexes);
  assert.equal(mapping?.channelProductId, 'cp-loss-1');

  const idx = db.productMatching.mappings.findIndex(
    (row) => row.channelId === 'uber-eats' && row.channelProductId === mapping.channelProductId
  );
  db.productMatching.mappings.splice(idx, 1);
  assert.equal(db.productMatching.mappings.length, 0);
});

test('buildChannelLookupIndexes finds WooCommerce mapping by SKU', () => {
  const db = makeDb();
  db.productMatching.channelProducts.push({
    channelId: 'woocommerce',
    channelProductId: 'SKU-ABC',
    channelBarcode: '8690001112223',
    channelName: 'Royal Canin 2kg'
  });
  db.productMatching.mappings.push({
    id: 'map-wc-sku',
    channelId: 'woocommerce',
    channelProductId: 'SKU-ABC',
    channelBarcode: '8690001112223',
    masterProductId: 'mp-1',
    status: MAPPING_STATUS.MANUAL_CONFIRMED,
    matchMethod: 'manual'
  });

  const indexes = buildChannelLookupIndexes(db, 'woocommerce');
  const bySku = findMappingForChannelLine(db, 'woocommerce', 'SKU-ABC', indexes);
  assert.equal(bySku?.channelProductId, 'SKU-ABC');
  assert.equal(findChannelProductForLine(db, 'woocommerce', 'SKU-ABC', indexes)?.channelProductId, 'SKU-ABC');
});

test('proposeFuzzyMatchForChannelProduct suggests pending match by name', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push({
    id: 'mp-1',
    name: 'Royal Canin Kedi Maması 2kg',
    benimposBarcode: '8690001112223'
  });

  const fuzzy = proposeFuzzyMatchForChannelProduct({
    channelName: 'Royal Canin Kedi Mamasi 2 kg',
    channelBarcode: '999-no-match',
    channelProductId: 'wc-1'
  }, db.productMatching.masterProducts);

  assert.ok(fuzzy);
  assert.equal(fuzzy.status, MAPPING_STATUS.PENDING);
  assert.equal(fuzzy.matchMethod, MATCH_METHOD.AUTO_FUZZY);
  assert.equal(fuzzy.masterProductId, 'mp-1');
});

test('runAutoMatchForChannel creates fuzzy proposals when barcode missing', () => {
  const db = makeDb();
  db.productMatching.masterProducts.push({
    id: 'mp-1',
    name: 'Pro Plan Yetişkin Kedi 3kg',
    benimposBarcode: '8690009998887'
  });
  db.productMatching.channelProducts.push({
    channelId: 'woocommerce',
    channelProductId: 'wc-fuzzy-1',
    channelBarcode: '000-no-master',
    channelName: 'Pro Plan Yetiskin Kedi 3 kg'
  });

  const summary = runAutoMatchForChannel(db, 'woocommerce');
  assert.equal(summary.fuzzyProposed, 1);
  assert.equal(summary.pending, 1);

  const mapping = db.productMatching.mappings.find((m) => m.channelProductId === 'wc-fuzzy-1');
  assert.equal(mapping.status, MAPPING_STATUS.PENDING);
  assert.equal(mapping.matchMethod, MATCH_METHOD.AUTO_FUZZY);
});

test('parseChannelNameHints extracts gramaj varyant and marka from channel title', () => {
  const hints = parseChannelNameHints("8in1 8 İn 1 Delights Duck Spirals Ördekli Burgu Köpek Ödülü 6'lı, 60 Gr");
  const fields = new Set(hints.map((h) => h.field));
  assert.ok(fields.has('gramaj'));
  assert.ok(fields.has('varyant'));
  assert.ok(fields.has('marka'));
  const gramaj = hints.find((h) => h.field === 'gramaj');
  assert.equal(gramaj.value, '60 g');
  const varyant = hints.find((h) => h.field === 'varyant');
  assert.equal(varyant.value, '8in1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTgoGroceryPackage,
  mapTgoPackageStatus,
  mapTgoDeliveryMode
} from '../lib/ops-hub/channels/tgo-normalize.js';
import { TGO_GROCERY_PACKAGE_FIXTURE } from '../lib/ops-hub/fixtures/tgo-grocery-package.fixture.js';

test('mapTgoPackageStatus maps Delivered to completed', () => {
  assert.equal(mapTgoPackageStatus('Delivered'), 'completed');
  assert.equal(mapTgoPackageStatus('Picking'), 'picking');
});

test('mapTgoDeliveryMode maps GO to platform_courier', () => {
  assert.equal(mapTgoDeliveryMode('GO'), 'platform_courier');
});

test('normalizeTgoGroceryPackage uses package.id as externalId', async () => {
  const db = { productMatching: { mappings: [], channelProducts: { 'uber-eats': {} } } };
  const result = await normalizeTgoGroceryPackage(TGO_GROCERY_PACKAGE_FIXTURE, {
    db,
    shadowMode: true,
    platformEnv: { PRODUCT_MATCHING_MODE: 'legacy' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.channel, 'trendyol_go');
  assert.equal(result.order.externalId, '1000255008876');
  assert.equal(result.order.displayId, '11308158497');
  assert.equal(result.order.deliveryMode, 'platform_courier');
  assert.equal(result.order.lines.length, 1);
  assert.equal(result.order.lines[0].barcode, '3182550737593');
  assert.equal(result.order.lines[0].unitPrice, 1625);
});

test('normalizeTgoGroceryPackage keeps line price in TL (no /100)', async () => {
  const db = { productMatching: { mappings: [], channelProducts: { 'uber-eats': {} } } };
  const result = await normalizeTgoGroceryPackage({
    id: 'pkg-1',
    orderNumber: '11319912956',
    packageStatus: 'Picking',
    deliveryModel: 'GO',
    grossAmount: 1317.88,
    lines: [{
      price: 600,
      barcode: '8690001112223',
      product: { productSaleName: 'Kedi Maması', brandName: 'Proplan' },
      items: [{ id: '1', isCancelled: false }]
    }]
  }, {
    db,
    shadowMode: true,
    platformEnv: { PRODUCT_MATCHING_MODE: 'legacy' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.lines[0].unitPrice, 600);
});

test('normalizeTgoGroceryPackage keeps price as unit price for multi-item rows', async () => {
  const db = { productMatching: { mappings: [], channelProducts: { 'uber-eats': {} } } };
  const result = await normalizeTgoGroceryPackage({
    id: 'pkg-multi',
    orderNumber: '11339327359',
    packageStatus: 'Picking',
    deliveryModel: 'GO',
    grossAmount: 2505,
    lines: [{
      price: 131,
      barcode: '6927749871088',
      product: { productSaleName: 'Tavuklu Sıvı Kedi Ödülü 5x14 Gr' },
      items: [
        { id: '1', isCancelled: false },
        { id: '2', isCancelled: false },
        { id: '3', isCancelled: false },
        { id: '4', isCancelled: false },
        { id: '5', isCancelled: false }
      ]
    }]
  }, {
    db,
    shadowMode: true,
    platformEnv: { PRODUCT_MATCHING_MODE: 'legacy' }
  });

  assert.equal(result.order.lines[0].quantity, 5);
  assert.equal(result.order.lines[0].unitPrice, 131);
});

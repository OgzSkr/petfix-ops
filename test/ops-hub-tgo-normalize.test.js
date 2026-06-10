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
});

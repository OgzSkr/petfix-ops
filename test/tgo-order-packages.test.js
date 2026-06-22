import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapTgoPackageStatus,
  tgoGroceryPackageToProfitPackage
} from '../lib/channels/tgo-order-packages.js';
import { TGO_ACTIVE_PACKAGE_FIXTURE } from '../lib/ops-hub/fixtures/tgo-grocery-package.fixture.js';

test('mapTgoPackageStatus maps active grocery statuses', () => {
  assert.equal(mapTgoPackageStatus('Picking'), 'Hazırlanıyor');
  assert.equal(mapTgoPackageStatus('Delivered'), 'Teslim edildi');
});

test('tgoGroceryPackageToProfitPackage converts active TGO package', async () => {
  const pkg = await tgoGroceryPackageToProfitPackage(TGO_ACTIVE_PACKAGE_FIXTURE, null);

  assert.equal(pkg.orderNumber, '11308159999');
  assert.equal(pkg.status, 'Hazırlanıyor');
  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].barcode, '3182550737593');
  assert.equal(pkg.customerName, 'Test Musteri');
  assert.equal(pkg.ingestSource, 'partner_api');
});

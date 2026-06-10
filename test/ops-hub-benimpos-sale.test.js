import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapOpsChannelToBuybox,
  opsOrderToBenimposPackage
} from '../lib/ops-hub/benimpos/ops-order-mapper.js';
import {
  buildBenimposSaleSimulation,
  isBenimposSaleWriteEnabled
} from '../lib/ops-hub/benimpos/sale-outbox.js';

test('mapOpsChannelToBuybox maps ops channels to buybox ids', () => {
  assert.equal(mapOpsChannelToBuybox('trendyol_go'), 'uber-eats');
  assert.equal(mapOpsChannelToBuybox('yemeksepeti'), 'yemeksepeti');
  assert.equal(mapOpsChannelToBuybox('getir'), 'getir');
  assert.equal(mapOpsChannelToBuybox('unknown'), null);
});

test('opsOrderToBenimposPackage maps lines for sales-create', () => {
  const pkg = opsOrderToBenimposPackage(
    { display_id: 'TGO-99', external_id: 'ext-99' },
    [
      {
        barcode: '8690000000001',
        title: 'Su 1L',
        quantity: 2,
        unit_price: 12.5
      }
    ]
  );

  assert.equal(pkg.orderNumber, 'TGO-99');
  assert.equal(pkg.id, 'ext-99');
  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].barcode, '8690000000001');
  assert.equal(pkg.lines[0].quantity, 2);
  assert.equal(pkg.lines[0].lineUnitPrice, 12.5);
});

test('buildBenimposSaleSimulation marks dry run', () => {
  const sim = buildBenimposSaleSimulation(
    { channel: 'trendyol_go', display_id: 'TGO-1' },
    { payload: { data: {} }, saleLines: [{ saleBarcode: 'x' }], skippedLines: [] }
  );
  assert.equal(sim.dryRun, true);
  assert.equal(sim.saleLineCount, 1);
  assert.match(sim.note, /FF_BENIMPOS_SALE_WRITE/);
});

test('isBenimposSaleWriteEnabled reads env flag', () => {
  assert.equal(isBenimposSaleWriteEnabled({ FF_BENIMPOS_SALE_WRITE: 'false' }), false);
  assert.equal(isBenimposSaleWriteEnabled({ FF_BENIMPOS_SALE_WRITE: 'true' }), true);
});

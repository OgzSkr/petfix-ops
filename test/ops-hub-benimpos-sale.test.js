import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { buildChannelSaleFromOrder } from '../lib/benimpos/sales-create.js';
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

test('opsOrderToBenimposPackage uses TGO list unit for BenimPOS terazi lines', () => {
  const pkg = opsOrderToBenimposPackage(
    {
      channel: 'trendyol_go',
      display_id: '11343529986',
      external_id: 'ext-tgo',
      raw_payload: {
        tgoSourceLines: [{
          barcode: 'PTFX027',
          price: 300,
          amount: 300,
          items: [{ id: '1' }, { id: '2' }]
        }]
      }
    },
    [{
      barcode: 'PTFX027',
      title: 'Somonlu Kısırlaştırılmış Kedi Maması Açık 500 Gr',
      quantity: 2,
      unit_price: 150
    }]
  );

  assert.equal(pkg.lines[0].lineUnitPrice, 150);
  assert.equal(pkg.lines[0].listUnitPrice, 300);
  assert.equal(pkg.lines[0].price, 300);
});

test('buildChannelSaleFromOrder allowEmpty returns blocked preview instead of throwing', () => {
  const db = { products: [] };
  ensureProductMatching(db);
  db.productMatching.channelProducts.push({
    channelId: 'getir',
    channelProductId: 'sku-x',
    channelBarcode: null,
    channelName: 'Eslesmemis'
  });

  const orderPackage = opsOrderToBenimposPackage(
    { display_id: 'G-1', external_id: 'ext-1' },
    [{ barcode: null, title: 'Eslesmemis', quantity: 1, unit_price: 10, matching_status: 'unmapped' }]
  );

  const built = buildChannelSaleFromOrder(orderPackage, db, {
    channelId: 'getir',
    salePolicy: 'sale-strict',
    allowEmpty: true
  });

  assert.equal(built.saleBlocked, true);
  assert.equal(built.saleLines.length, 0);
  assert.ok(built.skippedLines.length >= 1);
  assert.equal(built.payload, null);
});

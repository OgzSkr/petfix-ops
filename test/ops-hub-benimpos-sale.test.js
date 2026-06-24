import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { buildChannelSaleFromOrder } from '../lib/benimpos/sales-create.js';
import {
  mapOpsChannelToBuybox,
  opsOrderToBenimposPackage,
  resolveBenimposSaleQuantity
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

  assert.equal(pkg.lines[0].lineUnitPrice, 300);
  assert.equal(pkg.lines[0].listUnitPrice, 300);
  assert.equal(pkg.lines[0].price, 300);
});

test('opsOrderToBenimposPackage forwards Getir raw_payload for financials', () => {
  const pkg = opsOrderToBenimposPackage(
    {
      channel: 'getir',
      display_id: 'G-42',
      external_id: 'ext-g',
      raw_payload: {
        totalPrice: 250,
        grossAmount: 250,
        packagingInfo: { totalPackagingPrice: 5 }
      }
    },
    [{ barcode: '869', title: 'Mama', quantity: 1, unit_price: 250 }]
  );

  assert.equal(pkg.rawPayload.totalPrice, 250);
  assert.equal(pkg.channel, 'getir');
  assert.equal(pkg.lines.length, 1);
});

test('resolveBenimposSaleQuantity excludes removed Getir lines via finalCount', () => {
  assert.equal(resolveBenimposSaleQuantity(
    { quantity: 1, picked_qty: 0 },
    { channel: 'getir', rawProduct: { finalCount: 0 }, usePickedQty: true }
  ), 0);
  assert.equal(resolveBenimposSaleQuantity(
    { quantity: 2, picked_qty: 0 },
    { channel: 'getir', rawProduct: { finalCount: 1 }, usePickedQty: true }
  ), 1);
});

test('opsOrderToBenimposPackage omits zero-qty Getir lines from BenimPOS package', () => {
  const pkg = opsOrderToBenimposPackage(
    {
      channel: 'getir',
      display_id: 'n257',
      external_id: 'ext-n257',
      picking_completed_at: '2026-06-23T09:00:00.000Z',
      raw_payload: {
        products: [
          { count: 1, price: 100, finalCount: 1, catalogProductId: 'a' },
          { count: 1, price: 50, finalCount: 0, catalogProductId: 'b' }
        ]
      }
    },
    [
      { quantity: 1, unit_price: 100, channel_product_id: 'a', barcode: '111', title: 'A' },
      { quantity: 1, unit_price: 50, channel_product_id: 'b', barcode: '222', title: 'B', picked_qty: 0 }
    ]
  );

  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].barcode, '111');
});

test('opsOrderToBenimposPackage omits removed Getir line matched by barcode (n257)', () => {
  const pkg = opsOrderToBenimposPackage(
    {
      channel: 'getir',
      display_id: 'n257',
      external_id: 'ext-n257',
      picking_completed_at: '2026-06-23T07:33:00.000Z',
      raw_payload: {
        totalPrice: 596,
        totalPriceWithPackaging: 597,
        packagingInfo: { totalPackagingPrice: 1 },
        products: [
          { count: 1, price: 205, finalCount: 1, finalTotalPrice: 205, barcode: '8606014102338' },
          { count: 1, price: 225, finalCount: 0, finalTotalPrice: 0, barcode: '8698595910358' },
          { count: 1, price: 205, finalCount: 1, finalTotalPrice: 205, barcode: '8606014102284' },
          { count: 1, price: 185, finalCount: 1, finalTotalPrice: 185, barcode: '8698595910396' }
        ]
      }
    },
    [
      { quantity: 1, unit_price: 205, barcode: '8606014102338', title: 'N&D Pumpkin' },
      { quantity: 1, unit_price: 225, barcode: '8698595910358', title: 'Freshy Burgu', picked_qty: 0 },
      { quantity: 1, unit_price: 205, barcode: '8606014102284', title: 'N&D Prime' },
      { quantity: 1, unit_price: 185, barcode: '8698595910396', title: 'Freshy Ördek' }
    ]
  );

  assert.equal(pkg.lines.length, 3);
  assert.ok(!pkg.lines.some((line) => line.barcode === '8698595910358'));
  assert.equal(
    pkg.lines.reduce((sum, line) => sum + line.quantity * line.lineUnitPrice, 0),
    595
  );
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

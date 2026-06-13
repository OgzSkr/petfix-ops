import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeOrderPackages,
  packageFromYemeksepetiOpsRow,
  packageFromUberOpsRow
} from '../lib/channels/ops-orders-bridge.js';

test('dedupeOrderPackages keeps first occurrence by shipmentPackageId', () => {
  const rows = dedupeOrderPackages([
    { shipmentPackageId: 'a', orderNumber: '1' },
    { shipmentPackageId: 'a', orderNumber: '1-b' },
    { shipmentPackageId: 'b', orderNumber: '2' }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].orderNumber, '1');
});

test('packageFromYemeksepetiOpsRow uses yemeksepetiOrder payload when present', () => {
  const pkg = packageFromYemeksepetiOpsRow({
    external_id: 'ys-1',
    display_id: 'YS-1',
    ingest_source: 'webhook',
    raw_payload: {
      portalSummary: { orderId: 'ys-1', subtotal: 99 },
      yemeksepetiOrder: {
        order_id: 'ys-1',
        order_code: 'YS-1',
        status: 'RECEIVED',
        sys: { created_at: '2026-06-10T12:00:00Z' },
        items: [{
          sku: 'SKU1',
          barcode: ['8690001112223'],
          name: 'Test',
          pricing: { quantity: 1, unit_price: 40 }
        }]
      }
    },
    lines: []
  });
  assert.equal(pkg.shipmentPackageId, 'ys-1');
  assert.equal(pkg.ingestSource, 'webhook');
  assert.equal(pkg.lines[0].barcode, '8690001112223');
});

test('packageFromYemeksepetiOpsRow prefers real db lines over portal summary', () => {
  const pkg = packageFromYemeksepetiOpsRow({
    external_id: 'jk2w-1',
    display_id: 'jk2w-1',
    ingest_source: 'portal_api',
    ordered_at: '2026-06-10T12:00:00Z',
    status: 'completed',
    raw_payload: {
      portalSummary: { orderId: 'jk2w-1', subtotal: 120, orderStatus: 'PICKED_UP' }
    },
    lines: [{
      barcode: '8690001112223',
      title: 'Kedi Maması',
      quantity: 2,
      unit_price: 60,
      channel_product_id: '2662ZF'
    }]
  });
  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].productName, 'Kedi Maması');
});

test('packageFromUberOpsRow carries benimpos sales code from ops row', () => {
  const pkg = packageFromUberOpsRow({
    external_id: 'pkg-bp',
    display_id: 'ORD-9',
    channel_status: 'Completed',
    ordered_at: '2026-06-13T15:10:00Z',
    ingest_source: 'webhook',
    benimpos_sales_code: 'S-42',
    raw_payload: {},
    lines: []
  });
  assert.equal(pkg.benimposSalesCode, 'S-42');
});

test('packageFromUberOpsRow rescales legacy TGO unit_price stored as price/100', () => {
  const pkg = packageFromUberOpsRow({
    external_id: 'pkg-legacy',
    display_id: '11319912956',
    channel_status: 'Picking',
    ordered_at: '2026-06-13T15:10:00Z',
    ingest_source: 'webhook',
    raw_payload: { grossAmount: 1200 },
    lines: [{
      barcode: '8690637037428',
      title: 'Kedi Maması',
      quantity: 2,
      unit_price: 6,
      channel_product_id: 'sku-a'
    }]
  });
  assert.equal(pkg.packageGrossAmount, 1200);
  assert.equal(pkg.lines[0].lineUnitPrice, 600);
  assert.equal(pkg.lines[0].quantity, 2);
});

test('packageFromUberOpsRow builds profit lines from ops_order_lines json', () => {
  const pkg = packageFromUberOpsRow({
    external_id: 'pkg-99',
    display_id: '10654321001',
    channel_status: 'Picking',
    ordered_at: '2026-06-10T12:00:00Z',
    ingest_source: 'webhook',
    raw_payload: { grossAmount: 120 },
    lines: [{
      barcode: '8690637037428',
      title: 'Kedi Maması',
      quantity: 2,
      unit_price: 60,
      channel_product_id: 'sku-a'
    }]
  });
  assert.equal(pkg.shipmentPackageId, 'pkg-99');
  assert.equal(pkg.packageGrossAmount, 120);
  assert.equal(pkg.lines.length, 1);
  assert.equal(pkg.lines[0].productName, 'Kedi Maması');
});

test('packageFromUberOpsRow prefers raw Trendyol customer name over legacy asterisk mask', () => {
  const pkg = packageFromUberOpsRow({
    external_id: 'pkg-name',
    display_id: '11320477240',
    channel_status: 'Delivered',
    ordered_at: '2026-06-13T15:10:00Z',
    ingest_source: 'webhook',
    customer_masked: { name: 'me***em', phone: '53******67' },
    raw_payload: {
      grossAmount: 500,
      customer: { name: 'Merve v.' }
    },
    lines: [{
      barcode: '8690637037428',
      title: 'Ürün',
      quantity: 1,
      unit_price: 500,
      channel_product_id: 'sku-a'
    }]
  });
  assert.equal(pkg.customerName, 'Merve v.');
});

test('packageFromUberOpsRow ignores legacy asterisk-masked customer names', () => {
  const pkg = packageFromUberOpsRow({
    external_id: 'pkg-legacy-name',
    display_id: '11320477241',
    channel_status: 'Delivered',
    ordered_at: '2026-06-13T15:10:00Z',
    ingest_source: 'webhook',
    customer_masked: { name: 'Y**u' },
    raw_payload: { grossAmount: 500 },
    lines: [{
      barcode: '8690637037428',
      title: 'Ürün',
      quantity: 1,
      unit_price: 500,
      channel_product_id: 'sku-a'
    }]
  });
  assert.equal(pkg.customerName, null);
});

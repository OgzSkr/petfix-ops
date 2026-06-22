import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findLineForBarcode,
  computePickingProgress,
  normalizeScanBarcode,
  canDepotPickOrder
} from '../lib/ops-hub/picking/picking-service.js';

const LINES = [
  {
    id: '1',
    line_index: 0,
    channel_product_id: 'sku-a',
    barcode: '8690001112223',
    matching_status: 'matched',
    quantity: 2,
    picked_qty: 2
  },
  {
    id: '2',
    line_index: 1,
    channel_product_id: 'sku-b',
    barcode: '8690003334445',
    matching_status: 'blocked',
    quantity: 1,
    picked_qty: 0
  },
  {
    id: '3',
    line_index: 2,
    channel_product_id: '8690005556667',
    barcode: '8690005556667',
    matching_status: 'unmapped',
    quantity: 1,
    picked_qty: 1
  }
];

test('normalizeScanBarcode trims input', () => {
  assert.equal(normalizeScanBarcode(' 8690001112223 '), '8690001112223');
});

test('findLineForBarcode matches by barcode', () => {
  const line = findLineForBarcode(LINES, '8690001112223');
  assert.equal(line.line_index, 0);
});

test('computePickingProgress ignores blocked lines', () => {
  const progress = computePickingProgress(LINES);
  assert.equal(progress.actionableLines, 2);
  assert.equal(progress.isComplete, true);
});

test('computePickingProgress incomplete when qty missing', () => {
  const progress = computePickingProgress([
    { matching_status: 'matched', quantity: 2, picked_qty: 1 }
  ]);
  assert.equal(progress.isComplete, false);
});

test('canDepotPickOrder allows channel-picked orders before depot completes', () => {
  assert.equal(
    canDepotPickOrder({
      status: 'picked',
      picking_completed_at: null
    }),
    true
  );
});

test('canDepotPickOrder rejects when depot already completed', () => {
  assert.equal(
    canDepotPickOrder({
      status: 'picked',
      picking_completed_at: '2026-06-22T12:00:00.000Z'
    }),
    false
  );
});

test('canDepotPickOrder rejects ready orders without open depot', () => {
  assert.equal(
    canDepotPickOrder({
      status: 'ready',
      picking_completed_at: '2026-06-22T12:00:00.000Z'
    }),
    false
  );
});

test('Uber invoiced-before-depot scenario stays incomplete until lines picked', () => {
  const progress = computePickingProgress([
    {
      matching_status: 'matched',
      quantity: 1,
      picked_qty: 0
    },
    {
      matching_status: 'matched',
      quantity: 2,
      picked_qty: 0
    }
  ]);
  assert.equal(progress.isComplete, false);
  assert.equal(progress.completeLines, 0);
  assert.equal(progress.actionableLines, 2);
  assert.equal(
    canDepotPickOrder({ status: 'picked', picking_completed_at: null }),
    true
  );
});

test('resolveCustomerOrderTotal prefers channel discounted total', async () => {
  const { resolveCustomerOrderTotal } = await import('../lib/ops-hub/picking/picking-service.js');

  assert.equal(
    resolveCustomerOrderTotal(
      {
        channel: 'trendyol_go',
        raw_payload: { grossAmount: 2505, totalPrice: 2355 }
      },
      2505
    ),
    2355
  );

  assert.equal(
    resolveCustomerOrderTotal(
      {
        channel: 'getir',
        raw_payload: { totalPriceWithPackaging: 3581, totalPrice: 3579 }
      },
      3600
    ),
    3581
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateOrderShadow, buildShadowReportFromEvents } from '../lib/ops-hub/shadow/simulator.js';

test('simulateOrderShadow reserves stock only for matched lines with barcode', () => {
  const result = simulateOrderShadow(
    {
      channel: 'trendyol_go',
      externalId: 'pkg-1',
      shadow_mode: true
    },
    {
      lines: [
        {
          line_index: 0,
          channel_product_id: 'a',
          barcode: '8690001112223',
          matching_status: 'matched',
          quantity: 2
        },
        {
          line_index: 1,
          channel_product_id: 'b',
          barcode: null,
          matching_status: 'unmapped',
          quantity: 1
        }
      ]
    }
  );

  assert.equal(result.summary.matchedLines, 1);
  assert.equal(result.summary.simulatedReservedQty, 2);
  assert.equal(result.summary.wouldWriteBenimposSale, true);
  assert.equal(result.issues.length, 1);
  assert.equal(result.simulatedPayloads.benimposSale.length, 1);
});

test('buildShadowReportFromEvents aggregates order and event counts', () => {
  const report = buildShadowReportFromEvents(
    [
      { channel: 'trendyol_go', shadow_mode: true },
      { channel: 'yemeksepeti', shadow_mode: true }
    ],
    [
      { event_type: 'shadow_simulation', order_id: '1', created_at: '2026-01-01', payload: {} },
      { event_type: 'shadow_issue', order_id: '1', created_at: '2026-01-01', payload: { type: 'unmapped_line' } }
    ]
  );

  assert.equal(report.orders.total, 2);
  assert.equal(report.events.simulations, 1);
  assert.equal(report.events.issues, 1);
});

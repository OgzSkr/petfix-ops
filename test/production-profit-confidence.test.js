import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProfitConfidence,
  isProfitKpiIncluded,
  labelOrderSource
} from '../lib/production/profit-confidence.js';
import { ORDER_SOURCES } from '../lib/production/constants.js';
import { buildOrderStats } from '../lib/order-profitability.js';

test('computeProfitConfidence missing_cost when no product cost', () => {
  const confidence = computeProfitConfidence({
    orderNumber: 'A1',
    salesAmount: 100,
    productCost: 0,
    extraCost: 0
  });
  assert.equal(confidence, 'missing_cost');
});

test('fixture order excluded from KPI totals', () => {
  const rows = [
    { salesAmount: 100, netProfit: 20, ingestSource: ORDER_SOURCES.WEBHOOK, profitConfidence: 'complete' },
    { salesAmount: 50, netProfit: 10, ingestSource: ORDER_SOURCES.FIXTURE, profitConfidence: 'complete' }
  ];
  const stats = buildOrderStats(rows, {
    excludeSources: [ORDER_SOURCES.FIXTURE],
    excludeConfidence: ['missing_cost', 'invalid_data']
  });
  assert.equal(stats.count, 2);
  assert.equal(stats.kpiCount, 1);
  assert.equal(stats.totalProfit, 20);
});

test('buildOrderStats excludes missing_cost even when profitConfidence unset', () => {
  const rows = [
    { salesAmount: 100, netProfit: 20, productCost: 0, extraCost: 0, orderNumber: 'A1' },
    { salesAmount: 80, netProfit: 15, productCost: 40, extraCost: 0, orderNumber: 'A2' }
  ];
  const stats = buildOrderStats(rows);
  assert.equal(stats.count, 2);
  assert.equal(stats.kpiCount, 1);
  assert.equal(stats.totalProfit, 15);
});

test('source labels', () => {
  assert.equal(labelOrderSource('webhook'), 'Webhook');
  assert.equal(labelOrderSource('partner_api'), 'Partner API');
});

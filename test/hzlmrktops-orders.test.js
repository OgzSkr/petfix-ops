import test from 'node:test';
import assert from 'node:assert/strict';
import { createHzlMrktOpsOrdersService } from '../lib/platform/services/hzlmrktops-orders.js';

const stubHealthCheck = async () => ({ configured: true, message: 'test stub' });

test('listHzlMrktOpsOrders merges active channel rows and stats', async () => {
  const channelOrders = {
    async listChannelOrders(channelId) {
      if (channelId === 'uber-eats') {
        return {
          rows: [
            {
              orderNumber: 'U-1',
              orderDateMs: Date.parse('2026-06-20T15:00:00.000Z'),
              status: 'Delivered',
              salesAmount: 100,
              netProfit: 10,
              channel: 'uber-eats',
              channelLabel: 'Uber Eats'
            }
          ],
          fetched: 1,
          total: 1,
          stats: { count: 1 },
          statuses: ['Delivered']
        };
      }
      if (channelId === 'yemeksepeti') {
        return {
          rows: [
            {
              orderNumber: 'Y-1',
              orderDateMs: Date.parse('2026-06-19T15:00:00.000Z'),
              status: 'Delivered',
              salesAmount: 80,
              netProfit: -5,
              channel: 'yemeksepeti',
              channelLabel: 'Yemeksepeti'
            }
          ],
          fetched: 1,
          total: 1,
          stats: { count: 1 },
          statuses: ['Delivered']
        };
      }
      return { rows: [], fetched: 0, total: 0, stats: { count: 0 }, statuses: [] };
    }
  };

  const service = createHzlMrktOpsOrdersService({
    channelOrders,
    healthCheckForChannel: stubHealthCheck,
    useOpsOrdersDb: false
  });
  const params = new URLSearchParams({ days: '14' });
  const result = await service.listHzlMrktOpsOrders(params);

  assert.equal(result.channel, 'hzlmrktops');
  assert.ok(result.rows.length >= 2, 'expected merged uber + yemeksepeti rows');
  assert.equal(result.rows[0].orderNumber, 'U-1');
  assert.ok(Array.isArray(result.channels));
  assert.ok(result.stats.count >= 2);
});

test('listHzlMrktOpsOrders respects channel filter', async () => {
  const channelOrders = {
    async listChannelOrders(channelId) {
      return {
        rows: channelId === 'uber-eats'
          ? [{ orderNumber: 'U-only', orderDateMs: Date.now(), status: 'Delivered', salesAmount: 1, netProfit: 1 }]
          : [],
        fetched: channelId === 'uber-eats' ? 1 : 0,
        total: channelId === 'uber-eats' ? 1 : 0,
        stats: { count: channelId === 'uber-eats' ? 1 : 0 },
        statuses: ['Delivered']
      };
    }
  };

  const service = createHzlMrktOpsOrdersService({
    channelOrders,
    healthCheckForChannel: stubHealthCheck,
    useOpsOrdersDb: false
  });
  const params = new URLSearchParams({ days: '14', channel: 'uber-eats' });
  const result = await service.listHzlMrktOpsOrders(params);

  assert.equal(result.channelFilter, 'uber-eats');
  assert.ok(result.rows.every((row) => row.orderNumber === 'U-only'));
});

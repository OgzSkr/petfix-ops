import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReportPeriod } from '../lib/ops-hub/reports/ops-reports-service.js';
import { buildProfitFootnote, buildOpsReportsProfit, buildOpsOrderProfitabilityReport, resolveOrderProfitReportWindow } from '../lib/ops-hub/reports/ops-reports-profit.js';
import { listOpsCustomers } from '../lib/ops-hub/customers/customer-index-service.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/constants.js';

function profitMatchingDb() {
  const db = { productMatching: {} };
  ensureProductMatching(db);
  db.productMatching.masterProducts.push({
    id: 'm-cat-food',
    name: 'Adult Somonlu Yetişkin Kedi Maması 1,5 K',
    benimposBarcode: '7613036508193',
    buyingPrice: 850,
    stock: 10
  });
  db.productMatching.channelProducts.push({
    id: 'cp-1',
    channelId: 'uber-eats',
    channelProductId: 'p1',
    channelBarcode: '7613036508193',
    channelName: 'Adult Somonlu Yetişkin Kedi Maması 1,5 K'
  });
  db.productMatching.mappings.push({
    id: 'map-1',
    channelId: 'uber-eats',
    channelProductId: 'p1',
    channelBarcode: '7613036508193',
    masterProductId: 'm-cat-food',
    status: MAPPING_STATUS.MANUAL_CONFIRMED
  });
  return db;
}

test('resolveReportPeriod today mode uses zero days label', () => {
  const period = resolveReportPeriod({ period: 'today' });
  assert.equal(period.mode, 'today');
  assert.equal(period.days, 0);
  assert.equal(period.periodLabel, 'Bugün');
  assert.ok(period.currentStart instanceof Date);
  assert.ok(period.end instanceof Date);
});

test('resolveReportPeriod days mode keeps span', () => {
  const period = resolveReportPeriod({ days: 14 });
  assert.equal(period.mode, 'days');
  assert.equal(period.days, 14);
  assert.equal(period.periodLabel, '14 gün');
});

test('buildProfitFootnote lists missing cost and reliable-order note', () => {
  const text = buildProfitFootnote({
    counts: { missing_cost: 165, complete: 0 },
    kpiIncluded: 0,
    total: 165
  });
  assert.match(text, /165 sipariş maliyet eksik/);
  assert.match(text, /güvenilir siparişlerden/);
});

test('buildOpsReportsProfit uses hybrid matching for BenimPOS master costs', async () => {
  const branchId = 'branch-1';
  const since = new Date('2026-01-01T00:00:00Z');
  const pool = {
    query: async (sql) => {
      if (sql.includes('ops_order_lines')) {
        return {
          rows: [{
            channel: 'trendyol_go',
            external_id: 'ext-1',
            display_id: 'T1',
            status: 'completed',
            channel_status: 'completed',
            ordered_at: new Date('2026-03-01T12:00:00Z'),
            ingest_source: 'webhook',
            raw_payload: {},
            customer_masked: null,
            delivery_mode: null,
            benimpos_sales_code: null,
            lines: [{
              barcode: '7613036508193',
              title: 'Adult Somonlu Yetişkin Kedi Maması 1,5 K',
              quantity: 1,
              unit_price: 1299,
              channel_product_id: 'p1'
            }]
          }]
        };
      }
      return { rows: [] };
    }
  };

  const legacyProfit = await buildOpsReportsProfit(pool, {
    branchId,
    since,
    liveOnly: false,
    channel: 'uber-eats',
    matchingConfig: { productMatchingMode: 'legacy', productMatchingModeByChannel: {} },
    db: profitMatchingDb()
  });
  const hybridProfit = await buildOpsReportsProfit(pool, {
    branchId,
    since,
    liveOnly: false,
    channel: 'uber-eats',
    matchingConfig: { productMatchingMode: 'hybrid', productMatchingModeByChannel: {} },
    db: profitMatchingDb()
  });

  assert.equal(legacyProfit.totalProfit, 0);
  assert.equal(legacyProfit.confidence.missing_cost, 1);
  assert.ok(hybridProfit.productCost > 0, 'hybrid mode should resolve BenimPOS master cost');
  assert.ok(hybridProfit.totalProfit !== 0 || hybridProfit.ordersInKpi > 0);
});

test('buildOpsOrderProfitabilityReport returns pagination metadata', async () => {
  const result = await buildOpsOrderProfitabilityReport(null, {
    branchId: '',
    since: null,
    page: 2,
    limit: 25
  });
  assert.equal(result.total, 0);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 25);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.rows, []);
});

test('resolveOrderProfitReportWindow maps all-records to max 30 days', async () => {
  const window = await resolveOrderProfitReportWindow(null, {
    branchId: 'branch-1',
    range: 'all'
  });
  assert.equal(window.mode, 'days');
  assert.equal(window.days, 30);
  assert.equal(window.periodLabel, 'Son 30 gün');
});

test('resolveOrderProfitReportWindow caps preset days at 30', async () => {
  const window = await resolveOrderProfitReportWindow(null, { days: 60 });
  assert.equal(window.days, 30);
  assert.equal(window.periodLabel, '30 gün');
});

test('resolveOrderProfitReportWindow rejects custom ranges over 30 days', async () => {
  const window = await resolveOrderProfitReportWindow(null, {
    startDate: '2026-01-01',
    endDate: '2026-03-01'
  });
  assert.ok(window.error);
  assert.match(window.error, /30 gün/);
});

test('listOpsCustomers returns meta with oldest order date', async () => {
  const oldest = new Date('2026-01-10T10:00:00Z');
  const newest = new Date('2026-03-01T12:00:00Z');
  let queryCount = 0;
  const pool = {
    query: async (sql) => {
      queryCount += 1;
      if (sql.includes('MIN(ordered_at)')) {
        return {
          rows: [{
            oldest_order_at: oldest,
            newest_order_at: newest,
            source_order_count: 2
          }]
        };
      }
      return {
        rows: [
          {
            id: 'o1',
            channel: 'getir',
            ordered_at: oldest,
            raw_payload: { customer: { name: 'Ali', phone: '5321112233' } },
            customer_masked: null,
            display_id: 'G1',
            external_id: 'ext1'
          },
          {
            id: 'o2',
            channel: 'getir',
            ordered_at: newest,
            raw_payload: { customer: { name: 'Ali', phone: '5321112233' } },
            customer_masked: null,
            display_id: 'G2',
            external_id: 'ext2'
          }
        ]
      };
    }
  };

  const result = await listOpsCustomers(pool, { branchId: 'branch-1', all: true });
  assert.equal(result.meta.oldestOrderAt, oldest);
  assert.equal(result.meta.newestOrderAt, newest);
  assert.equal(result.meta.sourceOrderCount, 2);
  assert.equal(result.meta.uniqueCustomers, 1);
  assert.ok(queryCount >= 2);
});

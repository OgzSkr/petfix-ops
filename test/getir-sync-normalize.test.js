import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGetirPollOrder, mapGetirOrderStatus, resolveGetirExternalId } from '../lib/ops-hub/channels/getir-normalize.js';
import { unwrapGetirOrderPayload } from '../lib/channels/getir-order-payload.js';
import { summarizeGetirSyncReport, syncGetirActiveInFlight } from '../lib/ops-hub/sync/getir-sync.js';
import { fetchGetirDeliveredOrders, fetchGetirOrderById } from '../lib/channels/getir-api.js';
import { packageFromGetirOpsRow, profitPackageFromGetirNormalized } from '../lib/channels/ops-orders-bridge.js';

test('isGetirChannelCompleted recognizes terminal Getir codes', async () => {
  const { isGetirChannelCompleted } = await import('../lib/ops-hub/channels/getir-normalize.js');
  assert.equal(isGetirChannelCompleted('900'), true);
  assert.equal(isGetirChannelCompleted('1500'), true);
  assert.equal(isGetirChannelCompleted('700'), false);
  assert.equal(isGetirChannelCompleted(null), false);
});

test('mapGetirOrderStatus maps in-flight Getir codes to ops statuses', () => {
  assert.equal(mapGetirOrderStatus({ status: 400 }), 'received');
  assert.equal(mapGetirOrderStatus({ status: 500 }), 'picking');
  assert.equal(mapGetirOrderStatus({ status: 700 }), 'ready');
  assert.equal(mapGetirOrderStatus({ status: 900 }), 'completed');
});

test('packageFromGetirOpsRow resolves numeric channel_status to ops label', () => {
  const pkg = packageFromGetirOpsRow({
    external_id: 'g-1',
    display_id: 'p100',
    status: '',
    channel_status: '500',
    ordered_at: '2026-06-18T10:00:00.000Z',
    ingest_source: 'webhook',
    raw_payload: { status: 500, totalPrice: 250 },
    lines: []
  });
  assert.equal(pkg.status, 'picking');
});

test('profitPackageFromGetirNormalized builds live API package', () => {
  const pkg = profitPackageFromGetirNormalized({
    externalId: 'g-2',
    displayId: 'p200',
    status: 'received',
    orderedAt: '2026-06-18T11:00:00.000Z',
    ingestSource: 'partner_api',
    rawPayload: { totalPrice: 500, paymentMethod: 1 },
    lines: [{ title: 'Ürün', quantity: 1, unitPrice: 500, barcode: '123' }]
  });
  assert.equal(pkg.orderNumber, 'p200');
  assert.equal(pkg.status, 'received');
  assert.equal(pkg.lines.length, 1);
});

test('fetchGetirOrderById unwraps nested order and accepts _id', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/v1\/orders\/order-42\?shopId=shop-1/);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        meta: { 'return-code': '0' },
        data: { order: { _id: 'order-42', confirmationId: 'p42', status: 550, totalPrice: 999 } }
      })
    };
  };

  try {
    const order = await fetchGetirOrderById(
      { shopId: 'shop-1', apiBaseUrl: 'https://example.test' },
      { token: 't1', baseUrl: 'https://example.test', shopId: 'shop-1' },
      'order-42'
    );
    assert.equal(order._id, 'order-42');
    assert.equal(order.confirmationId, 'p42');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchGetirOrderById reads order payload from data envelope', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/v1\/orders\/order-42\?shopId=shop-1/);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        meta: { 'return-code': '0' },
        data: { id: 'order-42', status: 550, totalPrice: 999 }
      })
    };
  };

  try {
    const order = await fetchGetirOrderById(
      { shopId: 'shop-1', apiBaseUrl: 'https://example.test' },
      { token: 't1', baseUrl: 'https://example.test', shopId: 'shop-1' },
      'order-42'
    );
    assert.equal(order.id, 'order-42');
    assert.equal(order.status, 550);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('summarizeGetirSyncReport surfaces active refresh counts', () => {
  const summary = summarizeGetirSyncReport({
    apiReady: true,
    force: false,
    live: {
      fetched: 2,
      ingested: 0,
      duplicates: 2,
      failed: 0,
      active: { fetched: 3, refreshed: 2, ingested: 0, duplicates: 3, failed: 0, errors: [] }
    }
  });

  assert.match(summary.messages.join(' '), /2 aktif Getir siparişi güncellendi/);
});

test('syncGetirActiveInFlight skips when credentials missing', async () => {
  const result = await syncGetirActiveInFlight({}, { cfg: { shopId: '' } });
  assert.equal(result.skipped, true);
  assert.equal(result.fetched, 0);
});

test('normalizeGetirPollOrder accepts Mongo _id when id missing', async () => {
  const result = await normalizeGetirPollOrder({
    _id: '64abc123def456789012345',
    confirmationId: 'p999',
    status: 400,
    totalPrice: 250,
    products: [{ name: { tr: 'Test' }, count: 1, price: 250, barcode: '8690001112223' }]
  }, { endpointKind: 'unapproved', platformEnv: {}, shopId: 'shop-1' });

  assert.equal(result.ok, true);
  assert.equal(result.order.externalId, '64abc123def456789012345');
  assert.equal(result.order.displayId, 'p999');
});

test('normalizeGetirPollOrder uses Getir webhook orderID over confirmationId', async () => {
  const result = await normalizeGetirPollOrder({
    orderID: '6a355fa65fe50899ba8e9169',
    confirmationId: 'p599',
    status: 400,
    totalPrice: 320,
    products: [{ name: { tr: 'Test' }, count: 1, price: 320, catalogProductId: 'prod-1' }]
  }, { endpointKind: 'unapproved', platformEnv: {}, shopId: 'shop-1' });

  assert.equal(result.ok, true);
  assert.equal(result.order.externalId, '6a355fa65fe50899ba8e9169');
  assert.equal(result.order.displayId, 'p599');
});

test('normalizeGetirPollOrder unwraps nested order envelope from poll payload', async () => {
  const result = await normalizeGetirPollOrder({
    order: {
      id: 'getir-wrap-1',
      confirmationId: 'p111',
      status: 400,
      totalPrice: 100,
      products: [{ name: { tr: 'Su' }, count: 1, price: 100 }]
    }
  }, { endpointKind: 'unapproved', platformEnv: {}, shopId: 'shop-1' });

  assert.equal(result.ok, true);
  assert.equal(result.order.externalId, 'getir-wrap-1');
});

test('resolveGetirExternalId matches delivered dedupe key fields', () => {
  assert.equal(resolveGetirExternalId({ _id: 'x1' }), 'x1');
  assert.equal(resolveGetirExternalId({ confirmationId: 'p757' }), '');
  assert.equal(resolveGetirExternalId({}), '');
});

test('normalizeGetirPollOrder assigns fallback channelProductId when product id missing', async () => {
  const result = await normalizeGetirPollOrder({
    id: 'getir-order-2',
    confirmationId: 'p888',
    status: 400,
    totalPrice: 420,
    products: [{ name: { tr: 'Kedi Maması' }, count: 1, price: 420, barcode: '8698595910181' }]
  }, { endpointKind: 'unapproved', platformEnv: {}, shopId: 'shop-1' });

  assert.equal(result.ok, true);
  assert.equal(result.order.status, 'received');
  assert.equal(result.order.lines[0].channelProductId, 'getir-barcode-8698595910181');
});

test('parseGetirLineWeightGrams ignores totalWeight on type=count fixed-pack lines', async () => {
  const { parseGetirLineWeightGrams, enrichGetirOrderLinesWithWeight } = await import('../lib/ops-hub/channels/getir-normalize.js');

  assert.equal(parseGetirLineWeightGrams({
    type: 'count',
    count: 2,
    totalWeight: 2200,
    name: { tr: 'Versele-Laga Muhabbet Kuşu Yemi (1 kg)' }
  }), null);

  const enriched = enrichGetirOrderLinesWithWeight([{
    title: 'Versele-Laga Muhabbet Kuşu Yemi (1 kg) · 2200 g',
    orderGrams: 2200,
    totalWeightGrams: 2200,
    quantity: 2
  }], {
    products: [{
      type: 'count',
      count: 2,
      totalWeight: 2200,
      name: { tr: 'Versele-Laga Muhabbet Kuşu Yemi (1 kg)' }
    }]
  });

  assert.equal(enriched[0].orderGrams, null);
  assert.equal(enriched[0].title, 'Versele-Laga Muhabbet Kuşu Yemi (1 kg)');
});

test('normalizeGetirPollOrder captures totalWeight for gramajlı Getir lines', async () => {
  const result = await normalizeGetirPollOrder({
    id: 'getir-weight-1',
    confirmationId: 'p599',
    status: 900,
    totalPrice: 321,
    products: [{
      name: { tr: 'Enjoy Tavuk Etli Açık Yetişkin Kedi Maması' },
      type: 'gr',
      count: 1,
      price: 320,
      totalWeight: 2000,
      catalogProductId: '15be01a1-8165-4e59-aee5-d9f0c27413c8',
      product: '1418f4ba-12fb-4945-869f-13a32fe32eb7'
    }]
  }, { endpointKind: 'delivered', platformEnv: {}, shopId: 'shop-1' });

  assert.equal(result.ok, true);
  assert.equal(result.order.lines[0].orderGrams, 2000);
  assert.match(result.order.lines[0].title, /2000 g/);
});

test('normalizeGetirPollOrder adds summary line when delivered payload has no products', async () => {
  const result = await normalizeGetirPollOrder({
    id: 'getir-order-1',
    confirmationId: 'p757',
    totalPrice: 1313,
    client: { name: 'Test User' },
    checkoutDate: '2026-06-17T18:31:00.000Z'
  }, {
    endpointKind: 'delivered',
    platformEnv: {},
    shopId: 'shop-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.displayId, 'p757');
  assert.equal(result.order.status, 'completed');
  assert.equal(result.order.lines.length, 1);
  assert.equal(result.order.lines[0].title, 'Getir sipariş');
  assert.equal(result.order.lines[0].unitPrice, 1313);
});

test('summarizeGetirSyncReport surfaces missing API credentials', () => {
  const summary = summarizeGetirSyncReport({
    apiReady: false,
    force: true,
    errors: []
  });

  assert.equal(summary.apiReady, false);
  assert.match(summary.messages[0], /Getir API bilgileri eksik/i);
});

test('summarizeGetirSyncReport reports delivered ingest counts', () => {
  const summary = summarizeGetirSyncReport({
    apiReady: true,
    force: true,
    delivered: { fetched: 12, ingested: 5, duplicates: 7, failed: 0, errors: [] },
    live: { fetched: 0, ingested: 0, duplicates: 0, failed: 0, errors: [] }
  });

  assert.equal(summary.ingested, 5);
  assert.equal(summary.fetched, 12);
  assert.equal(summary.messages.length, 0);
});

test('fetchGetirDeliveredOrders dedupes and stops when pagination repeats orders', async () => {
  // Getir delivered API `page` parametresini güvenilir uygulamıyor: her sayfa aynı
  // 50 siparişi döndürür. Dedup + erken durma olmadan döngü maxPages'e kadar boşa döner.
  const samePage = Array.from({ length: 50 }, (_, i) => ({ id: `g-${i}`, totalPrice: 100 }));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ meta: { 'return-code': '0' }, data: { orders: samePage } })
    };
  };

  try {
    const orders = await fetchGetirDeliveredOrders(
      { baseUrl: 'https://example.test', shopId: 's1' },
      { token: 't1', baseUrl: 'https://example.test', shopId: 's1' },
      { days: 7, pageSize: 50, maxPages: 100 }
    );
    assert.equal(orders.length, 50, 'yalnızca benzersiz siparişler döner');
    assert.ok(calls <= 3, `erken durmalı, ${calls} sayfa çekildi`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

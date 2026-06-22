import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGetirStockPayload } from '../lib/ops-hub/channels/getir-stock-write.js';

test('buildGetirStockPayload maps menu product id and shop', () => {
  const payload = buildGetirStockPayload(
    [
      {
        channelProductId: 'menu-1',
        targetQuantity: 5,
        targetPrice: 42.5
      }
    ],
    { shopId: 'shop-abc' },
    { mode: 'full' }
  );

  assert.equal(payload.products.length, 1);
  assert.deepEqual(payload.products[0], {
    getirId: 'menu-1',
    shopId: 'shop-abc',
    quantity: 5,
    price: 42.5
  });
});

test('buildGetirStockPayload price-only mode skips quantity', () => {
  const payload = buildGetirStockPayload(
    [{ channelProductId: 'menu-2', targetQuantity: 3, targetPrice: 10 }],
    { shopId: 'shop-abc' },
    { mode: 'price' }
  );

  assert.equal(payload.products[0].price, 10);
  assert.equal('quantity' in payload.products[0], false);
});

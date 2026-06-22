import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCatalogSaleState } from '../lib/channels/uber-eats-catalog.js';

test('resolveCatalogSaleState prefers ON_SALE snapshot over stale NOT_ON_SALE', () => {
  const sale = resolveCatalogSaleState({
    onSale: false,
    quantity: 0,
    listTypeSnapshots: {
      ON_SALE: { onSale: true, quantity: 998 },
      NOT_ON_SALE: { onSale: false, quantity: 0 }
    }
  });

  assert.equal(sale.onSale, true);
  assert.equal(sale.quantity, 998);
});

test('resolveCatalogSaleState falls back to NOT_ON_SALE when ON_SALE missing', () => {
  const sale = resolveCatalogSaleState({
    onSale: true,
    quantity: 5,
    listTypeSnapshots: {
      NOT_ON_SALE: { onSale: false, quantity: 0 }
    }
  });

  assert.equal(sale.onSale, false);
  assert.equal(sale.quantity, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGetirPaymentMethod } from '../lib/ops-hub/channels/getir-normalize.js';
import { computeBenimposTransferStatus } from '../lib/product-matching/benimpos-transfer-status.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';

test('formatGetirPaymentMethod maps numeric code 1 to Online', () => {
  assert.equal(formatGetirPaymentMethod({ paymentMethod: '1' }), 'Online');
  assert.equal(formatGetirPaymentMethod({ payment_method: 1 }), 'Online');
});

test('formatGetirPaymentMethod prefers localized paymentMethodText', () => {
  assert.equal(
    formatGetirPaymentMethod({
      paymentMethod: '1',
      paymentMethodText: { tr: 'Online Ödeme', en: 'Online Payment' }
    }),
    'Online Ödeme'
  );
});

test('computeBenimposTransferStatus supports getir channel', () => {
  const db = {};
  ensureProductMatching(db);
  db.productMatching.masterProducts.push({
    id: 'mp-g1',
    benimposBarcode: '8698595910181',
    name: 'Test',
    stock: 3,
    buyingPrice: 10
  });
  db.productMatching.mappings.push({
    id: 'map-getir-1',
    channelId: 'getir',
    channelProductId: 'menu-1',
    channelBarcode: '8698595910181',
    masterProductId: 'mp-g1',
    status: MAPPING_STATUS.AUTO_MATCHED,
    matchMethod: 'auto_barcode'
  });
  db.productMatching.channelProducts.push({
    channelId: 'getir',
    channelBarcode: '8698595910181',
    channelProductId: 'menu-1',
    channelName: 'Test'
  });

  const meta = computeBenimposTransferStatus(
    {
      orderNumber: 'G-100',
      lines: [{ barcode: '8698595910181', quantity: 1, productName: 'Test' }]
    },
    db,
    'getir'
  );
  assert.equal(meta.benimposTransferStatus, 'ready');
});

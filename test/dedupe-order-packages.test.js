import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeOrderPackages, mergeOrderLines } from '../lib/channels/dedupe-order-packages.js';

test('mergeOrderLines replaces generic Satış names from ops/webhook lines', () => {
  const financeLines = [
    { barcode: '000007831301', productName: 'Satış', quantity: 1, lineUnitPrice: 200 },
    { barcode: '0761303837553', productName: 'Satış', quantity: 1, lineUnitPrice: 210 }
  ];
  const opsLines = [
    { barcode: '9003579311301', productName: 'Gravy Sterilised Kısırlaştırılmış Yaş Kedi Maması 85 gr', quantity: 1 },
    { barcode: '07613036075534', productName: 'Açık Purina Proplan Somonlu Kısırlaştırılmış Kedi Maması 500 Gr', quantity: 1 }
  ];

  const merged = mergeOrderLines(financeLines, opsLines);
  assert.equal(merged.length, 2);
  assert.match(merged[0].productName, /Gravy Sterilised/i);
  assert.match(merged[1].productName, /Proplan/i);
  assert.equal(merged[0].lineUnitPrice, 200);
});

test('dedupeOrderPackages merges finance settlement with ops product titles', () => {
  const packages = dedupeOrderPackages([
    {
      orderNumber: '11320270516',
      lines: [
        { barcode: '000007831301', productName: 'Satış', quantity: 1 },
        { barcode: '0761303837553', productName: 'Satış', quantity: 1 }
      ],
      ingestSource: 'partner_api'
    },
    {
      orderNumber: '11320270516',
      lines: [
        { barcode: '9003579311301', productName: 'Gravy Sterilised Kısırlaştırılmış Yaş Kedi Maması 85 gr', quantity: 1 },
        { barcode: '07613036075534', productName: 'Açık Purina Proplan Somonlu Kısırlaştırılmış Kedi Maması 500 Gr', quantity: 1 }
      ],
      ingestSource: 'webhook'
    }
  ]);

  assert.equal(packages.length, 1);
  assert.match(packages[0].lines[0].productName, /Gravy Sterilised/i);
  assert.match(packages[0].lines[1].productName, /Proplan/i);
});

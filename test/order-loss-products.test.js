import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLossProducts, isLossProductMatchingIssue } from '../lib/order-profitability.js';

test('aggregateLossProducts groups loss order lines by barcode', () => {
  const rows = [
    {
      orderNumber: '1001',
      netProfit: -10,
      lines: [
        {
          barcode: '111',
          productName: 'Ürün A',
          quantity: 2,
          lineSalesAmount: 100,
          totalProductCost: 80,
          commissionAmount: 15,
          lineNetBeforeFees: 5,
          mappingStatus: 'unmapped'
        },
        {
          barcode: '222',
          productName: 'Ürün B',
          quantity: 1,
          lineSalesAmount: 50,
          totalProductCost: 70,
          commissionAmount: 5,
          lineNetBeforeFees: -25,
          mappingStatus: 'manual_confirmed'
        }
      ]
    },
    {
      orderNumber: '1002',
      netProfit: -5,
      lines: [
        {
          barcode: '111',
          productName: 'Ürün A',
          quantity: 1,
          lineSalesAmount: 40,
          totalProductCost: 30,
          commissionAmount: 8,
          lineNetBeforeFees: 2,
          mappingStatus: 'review_required'
        }
      ]
    },
    {
      orderNumber: '2001',
      netProfit: 20,
      lines: [
        {
          barcode: '999',
          productName: 'Kârlı',
          quantity: 1,
          lineSalesAmount: 100,
          totalProductCost: 20,
          commissionAmount: 10,
          lineNetBeforeFees: 70,
          mappingStatus: 'legacy'
        }
      ]
    }
  ];

  const result = aggregateLossProducts(rows);

  assert.equal(result.length, 2);
  assert.equal(result[0].barcode, '222');
  assert.equal(result[0].totalLineNet, -25);
  assert.equal(result[0].lossOrderCount, 1);

  const productA = result.find((item) => item.barcode === '111');
  assert.ok(productA);
  assert.equal(productA.quantity, 3);
  assert.equal(productA.totalLineNet, 7);
  assert.equal(productA.lossOrderCount, 2);
  assert.equal(productA.mappingStatus, 'review_required');
  assert.equal(productA.hasMatchingIssue, true);
});

test('isLossProductMatchingIssue flags actionable statuses', () => {
  assert.equal(isLossProductMatchingIssue('unmapped'), true);
  assert.equal(isLossProductMatchingIssue('manual_confirmed'), false);
  assert.equal(isLossProductMatchingIssue('legacy'), false);
});

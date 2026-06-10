import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeOrderPackages,
  buildLivePerformanceStats,
  buildOrderStats
} from '../lib/order-profitability.js';

test('buildOrderStats totalSales equals sum of row salesAmount', () => {
  const rows = [
    { salesAmount: 1090, netProfit: 100, profitRate: 10, profitMargin: 8 },
    { salesAmount: 1354, netProfit: 200, profitRate: 15, profitMargin: 12 }
  ];
  const stats = buildOrderStats(rows);
  const sum = rows.reduce((acc, row) => acc + row.salesAmount, 0);
  assert.equal(stats.totalSales, sum);
  assert.equal(stats.totalProfit, 300);
});

test('buildLivePerformanceStats keeps ciro aligned with order amounts', () => {
  const packages = [
    {
      orderNumber: 'A1',
      orderDate: Date.now(),
      status: 'Delivered',
      packageGrossAmount: 1000,
      packageTotalDiscount: 50,
      lines: [{ barcode: '1', quantity: 1, lineGrossAmount: 1000, lineUnitPrice: 1000, commission: 10 }]
    },
    {
      orderNumber: 'A2',
      orderDate: Date.now() - 1000,
      status: 'Delivered',
      packageGrossAmount: 500,
      packageTotalDiscount: 0,
      lines: [{ barcode: '2', quantity: 1, lineGrossAmount: 500, lineUnitPrice: 500, commission: 10 }]
    }
  ];

  const rows = analyzeOrderPackages(packages, { products: [] }, {
    costByBarcode: {},
    defaultShippingCost: 0,
    serviceFee: 0,
    stoppageRate: 0,
    adCostRate: 0
  });
  const stats = buildLivePerformanceStats(rows);
  const sumSales = rows.reduce((acc, row) => acc + row.salesAmount, 0);

  assert.equal(stats.totalSales, sumSales);
  assert.equal(rows[0].salesAmount, 1000);
  assert.equal(rows[1].salesAmount, 500);
  assert.notEqual(stats.totalSales, stats.totalProfit);
});

test('getPackageSalesAmount prefers gross line totals over net package totalPrice', () => {
  const packages = [
    {
      orderNumber: '11288725372',
      orderDate: Date.now(),
      status: 'Delivered',
      totalPrice: 1015,
      packageTotalDiscount: 75,
      lines: [
        { barcode: 'a', quantity: 1, lineGrossAmount: 53, lineSellerDiscount: 12.5, commission: 10 },
        { barcode: 'a', quantity: 1, lineGrossAmount: 53, lineSellerDiscount: 12.5, commission: 10 },
        { barcode: 'b', quantity: 1, lineGrossAmount: 825, lineSellerDiscount: 12.5, commission: 10 },
        { barcode: 'a', quantity: 1, lineGrossAmount: 53, lineSellerDiscount: 12.5, commission: 10 },
        { barcode: 'a', quantity: 1, lineGrossAmount: 53, lineSellerDiscount: 12.5, commission: 10 },
        { barcode: 'a', quantity: 1, lineGrossAmount: 53, lineSellerDiscount: 12.5, commission: 10 }
      ]
    }
  ];

  const rows = analyzeOrderPackages(packages, { products: [] }, {
    costByBarcode: {},
    defaultShippingCost: 0,
    serviceFee: 0,
    stoppageRate: 0,
    adCostRate: 0
  });

  assert.equal(rows[0].salesAmount, 1090);
});

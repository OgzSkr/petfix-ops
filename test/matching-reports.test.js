import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchingReports } from '../lib/product-matching/reports.js';

test('buildMatchingReports splits missing by catalog presence', () => {
  const db = {
    productMatching: {
      masterProducts: [
        { id: 'mp-a', benimposBarcode: '111', name: 'A', stock: 5, buyingPrice: 10, salePrice1: 20 },
        { id: 'mp-b', benimposBarcode: '222', name: 'B', stock: 3, buyingPrice: 10, salePrice1: 20 }
      ],
      channelProducts: [
        { channelId: 'uber-eats', channelProductId: '222', channelBarcode: '222', channelName: 'B uber', lastUnitPrice: 25 }
      ],
      mappings: [],
      conflicts: []
    }
  };

  const report = buildMatchingReports(db, 'uber-eats');
  assert.equal(report.missingOnChannel.total, 2);
  assert.equal(report.missingOnChannel.breakdown.notInCatalog, 1);
  assert.equal(report.missingOnChannel.breakdown.inCatalogUnmapped, 1);
  assert.equal(report.missingOnChannel.rows.find((r) => r.benimposBarcode === '111').catalogState, 'not_in_catalog');
  assert.equal(report.missingOnChannel.rows.find((r) => r.benimposBarcode === '222').catalogState, 'in_catalog');
});

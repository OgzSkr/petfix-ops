import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPPING_STATUS } from '../lib/product-matching/mapping-types.js';
import { ensureProductMatching } from '../lib/product-matching/schema.js';
import { buildChannelSalesReadiness, BENIMPOS_SALE_CONFIRM_LEVELS } from '../lib/product-matching/sales-readiness.js';

function makeDb() {
  const db = { products: [] };
  ensureProductMatching(db);
  return db;
}

test('buildChannelSalesReadiness nextSteps link to Gelen Kutusu filters', () => {
  const db = makeDb();
  db.productMatching.channelProducts.push(
    { channelId: 'yemeksepeti', channelProductId: 'ys-1', channelBarcode: '111', channelName: 'A' },
    { channelId: 'yemeksepeti', channelProductId: 'ys-2', channelBarcode: '222', channelName: 'B' }
  );
  db.productMatching.mappings.push(
    {
      id: 'm1',
      channelId: 'yemeksepeti',
      channelProductId: 'ys-1',
      masterProductId: 'mp-1',
      status: MAPPING_STATUS.REVIEW_REQUIRED
    },
    {
      id: 'm2',
      channelId: 'yemeksepeti',
      channelProductId: 'ys-2',
      status: MAPPING_STATUS.MISSING_MASTER
    }
  );

  const readiness = buildChannelSalesReadiness(
    db,
    'yemeksepeti',
    BENIMPOS_SALE_CONFIRM_LEVELS.MANUAL_ONLY
  );

  const missing = readiness.nextSteps.find((s) => s.action === 'review_missing_master');
  const review = readiness.nextSteps.find((s) => s.action === 'resolve_conflicts');
  assert.match(missing?.href || '', /channelId=yemeksepeti/);
  assert.match(missing?.href || '', /missing_master/);
  assert.match(review?.href || '', /manual_review/);
});

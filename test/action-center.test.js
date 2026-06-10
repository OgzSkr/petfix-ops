import test from 'node:test';
import assert from 'node:assert/strict';
import { sortActionCenterItems } from '../lib/platform/services/action-center.js';

test('sortActionCenterItems orders danger before warning and higher counts first', () => {
  const sorted = sortActionCenterItems([
    { id: 'a', severity: 'info', count: 10 },
    { id: 'b', severity: 'danger', count: 2 },
    { id: 'c', severity: 'warning', count: 50 },
    { id: 'd', severity: 'warning', count: 5 }
  ]);
  assert.equal(sorted[0].id, 'b');
  assert.equal(sorted[1].id, 'c');
  assert.equal(sorted[2].id, 'd');
  assert.equal(sorted[3].id, 'a');
});

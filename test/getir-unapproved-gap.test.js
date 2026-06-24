import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUnapprovedExternalIds } from '../lib/ops-hub/sync/getir-unapproved-gap.js';

test('collectUnapprovedExternalIds extracts mongo ids from poll rows', () => {
  const ids = collectUnapprovedExternalIds([
    { _id: '6a3975592216743d37196d6f', confirmationId: 'n060' },
    { order: { id: '6a3974b46e8f635c81761a61', confirmationId: 'd208' } },
    { confirmationId: 'p999' }
  ]);
  assert.deepEqual([...ids].sort(), [
    '6a3974b46e8f635c81761a61',
    '6a3975592216743d37196d6f'
  ].sort());
});

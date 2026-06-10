import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUberOpsChecklist } from '../lib/platform/services/uber-ops-checklist.js';

test('buildUberOpsChecklist marks completed steps', () => {
  const checklist = buildUberOpsChecklist({
    health: {
      probe: {
        orders: { ok: true },
        catalog: { ok: true, storeId: 223508, message: 'OK' }
      }
    },
    matchingStatus: {
      masterProductCount: 120,
      masterSyncedAt: '2026-05-26T10:00:00.000Z',
      uberCatalogSyncedAt: '2026-05-26T11:00:00.000Z',
      uberCatalogProductCount: 500,
      uberCatalogStoreId: 223508,
      uberEats: { byStatus: { manual_confirmed: 10, auto_matched: 5 } }
    },
    readiness: { readyForSales: false, blockers: ['5 otomatik eşleşme manuel onay bekliyor'] }
  });

  assert.equal(checklist.length, 5);
  assert.equal(checklist.find((s) => s.id === 'api').done, true);
  assert.equal(checklist.find((s) => s.id === 'master').done, true);
  assert.equal(checklist.find((s) => s.id === 'catalog').done, true);
  assert.equal(checklist.find((s) => s.id === 'orders'), undefined);
  assert.equal(checklist.find((s) => s.id === 'confirm').done, false);
});

test('buildUberOpsChecklist flags missing API', () => {
  const checklist = buildUberOpsChecklist({
    health: { probe: { orders: { ok: false }, catalog: { ok: false } } },
    matchingStatus: { masterProductCount: 0 },
    readiness: { readyForSales: false, blockers: [] }
  });

  assert.equal(checklist.find((s) => s.id === 'api').done, false);
  assert.equal(checklist.find((s) => s.id === 'master').done, false);
});

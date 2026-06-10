import test from 'node:test';
import assert from 'node:assert/strict';

test('listPlatformNavTabs follows corporate navigation order', async () => {
  const { listPlatformNavTabs } = await import('../lib/channels/registry.js');
  const tabs = listPlatformNavTabs();
  const labels = tabs.map((tab) => tab.label);
  assert.deepEqual(labels, [
    'Genel Bakış',
    'Trendyol Pazaryeri',
    'Uber Eats / Trendyol Go',
    'Getir',
    'Yemeksepeti',
    'BenimPOS',
    'Ayarlar'
  ]);
  assert.equal(tabs.find((tab) => tab.id === 'getir')?.badge, 'yakında');
});

test('buildDataIntegrityAudit returns read-only report shape', async () => {
  const { buildDataIntegrityAudit } = await import('../lib/platform/services/data-integrity-audit.js');
  const report = await buildDataIntegrityAudit();
  assert.equal(report.readOnly, true);
  assert.ok(report.summary);
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.safeActions));
});

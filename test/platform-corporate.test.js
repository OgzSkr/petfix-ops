import test from 'node:test';
import assert from 'node:assert/strict';

test('listPlatformNavTabs follows corporate navigation order', async () => {
  const { listPlatformNavTabs } = await import('../lib/channels/registry.js');
  const tabs = listPlatformNavTabs();
  const labels = tabs.map((tab) => tab.label);
  assert.deepEqual(labels, [
    'MarketNext',
    'Uber Eats / Trendyol Go',
    'Yemeksepeti',
    'Pazaryeri',
    'E-Ticaret',
    'Ayarlar'
  ]);
  assert.equal(tabs.find((tab) => tab.id === 'marketnext')?.href, '/marketnext');
  assert.equal(tabs.find((tab) => tab.id === 'marketplace')?.href, '/marketplace/trendyol');
});

test('buildDataIntegrityAudit returns read-only report shape', async () => {
  const { buildDataIntegrityAudit } = await import('../lib/platform/services/data-integrity-audit.js');
  const report = await buildDataIntegrityAudit();
  assert.equal(report.readOnly, true);
  assert.ok(report.summary);
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.safeActions));
});

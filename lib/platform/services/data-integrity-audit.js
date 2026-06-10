import { readDb } from '../../db/store.js';
import { ensureProductMatching } from '../../product-matching/schema.js';
import { normalizeBarcode } from '../../product-matching/normalize.js';

/**
 * Salt okunur veri bütünlüğü denetimi — otomatik silme yapmaz.
 */
export async function buildDataIntegrityAudit() {
  const db = await readDb();
  const pm = ensureProductMatching(db);
  const masterById = new Map(pm.masterProducts.map((row) => [row.id, row]));
  const findings = [];

  const masterBarcodeGroups = new Map();
  for (const master of pm.masterProducts) {
    const code = normalizeBarcode(master.benimposBarcode);
    if (!code) continue;
    if (!masterBarcodeGroups.has(code)) masterBarcodeGroups.set(code, []);
    masterBarcodeGroups.get(code).push(master);
  }

  const masterBarcodeDuplicates = [...masterBarcodeGroups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([barcode, rows]) => ({
      barcode,
      count: rows.length,
      items: rows.slice(0, 5).map((row) => ({ id: row.id, name: row.name }))
    }));

  if (masterBarcodeDuplicates.length) {
    findings.push({
      id: 'master-barcode-duplicates',
      severity: 'danger',
      label: 'Ana havuzda çift barkod',
      count: masterBarcodeDuplicates.length,
      hint: 'Aynı barkoda bağlı birden fazla BenimPOS ürünü — satış aktarımında çakışma riski',
      samples: masterBarcodeDuplicates.slice(0, 8)
    });
  }

  const mappingKeyGroups = new Map();
  for (const mapping of pm.mappings) {
    const key = `${mapping.channelId}::${mapping.channelProductId}`;
    if (!mappingKeyGroups.has(key)) mappingKeyGroups.set(key, []);
    mappingKeyGroups.get(key).push(mapping);
  }

  const duplicateMappings = [...mappingKeyGroups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      count: rows.length,
      channelId: rows[0]?.channelId,
      channelProductId: rows[0]?.channelProductId,
      statuses: rows.map((row) => row.status)
    }));

  if (duplicateMappings.length) {
    findings.push({
      id: 'duplicate-mappings',
      severity: 'warning',
      label: 'Çift eşleştirme kaydı',
      count: duplicateMappings.length,
      hint: 'Aynı kanal ürününe birden fazla mapping — temizlik öncesi manuel inceleme gerekir',
      samples: duplicateMappings.slice(0, 8)
    });
  }

  const orphanMappings = pm.mappings.filter(
    (mapping) => mapping.masterProductId && !masterById.has(mapping.masterProductId)
  );

  if (orphanMappings.length) {
    findings.push({
      id: 'orphan-mappings',
      severity: 'warning',
      label: 'Yetim eşleştirme',
      count: orphanMappings.length,
      hint: 'Ana havuzda artık olmayan masterProductId referansları',
      samples: orphanMappings.slice(0, 8).map((row) => ({
        channelId: row.channelId,
        channelProductId: row.channelProductId,
        masterProductId: row.masterProductId,
        status: row.status
      }))
    });
  }

  const channelDuplicateBarcodes = [];
  const channelIds = [...new Set(pm.channelProducts.map((row) => row.channelId))];
  for (const channelId of channelIds) {
    const groups = new Map();
    for (const cp of pm.channelProducts.filter((row) => row.channelId === channelId)) {
      const code = normalizeBarcode(cp.channelBarcode);
      if (!code) continue;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(cp);
    }
    const dupes = [...groups.entries()].filter(([, rows]) => rows.length > 1);
    if (dupes.length) {
      channelDuplicateBarcodes.push({
        channelId,
        label: channelId,
        duplicateBarcodeGroups: dupes.length,
        samples: dupes.slice(0, 3).map(([barcode, rows]) => ({
          barcode,
          count: rows.length,
          names: rows.slice(0, 3).map((row) => row.channelName || row.channelProductId)
        }))
      });
    }
  }

  if (channelDuplicateBarcodes.length) {
    const totalGroups = channelDuplicateBarcodes.reduce((sum, row) => sum + row.duplicateBarcodeGroups, 0);
    findings.push({
      id: 'channel-barcode-duplicates',
      severity: 'info',
      label: 'Kanalda tekrarlayan barkod',
      count: totalGroups,
      hint: 'Aynı barkodla birden fazla kanal ürünü — eşleştirmede karışıklık yaratabilir',
      samples: channelDuplicateBarcodes
    });
  }

  const masterIds = new Set(pm.masterProducts.map((row) => row.id));
  const channelProductKeys = new Set(
    pm.channelProducts.map((row) => `${row.channelId}::${row.channelProductId}`)
  );

  const staleChannelProducts = pm.channelProducts.filter(
    (cp) => cp.masterProductId && !masterIds.has(cp.masterProductId)
  ).length;

  const staleMappings = pm.mappings.filter(
    (mapping) => !channelProductKeys.has(`${mapping.channelId}::${mapping.channelProductId}`)
  ).length;

  return {
    ok: findings.filter((row) => row.severity === 'danger').length === 0,
    auditedAt: new Date().toISOString(),
    readOnly: true,
    summary: {
      masterProducts: pm.masterProducts.length,
      channelProducts: pm.channelProducts.length,
      mappings: pm.mappings.length,
      conflicts: pm.conflicts?.length || 0,
      findingCount: findings.length,
      staleChannelProducts,
      staleMappings
    },
    findings,
    safeActions: [
      'Bu rapor yalnızca okur — otomatik silme veya birleştirme yapmaz.',
      'Çift barkod ve yetim kayıtlar için Ana Ürün Havuzu → Denetim sekmelerini kullanın.',
      'Toplu temizlik öncesi db.json yedeği alın.'
    ]
  };
}

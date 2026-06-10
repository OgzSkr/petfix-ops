/**
 * Uber Eats operasyon checklist — saf fonksiyon (test + servis).
 */
export function buildUberOpsChecklist({ health, matchingStatus, readiness }) {
  const ms = matchingStatus || {};
  const hasMaster = Number(ms.masterProductCount || 0) > 0;
  const catalogSynced = Boolean(ms.uberCatalogSyncedAt);
  const manualConfirmed = ms.uberEats?.byStatus?.manual_confirmed || 0;
  const autoMatched = ms.uberEats?.byStatus?.auto_matched || 0;
  const apiOk = Boolean(health?.probe?.orders?.ok && health?.probe?.catalog?.ok);

  return [
    {
      id: 'api',
      label: 'Trendyol Go API bağlantısı',
      done: apiOk,
      detail: health?.probe?.catalog?.message || health?.message || '—',
      action: 'probe'
    },
    {
      id: 'master',
      label: 'BenimPOS ana havuz sync',
      done: hasMaster,
      detail: hasMaster
        ? `${ms.masterProductCount} ürün · ${formatSync(ms.masterSyncedAt)}`
        : 'Önce BenimPOS havuzunu güncelleyin',
      action: 'master'
    },
    {
      id: 'catalog',
      label: 'Uber mağaza katalog sync',
      done: catalogSynced,
      detail: catalogSynced
        ? `${ms.uberCatalogProductCount ?? '—'} ürün · şube ${ms.uberCatalogStoreId ?? '—'} · ${formatSync(ms.uberCatalogSyncedAt)}`
        : 'Mağaza kataloğu çekilmeden eşleştirme ve fiyat karşılaştırma eksik kalır',
      action: 'catalog'
    },
    {
      id: 'auto-match',
      label: 'Otomatik eşleştirme çalıştır',
      done: manualConfirmed + autoMatched > 0,
      detail: `${manualConfirmed} manuel · ${autoMatched} otomatik bekliyor`,
      action: 'auto-match'
    },
    {
      id: 'confirm',
      label: 'Manuel onay (BenimPOS satış kapısı)',
      done: Boolean(readiness?.readyForSales),
      detail: readiness?.readyForSales
        ? 'Satış kapısı açık — /uber-eats üzerinden gönderilebilir'
        : (readiness?.blockers?.[0] || 'Otomatik eşleşmeleri onaylayın'),
      action: 'confirm'
    }
  ];
}

function formatSync(iso) {
  if (!iso) return 'henüz yok';
  try {
    return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  } catch {
    return iso;
  }
}

/**
 * Katalog kanalları (Trendyol, Yemeksepeti) eşleştirme checklist — saf fonksiyon.
 */
export function buildCatalogMatchingOpsChecklist({
  channelId,
  channelLabel,
  catalogLabel,
  matchingStatus,
  readiness
}) {
  const ms = matchingStatus || {};
  const stats = ms.channelStats?.[channelId] || {};
  const hasMaster = Number(ms.masterProductCount || 0) > 0;
  const productCount = stats.productCount || 0;

  const catalogSyncedAt = channelId === 'yemeksepeti'
    ? ms.yemeksepetiCatalogSyncedAt
    : ms.trendyolCatalogSyncedAt;

  const catalogDone = channelId === 'yemeksepeti'
    ? Boolean(ms.yemeksepetiCatalogSyncedAt) || productCount > 0
    : Boolean(ms.trendyolCatalogSyncedAt) || productCount > 0;

  const manualConfirmed = stats.byStatus?.manual_confirmed || 0;
  const autoMatched = stats.byStatus?.auto_matched || 0;

  return [
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
      label: catalogLabel || `${channelLabel} katalog sync`,
      done: catalogDone,
      detail: catalogDone
        ? `${productCount} kanal ürünü · ${formatSync(catalogSyncedAt)}`
        : 'Katalog çekilmeden otomatik eşleştirme eksik kalır',
      action: 'catalog'
    },
    {
      id: 'auto-match',
      label: 'Otomatik eşleştirme çalıştır',
      done: manualConfirmed + autoMatched > 0,
      detail: `${manualConfirmed} onaylı · ${autoMatched} otomatik · ${stats.mappingCount || 0} toplam mapping`,
      action: 'auto-match'
    },
    {
      id: 'confirm',
      label: 'Eşleştirme kuyruğunu temizle',
      done: Boolean(readiness?.readyForSales) || (readiness?.blockers?.length === 0 && manualConfirmed > 0),
      detail: readiness?.readyForSales
        ? 'Kuyruk temiz — sipariş kârlılığında eşleştirme kullanılabilir'
        : (readiness?.blockers?.[0] || 'Otomatik eşleşmeleri onaylayın veya eksikleri tamamlayın'),
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

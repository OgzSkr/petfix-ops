/**
 * Yemeksepeti katalog sync — sayfa limiti ile parça parça ilerleme (resume).
 */

export function resolveYemeksepetiCatalogSyncOptions(pm, options = {}) {
  if (options.startPage != null || options.maxPages == null) {
    return options;
  }

  const ing = pm.meta?.channelIngest?.yemeksepeti || {};
  const nextPage = Math.max(1, Number(ing.nextPage) || 1);

  return {
    ...options,
    startPage: nextPage
  };
}

export function persistYemeksepetiCatalogResume(pm, summary = {}) {
  pm.meta.channelIngest = pm.meta.channelIngest || {};
  const prev = pm.meta.channelIngest.yemeksepeti || {};

  const totalPages = Math.max(Number(summary.totalPages) || 1, 1);
  const startPage = Math.max(1, Number(summary.startPage) || 1);
  const fetchedPages = Math.max(0, Number(summary.fetchedPages) || 0);
  const truncated = Boolean(summary.truncated);
  const lastFetchedPage = summary.lastFetchedPage != null
    ? Number(summary.lastFetchedPage)
    : (fetchedPages > 0 ? startPage + fetchedPages - 1 : startPage);

  let nextPage = 1;
  if (truncated) {
    nextPage = lastFetchedPage >= totalPages ? 1 : lastFetchedPage + 1;
  }

  pm.meta.channelIngest.yemeksepeti = {
    ...prev,
    ...summary,
    startPage,
    lastFetchedPage,
    nextPage,
    catalogComplete: !truncated,
    truncated
  };
}

export function yemeksepetiCatalogStatusLabel(meta = {}) {
  if (!meta.ingestedAt && !meta.prepared) {
    return 'Henüz katalog çekilmedi';
  }
  if (meta.truncated) {
    const page = Number(meta.lastFetchedPage) || Number(meta.fetchedPages) || '?';
    const total = Number(meta.totalPages) || '?';
    return `Katalog eksik (${page}/${total} sayfa) — sonraki sync devam edecek`;
  }
  if (meta.catalogComplete === false) {
    return 'Katalog sync tamamlanmadı';
  }
  const count = meta.prepared ?? meta.distinctProducts ?? meta.scanned ?? 0;
  return `${count} ürün · tam katalog`;
}

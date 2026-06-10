import { readDb } from '../../db/store.js';
import { getDbReadMeta } from '../../db/store.js';
import { findByBarcode } from '../../utils.js';
import { getChannelsHealth } from '../../channels/registry.js';
import { getCommissionTariffMeta } from './commission-tariff.js';
import { buildTariffSummary } from '../../commission-tariff/analysis.js';
import { matchingQueueActionItems } from '../../product-matching/matching-queue.js';
import { costsForScope, COST_SCOPE } from '../../cost-scopes.js';

function countEmptyCosts(db, scope) {
  let count = 0;
  for (const product of db.products || []) {
    const cost = findByBarcode(costsForScope(db, scope), product.barcode);
    const value = cost?.productCost;
    if (value === '' || value === null || value === undefined) {
      count += 1;
    }
  }
  return count;
}

const ACTION_SEVERITY_ORDER = { danger: 0, warning: 1, info: 2, muted: 3 };

function integrationHrefForChannel(channelId) {
  if (channelId === 'trendyol_go' || channelId === 'yemeksepeti' || channelId === 'getir') {
    return `/quick-commerce/integrations?channel=${encodeURIComponent(channelId)}`;
  }
  if (channelId === 'uber-eats') {
    return '/products/inbox?channelId=uber-eats';
  }
  return '/admin/settings';
}

export function sortActionCenterItems(items = []) {
  return [...items].sort((a, b) => {
    const sa = ACTION_SEVERITY_ORDER[a.severity] ?? 9;
    const sb = ACTION_SEVERITY_ORDER[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return Number(b.count || 0) - Number(a.count || 0);
  });
}

export function createActionCenterService({ dashboard, channelsSummary, ops, channelMatchingOps }) {
  async function buildActionCenter(searchParams) {
    const days = Number(searchParams.get('days') || 14) || 14;
    const summaryParams = new URLSearchParams({ days: String(days) });

    const [dash, channelSummary, opsStatus, db, healthRows, matchingQueue] = await Promise.all([
      dashboard.buildDashboard(),
      channelsSummary.buildChannelsSummary(summaryParams),
      ops.buildOpsStatus(),
      readDb(),
      getChannelsHealth(),
      channelMatchingOps?.getMatchingQueue?.() || Promise.resolve(null)
    ]);

    const dbMeta = getDbReadMeta();
    const tariffMeta = getCommissionTariffMeta(db);
    const tariffSummary = buildTariffSummary(db);
    const emptyCostCount = countEmptyCosts(db, COST_SCOPE.TRENDYOL_MARKETPLACE);
    const emptyChannelCostCount = countEmptyCosts(db, COST_SCOPE.OTHER_CHANNELS);
    const items = [];

    if (matchingQueue?.totals?.queue > 0) {
      items.push(...matchingQueueActionItems(matchingQueue));
    }

    const lossOrders = Number(channelSummary.totals?.loss || 0);
    if (lossOrders > 0) {
      items.push({
        id: 'loss-orders',
        severity: 'danger',
        label: 'Zarar eden sipariş',
        count: lossOrders,
        hint: `Son ${days} gün — tüm kanallar`,
        href: `/marketplace/orders?profit=loss&days=${days}`,
        action: 'Zararlı siparişler'
      });
    }

    const missingData = Number(dash.summary?.missingData || 0);
    if (missingData > 0) {
      items.push({
        id: 'missing-buybox-data',
        severity: 'warning',
        label: 'BuyBox eksik veri',
        count: missingData,
        hint: 'Trendyol takip listesinde maliyet/fiyat eksik',
        href: '/marketplace/buybox?view=catalog&catalogTab=missing',
        action: 'Eksik veriyi aç'
      });
    }

    if (emptyCostCount > 0) {
      items.push({
        id: 'empty-cost',
        severity: 'warning',
        label: 'Maliyeti eksik ürün',
        count: emptyCostCount,
        hint: 'Trendyol Pazaryeri maliyet seti',
        href: '/marketplace/products?emptyCostOnly=1',
        action: 'Ürün ayarları'
      });
    }

    if (emptyChannelCostCount > 0) {
      items.push({
        id: 'empty-channel-cost',
        severity: 'warning',
        label: 'Kanal maliyeti eksik ürün',
        count: emptyChannelCostCount,
        hint: 'Uber Eats, Yemeksepeti vb. diğer kanal maliyet seti',
        href: '/products/costs?emptyCostOnly=1',
        action: 'Kanal maliyetleri'
      });
    }

    if (tariffSummary.missingUrl > 0) {
      items.push({
        id: 'tariff-missing-url',
        severity: 'warning',
        label: 'Trendyol ürün linki eksik',
        count: tariffSummary.missingUrl,
        hint: 'BuyBox sayfa fallback için productUrl veya contentId gerekli',
        href: '/marketplace/trendyol?missingUrl=1',
        action: 'Eksik linkleri gör'
      });
    }

    if (!tariffMeta.active) {
      items.push({
        id: 'tariff-missing',
        severity: 'info',
        label: 'Komisyon tarifesi yüklenmedi',
        count: 0,
        hint: 'Trendyol tarife Excel’i henüz import edilmedi',
        href: '/marketplace/trendyol',
        action: 'Tarife yükle'
      });
    } else if (tariffSummary.missingFetchable > 0) {
      items.push({
        id: 'tariff-buybox-missing',
        severity: 'warning',
        label: 'Tarifede çekilebilir BuyBox eksik',
        count: tariffSummary.missingFetchable,
        hint: `${tariffSummary.withBuybox}/${tariffSummary.total} canlı fiyat · ${tariffSummary.missingOffSale || 0} satışta değil`,
        href: '/marketplace/trendyol?fetchableMissing=1',
        action: 'Eksikleri güncelle'
      });
    } else if (tariffSummary.missingOffSale > 0) {
      items.push({
        id: 'tariff-off-sale',
        severity: 'muted',
        label: 'Satışta olmayan tarife ürünleri',
        count: tariffSummary.missingOffSale,
        hint: 'Stok 0 / satışta değil — Trendyol BuyBox API veri döndürmez',
        href: '/marketplace/trendyol?missingBuybox=1',
        action: 'Listeyi gör'
      });
    }

    const apiMissing = healthRows.filter((row) => {
      if (row.status === 'planned') return false;
      return !row.health?.configured;
    });

    for (const channel of apiMissing) {
      items.push({
        id: `api-${channel.id}`,
        severity: channel.status === 'planned' ? 'muted' : 'warning',
        label: `${channel.label} API eksik`,
        count: 0,
        hint: channel.status === 'planned'
          ? 'Bağlantı kurulunca sipariş ve kârlılık takibi başlar'
          : 'Sipariş sync için kimlik bilgisi gerekli',
        href: integrationHrefForChannel(channel.id),
        action: channel.id === 'uber-eats' ? 'Gelen kutusu' : 'Entegrasyonlar'
      });
    }

    const channelsWithoutOrders = (channelSummary.channels || []).filter((row) =>
      row.configured && row.available && row.stats && Number(row.stats.count || 0) === 0
    );
    for (const channel of channelsWithoutOrders) {
      if (channel.id === 'trendyol-marketplace') continue;
      items.push({
        id: `no-data-${channel.id}`,
        severity: 'info',
        label: `${channel.label} — dönemde sipariş yok`,
        count: 0,
        hint: channel.message || 'API bağlı, seçili dönemde kayıt gelmedi',
        href: channel.route || '/dashboard',
        action: 'Kanalı aç'
      });
    }

    if (dbMeta.fallback || dbMeta.error === 'parity_mismatch') {
      const parity = dbMeta.parity;
      const mismatchHint = parity?.mismatches?.length
        ? parity.mismatches.map((m) => `${m.table || m.key}: JSON ${m.json} / SQLite ${m.sqlite}`).join(' · ')
        : 'SQLite ve JSON kayıt sayıları uyuşmuyor';

      items.push({
        id: 'db-parity',
        severity: 'warning',
        label: 'Veritabanı parity uyarısı',
        count: parity?.mismatches?.length || parity?.collectionMismatches?.length || 1,
        hint: `${mismatchHint}. JSON fallback kullanılıyor.`,
        href: '/dashboard#system-status',
        action: 'Sistem durumu'
      });
    }

    if (!opsStatus.worker?.running && opsStatus.worker?.configured) {
      items.push({
        id: 'worker-offline',
        severity: 'warning',
        label: 'Canlı BuyBox worker kapalı',
        count: 0,
        hint: 'BuyBox fiyatları güncellenmeyebilir',
        href: '/admin/settings',
        action: 'Worker başlat'
      });
    } else if (opsStatus.worker?.missingCredentials?.length) {
      items.push({
        id: 'worker-credentials',
        severity: 'warning',
        label: 'BuyBox worker kimlik bilgisi eksik',
        count: opsStatus.worker.missingCredentials.length,
        hint: 'Trendyol API alanlarını tamamlayın',
        href: '/admin/settings',
        action: 'API bilgileri'
      });
    }

    return {
      updatedAt: new Date().toISOString(),
      days,
      items: sortActionCenterItems(items),
      totals: {
        lossOrders,
        missingData,
        emptyCostCount,
        emptyChannelCostCount,
        tariffMissingBuybox: tariffSummary.missingBuybox || 0,
        tariffMissingUrl: tariffSummary.missingUrl || 0,
        matchingQueue: matchingQueue?.totals?.queue || 0
      },
      matchingQueue
    };
  }

  return { buildActionCenter };
}

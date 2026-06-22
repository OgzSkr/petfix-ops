import { readDb, getDbReadMeta } from '../../db/store.js';
import { findByBarcode } from '../../utils.js';
import { getChannelsHealth } from '../../channels/registry.js';
import { matchingQueueActionItems } from '../../product-matching/matching-queue.js';
import { costsForScope, COST_SCOPE } from '../../cost-scopes.js';
import { sortActionCenterItems } from './action-center.js';

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

function integrationHrefForChannel(channelId) {
  const id = String(channelId || '').trim();
  if (id === 'trendyol_go' || id === 'uber-eats' || id === 'yemeksepeti' || id === 'getir') {
    const panelChannel = id === 'trendyol_go' ? 'uber-eats' : id;
    return `/admin/settings?channel=${encodeURIComponent(panelChannel)}`;
  }
  return '/admin/settings';
}

export function createOpsActionCenterService({ channelsSummary, ops, channelMatchingOps }) {
  async function buildActionCenter(searchParams) {
    const days = Number(searchParams.get('days') || 14) || 14;
    const summaryParams = new URLSearchParams({ days: String(days) });

    const [channelSummary, opsStatus, db, healthRows, matchingQueue] = await Promise.all([
      channelsSummary.buildChannelsSummary(summaryParams),
      ops.buildOpsStatus(),
      readDb(),
      getChannelsHealth(),
      channelMatchingOps?.getMatchingQueue?.() || Promise.resolve(null)
    ]);

    const dbMeta = getDbReadMeta();
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
        hint: `Son ${days} gün — HzlMrktOps kanalları`,
        href: `/hzlmrktops/siparisler?profit=loss&days=${days}`,
        action: 'Zararlı siparişler'
      });
    }

    if (emptyChannelCostCount > 0) {
      items.push({
        id: 'empty-channel-cost',
        severity: 'warning',
        label: 'Kanal maliyeti eksik ürün',
        count: emptyChannelCostCount,
        hint: 'Uber Eats, Yemeksepeti vb. kanal maliyet seti',
        href: '/hzlmrktops/urunler',
        action: 'BenimPOS ürünleri'
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
      items.push({
        id: `no-data-${channel.id}`,
        severity: 'info',
        label: `${channel.label} — dönemde sipariş yok`,
        count: 0,
        hint: channel.message || 'API bağlı, seçili dönemde kayıt gelmedi',
        href: channel.route || '/hzlmrktops',
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
        href: '/admin/status',
        action: 'Sistem durumu'
      });
    }

    return {
      updatedAt: new Date().toISOString(),
      days,
      items: sortActionCenterItems(items),
      totals: {
        lossOrders,
        emptyChannelCostCount,
        matchingQueue: matchingQueue?.totals?.queue || 0
      },
      matchingQueue
    };
  }

  return { buildActionCenter };
}

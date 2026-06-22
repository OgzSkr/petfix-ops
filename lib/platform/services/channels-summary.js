import { listChannels, getChannelAdapter } from '../../channels/registry.js';
import { CHANNEL_SCOPE } from '../brand.js';
import { readDb } from '../../db/store.js';
import { toPositiveInteger } from '../../utils.js';

function buildSearchParams(days, force = false) {
  const params = new URLSearchParams();
  params.set('days', String(days));
  if (force) params.set('force', '1');
  return params;
}

function aggregateTotals(channelRows) {
  let count = 0;
  let totalSales = 0;
  let totalProfit = 0;
  let profitable = 0;
  let loss = 0;

  for (const row of channelRows) {
    if (!row.stats) continue;
    count += Number(row.stats.count || 0);
    totalSales += Number(row.stats.totalSales || 0);
    totalProfit += Number(row.stats.totalProfit || 0);
    profitable += Number(row.stats.profitable || 0);
    loss += Number(row.stats.loss || 0);
  }

  const avgProfit = count ? Math.round((totalProfit / count) * 100) / 100 : 0;
  const profitRate = totalSales ? Math.round((totalProfit / totalSales) * 10000) / 100 : 0;

  return {
    count,
    totalSales: Math.round(totalSales * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    avgProfit,
    profitRate,
    profitable,
    loss
  };
}

export function createChannelsSummaryService({ orders, channelOrders }) {
  async function buildChannelsSummary(searchParams) {
    const days = toPositiveInteger(searchParams.get('days') || 14, 14);
    const force = searchParams.get('force') === '1';
    const params = buildSearchParams(days, force);
    const db = await readDb();
    const channels = [];

    for (const channel of listChannels()) {
      const adapter = getChannelAdapter(channel.id);
      const health = adapter ? await adapter.healthCheck() : { configured: false, message: 'Adapter yok' };
      const entry = {
        id: channel.id,
        label: channel.label,
        route: channel.route,
        scope: channel.scope,
        status: channel.status,
        configured: Boolean(health.configured),
        available: false,
        skipped: false,
        message: health.message || '',
        stats: null,
        orderCount: 0,
        range: null
      };

      if (channel.status !== 'active') {
        entry.message = entry.message || 'Kanal henüz aktif değil';
        channels.push(entry);
        continue;
      }

      if (channel.scope === CHANNEL_SCOPE.ORDERS_PROFIT) {
        if (!health.configured) {
          entry.message = health.message || 'API bilgileri eksik';
        } else {
          try {
            const result = await channelOrders.listChannelOrders(channel.id, params);
            entry.available = true;
            entry.skipped = Boolean(result.skipped);
            entry.message = result.skipped ? result.message : entry.message;
            entry.stats = result.stats || null;
            entry.orderCount = result.total ?? result.rows?.length ?? 0;
            entry.range = result.range || null;
          } catch (error) {
            entry.message = error.message || 'Sipariş özeti alınamadı';
          }
        }
      }

      channels.push(entry);
    }

    const activeChannels = channels.filter((row) => row.available && row.stats);
    const totals = aggregateTotals(activeChannels);

    return {
      updatedAt: new Date().toISOString(),
      days,
      force,
      totals,
      activeChannelCount: activeChannels.length,
      costs: {
        channelCosts: (db.channelCosts || []).length
      },
      channels
    };
  }

  return { buildChannelsSummary };
}

import { listChannels, getChannelAdapter } from '../../channels/registry.js';
import { CHANNEL_SCOPE } from '../brand.js';
import { orderDetailPageUrl } from '../orders-url.js';
import { toPositiveInteger } from '../../utils.js';
import { computeProfitConfidence } from '../../production/profit-confidence.js';
import {
  buildCumulativeHourlyTimeline,
  buildLivePerformanceStats,
  filterRowsByOrderDate,
  resolveOrderDateRangeForChannel
} from '../../order-profitability.js';

function buildSearchParams(days, force = false) {
  const params = new URLSearchParams();
  params.set('days', String(days));
  if (force) params.set('force', '1');
  return params;
}

function annotateRows(rows, channel) {
  return (rows || []).map((row) => ({
    ...row,
    channelId: channel.id,
    channelLabel: channel.label,
    channelRoute: channel.route || '',
    ordersRoute: channel.ordersRoute || channel.route || ''
  }));
}

function slimLiveRow(row, days = 1) {
  return {
    orderNumber: row.orderNumber,
    orderDateMs: row.orderDateMs,
    orderDate: row.orderDate,
    salesAmount: row.salesAmount,
    netProfit: row.netProfit,
    profitRate: row.profitRate,
    profitMargin: row.profitMargin,
    profitConfidence: row.profitConfidence || computeProfitConfidence(row),
    channelId: row.channelId,
    channelLabel: row.channelLabel,
    channelRoute: row.channelRoute,
    orderDetailUrl: orderDetailPageUrl(row.channelId, row.orderNumber, { days }),
    status: row.status
  };
}

function buildChannelBreakdown(rows, channels) {
  const byChannel = {
    all: {
      label: 'Tümü',
      stats: buildLivePerformanceStats(rows),
      timeline: buildCumulativeHourlyTimeline(rows),
      totalRows: rows.length
    }
  };

  for (const channel of channels) {
    const channelRows = rows.filter((row) => row.channelId === channel.id);
    if (!channelRows.length) continue;
    byChannel[channel.id] = {
      label: channel.label,
      stats: buildLivePerformanceStats(channelRows),
      timeline: buildCumulativeHourlyTimeline(channelRows),
      totalRows: channelRows.length
    };
  }

  return byChannel;
}

function filterRowsForRequestedDays(rows, days) {
  const grouped = new Map();

  for (const row of rows || []) {
    const channelId = row.channelId || 'trendyol-marketplace';
    if (!grouped.has(channelId)) grouped.set(channelId, []);
    grouped.get(channelId).push(row);
  }

  const filtered = [];
  for (const [channelId, channelRows] of grouped) {
    const range = resolveOrderDateRangeForChannel(channelId, { days });
    filtered.push(...filterRowsByOrderDate(channelRows, range));
  }

  filtered.sort((a, b) => (b.orderDateMs || 0) - (a.orderDateMs || 0));
  return filtered;
}

export function createLivePerformanceService({ orders, channelOrders }) {
  async function fetchMergedOrderRows(params) {
    const merged = [];
    const channels = [];

    for (const channel of listChannels()) {
      const adapter = getChannelAdapter(channel.id);
      const health = adapter ? await adapter.healthCheck() : { configured: false, ok: false };
      const entry = {
        id: channel.id,
        label: channel.label,
        route: channel.route || '',
        configured: Boolean(health.configured),
        available: false,
        skipped: false,
        count: 0,
        message: health.message || ''
      };

      if (channel.scope === CHANNEL_SCOPE.FULL && channel.id === 'trendyol-marketplace') {
        try {
          const result = await orders.listOrders(params);
          const rows = annotateRows(result.rows, channel);
          merged.push(...rows);
          entry.available = true;
          entry.skipped = Boolean(result.skipped);
          entry.count = rows.length;
          entry.message = result.skipped ? result.message : entry.message;
        } catch (error) {
          entry.message = error.message || 'Trendyol siparişleri alınamadı';
        }
      } else if (channel.scope === CHANNEL_SCOPE.ORDERS_PROFIT) {
        if (!health.configured) {
          entry.message = health.message || 'API bilgileri eksik';
        } else {
          try {
            const result = await channelOrders.listChannelOrders(channel.id, params);
            const rows = annotateRows(result.rows, channel);
            merged.push(...rows);
            entry.available = true;
            entry.skipped = Boolean(result.skipped);
            entry.count = rows.length;
            entry.message = result.skipped ? result.message : entry.message;
          } catch (error) {
            entry.message = error.message || 'Siparişler alınamadı';
          }
        }
      }

      channels.push(entry);
    }

    merged.sort((a, b) => (b.orderDateMs || 0) - (a.orderDateMs || 0));
    return { rows: merged, channels };
  }

  async function buildLivePerformance(searchParams) {
    const days = toPositiveInteger(searchParams.get('days') || 1, 1);
    const force = searchParams.get('force') === '1';
    const params = buildSearchParams(days, force);
    const { rows: fetchedRows, channels } = await fetchMergedOrderRows(params);
    const rows = filterRowsForRequestedDays(fetchedRows, days);

    for (const entry of channels) {
      if (!entry.available) continue;
      entry.count = rows.filter((row) => row.channelId === entry.id).length;
    }

    const stats = buildLivePerformanceStats(rows);
    const timeline = buildCumulativeHourlyTimeline(rows);
    const byChannel = buildChannelBreakdown(rows, channels);
    const allRows = rows.map((row) => slimLiveRow(row, days));

    return {
      updatedAt: new Date().toISOString(),
      days,
      force,
      stats,
      timeline,
      byChannel,
      allRows,
      rows: allRows.slice(0, 100),
      totalRows: rows.length,
      channels
    };
  }

  return { buildLivePerformance };
}

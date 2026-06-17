import { getChannel, getChannelAdapter } from '../../channels/registry.js';
import { HZLMRKTOPS_BUYBOX_CHANNEL_IDS } from '../../hzlmrktops/constants.js';
import { assessOrderRow, summarizeDataQuality } from '../../data-quality.js';
import {
  buildOrderStats,
  buildOrderTimeline,
  filterRowsByOrderDate,
  orderDateTimezoneForChannel,
  orderRowToCsv,
  resolveOrderDateRangeForChannel
} from '../../order-profitability.js';
import { summarizeProfitConfidence } from '../../production/profit-confidence.js';
import { summarizeOrderLineMatching } from '../../product-matching/resolve.js';
import { toPositiveInteger } from '../../utils.js';
import { enrichOrderRowsWithLineMeta } from '../../channels/order-line-images.js';
import { canListOpsOrders } from '../../channels/ops-orders-bridge.js';

function filterMergedRowsByRange(rows, range) {
  if (!range?.startDate && !range?.endDate) return rows;
  return rows.filter((row) => {
    const ms = Number(row.orderDateMs) || 0;
    if (!ms) return false;
    if (range.startDate && ms < range.startDate) return false;
    if (range.endDate && ms > range.endDate) return false;
    return true;
  });
}

async function loadHzlMrktOpsChannelOrders(channelId, channelOrders, searchParams) {
  const channel = getChannel(channelId);
  if (!channel) return null;

  const adapter = getChannelAdapter(channelId);
  const health = adapter ? await adapter.healthCheck() : { configured: false, message: 'Adapter yok' };
  const entry = {
    id: channelId,
    label: channel.label,
    route: channel.route,
    status: channel.status,
    configured: Boolean(health.configured),
    available: false,
    skipped: false,
    total: 0,
    stats: null,
    orderSources: null,
    message: health.message || ''
  };

  if (channel.status !== 'active') {
    entry.message = entry.message || 'Kanal henüz aktif değil';
    return { entry, rows: [], fetched: 0, skipped: false, cooldownSeconds: 0, message: '' };
  }

  const opsOrdersOnly = !health.configured && await canListOpsOrders(channelId);
  if (!health.configured && !opsOrdersOnly) {
    return { entry, rows: [], fetched: 0, skipped: false, cooldownSeconds: 0, message: '' };
  }

  if (opsOrdersOnly) {
    entry.configured = true;
    entry.message = health.message || 'Ops kayıtlarından siparişler';
  }

  try {
    const result = await channelOrders.listChannelOrders(channelId, searchParams);
    entry.available = true;
    entry.skipped = Boolean(result.skipped);
    entry.total = result.total ?? result.rows?.length ?? 0;
    entry.stats = result.stats || null;
    entry.orderSources = result.orderSources || null;
    return {
      entry,
      rows: result.rows || [],
      fetched: Number(result.fetched ?? result.rows?.length ?? 0),
      skipped: Boolean(result.skipped),
      cooldownSeconds: Number(result.cooldownSeconds) || 0,
      message: result.message || ''
    };
  } catch (error) {
    entry.message = error.message || 'Siparişler alınamadı';
    return { entry, rows: [], fetched: 0, skipped: false, cooldownSeconds: 0, message: '' };
  }
}

export function createHzlMrktOpsOrdersService({ channelOrders }) {
  async function listHzlMrktOpsOrders(searchParams) {
    const channelFilter = String(searchParams.get('channel') || 'all').trim();
    const days = searchParams.get('days');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const channelIds = HZLMRKTOPS_BUYBOX_CHANNEL_IDS.filter(
      (channelId) => channelFilter === 'all' || channelFilter === channelId
    );

    const channelResults = await Promise.all(
      channelIds.map((channelId) => loadHzlMrktOpsChannelOrders(channelId, channelOrders, searchParams))
    );

    const mergedRows = [];
    const channels = [];
    let fetchedTotal = 0;
    let skippedAny = false;
    let cooldownSeconds = 0;
    let skipMessage = '';

    for (const result of channelResults) {
      if (!result) continue;
      channels.push(result.entry);
      mergedRows.push(...result.rows);
      fetchedTotal += result.fetched;
      if (result.skipped) {
        skippedAny = true;
        skipMessage = result.message || skipMessage;
        cooldownSeconds = Math.max(cooldownSeconds, result.cooldownSeconds);
      }
    }

    mergedRows.sort((a, b) => (b.orderDateMs || 0) - (a.orderDateMs || 0));

    const rangeAnchor = channelFilter !== 'all' ? channelFilter : 'uber-eats';
    const range = resolveOrderDateRangeForChannel(rangeAnchor, {
      days: days ? toPositiveInteger(days, 14) : undefined,
      startDate,
      endDate
    });
    const orderDateTimezone = orderDateTimezoneForChannel(rangeAnchor);

    const rows = channelFilter === 'all'
      ? filterMergedRowsByRange(mergedRows, range)
      : filterRowsByOrderDate(mergedRows, range);

    const statuses = [...new Set(rows.map((row) => row.status).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'tr-TR')
    );

    const dataQuality = summarizeDataQuality(rows, assessOrderRow);
    const profitConfidence = summarizeProfitConfidence(rows);
    const matchingSummary = summarizeOrderLineMatching(rows);

    return {
      channel: 'hzlmrktops',
      channelLabel: 'HzlMrktOps',
      channelFilter,
      updatedAt: new Date().toISOString(),
      range: {
        startMs: range.startDate,
        endMs: range.endDate,
        startDate: new Date(range.startDate).toISOString(),
        endDate: new Date(range.endDate).toISOString(),
        days: days ? toPositiveInteger(days, 14) : null
      },
      fetched: fetchedTotal,
      total: rows.length,
      skipped: skippedAny,
      cooldownSeconds: skippedAny ? cooldownSeconds : 0,
      message: skippedAny ? skipMessage : '',
      statuses,
      stats: buildOrderStats(rows),
      profitConfidence,
      matchingSummary,
      dataQuality,
      timeline: {
        day: buildOrderTimeline(rows, 'day', orderDateTimezone),
        week: buildOrderTimeline(rows, 'week', orderDateTimezone)
      },
      channels,
      rows
    };
  }

  async function sendHzlMrktOpsOrdersCsvExport(response, searchParams) {
    const result = await listHzlMrktOpsOrders(searchParams);
    const status = String(searchParams.get('status') || '').trim();
    const profit = String(searchParams.get('profit') || '').trim();
    let rows = result.rows;

    if (status) rows = rows.filter((row) => String(row.status) === status);
    if (profit === 'profit') rows = rows.filter((row) => row.netProfit > 0);
    if (profit === 'loss') rows = rows.filter((row) => row.netProfit < 0);
    if (profit === 'zero') rows = rows.filter((row) => row.netProfit === 0);

    const csv = orderRowToCsv(rows);
    const label = result.range.days ? `${result.range.days}gun` : 'ozel';

    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hzlmrktops-siparis-karlilik-${label}.csv"`
    });
    response.end(csv);
  }

  return {
    listHzlMrktOpsOrders,
    sendHzlMrktOpsOrdersCsvExport
  };
}

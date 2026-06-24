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
import { readDb } from '../../db/store.js';

let opsOrdersBridgePromise = null;
function loadOpsOrdersBridge() {
  if (!opsOrdersBridgePromise) {
    opsOrdersBridgePromise = import('../../channels/ops-orders-bridge.js');
  }
  return opsOrdersBridgePromise;
}

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

async function buildChannelEntries(channelIds, healthCheckForChannel) {
  const { canListOpsOrders } = await loadOpsOrdersBridge();
  const entries = [];
  for (const channelId of channelIds) {
    const channel = getChannel(channelId);
    if (!channel) continue;
    const adapter = getChannelAdapter(channelId);
    const health = healthCheckForChannel
      ? await healthCheckForChannel(channelId, adapter)
      : (adapter ? await adapter.healthCheck() : { configured: false, message: 'Adapter yok' });
    entries.push({
      id: channelId,
      label: channel.label,
      route: channel.route,
      status: channel.status,
      configured: Boolean(health.configured) || await canListOpsOrders(channelId),
      available: channel.status === 'active',
      skipped: false,
      total: 0,
      stats: null,
      orderSources: null,
      message: health.message || ''
    });
  }
  return entries;
}

async function refreshChannelsIfForced(channelIds, deps, searchParams) {
  if (searchParams.get('force') !== '1' || !deps?.listChannelOrders) return;
  await Promise.allSettled(
    channelIds.map((channelId) => deps.listChannelOrders(channelId, searchParams))
  );
}

async function loadHzlMrktOpsChannelOrders(channelId, channelOrders, searchParams, healthCheckForChannel) {
  const channel = getChannel(channelId);
  if (!channel) return null;

  const adapter = getChannelAdapter(channelId);
  const health = healthCheckForChannel
    ? await healthCheckForChannel(channelId, adapter)
    : (adapter ? await adapter.healthCheck() : { configured: false, message: 'Adapter yok' });
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

  const opsOrdersOnly = !health.configured && await (await loadOpsOrdersBridge()).canListOpsOrders(channelId);
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
      getirSync: result.getirSync || null,
      fetched: Number(result.fetched ?? result.rows?.length ?? 0),
      skipped: Boolean(result.skipped),
      cooldownSeconds: Number(result.cooldownSeconds) || 0,
      message: result.message || ''
    };
  } catch (error) {
    entry.message = error.message || 'Siparişler alınamadı';
    return { entry, rows: [], getirSync: null, fetched: 0, skipped: false, cooldownSeconds: 0, message: '' };
  }
}

async function listHzlMrktOpsOrdersFromOpsDb(searchParams, deps = {}) {
  const {
    analyzeOpsDbOrderRows,
    listOpsProfitOrdersPaginated
  } = await loadOpsOrdersBridge();
  const { listChannelOrders, healthCheckForChannel } = deps;
  const channelFilter = String(searchParams.get('channel') || 'all').trim();
  const days = searchParams.get('days');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const lifecycle = searchParams.get('lifecycle') === 'completed' ? 'completed' : 'active';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(5, Number(searchParams.get('limit')) || 25));
  const q = String(searchParams.get('q') || '').trim();
  const status = String(searchParams.get('status') || '').trim();

  const channelIds = HZLMRKTOPS_BUYBOX_CHANNEL_IDS.filter(
    (channelId) => channelFilter === 'all' || channelFilter === channelId
  );

  await refreshChannelsIfForced(channelIds, { listChannelOrders }, searchParams);

  const opsPage = await listOpsProfitOrdersPaginated({
    channelFilter,
    days: days ? toPositiveInteger(days, 14) : undefined,
    startDate,
    endDate,
    lifecycle,
    page,
    limit,
    q
  });
  if (!opsPage) return null;

  const db = await readDb();
  let rows = await analyzeOpsDbOrderRows(opsPage.dbRows, db);
  if (status) {
    rows = rows.filter((row) => String(row.status) === status);
  }

  const rangeAnchor = channelFilter !== 'all' ? channelFilter : 'uber-eats';
  const range = resolveOrderDateRangeForChannel(rangeAnchor, {
    days: days ? toPositiveInteger(days, 14) : undefined,
    startDate,
    endDate
  });
  const orderDateTimezone = orderDateTimezoneForChannel(rangeAnchor);
  const channels = await buildChannelEntries(channelIds, healthCheckForChannel);

  const statuses = [...new Set(rows.map((row) => row.status).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'tr-TR')
  );

  return {
    channel: 'hzlmrktops',
    channelLabel: 'HzlMrktOps',
    channelFilter,
    paginated: true,
    getirSync: null,
    updatedAt: new Date().toISOString(),
    range: {
      startMs: range.startDate,
      endMs: range.endDate,
      startDate: new Date(range.startDate).toISOString(),
      endDate: new Date(range.endDate).toISOString(),
      days: days ? toPositiveInteger(days, 14) : null
    },
    fetched: opsPage.total,
    total: opsPage.total,
    page: opsPage.page,
    limit: opsPage.limit,
    totalPages: opsPage.totalPages,
    lifecycleCounts: opsPage.lifecycleCounts,
    skipped: false,
    cooldownSeconds: 0,
    message: '',
    statuses,
    stats: buildOrderStats(rows),
    profitConfidence: summarizeProfitConfidence(rows),
    matchingSummary: summarizeOrderLineMatching(rows),
    dataQuality: summarizeDataQuality(rows, assessOrderRow),
    timeline: {
      day: buildOrderTimeline(rows, 'day', orderDateTimezone),
      week: buildOrderTimeline(rows, 'week', orderDateTimezone)
    },
    channels,
    rows
  };
}

export function createHzlMrktOpsOrdersService({
  channelOrders,
  healthCheckForChannel = null,
  useOpsOrdersDb = true
}) {
  async function listHzlMrktOpsOrders(searchParams) {
    const { canListOpsOrders } = await loadOpsOrdersBridge();
    const opsListEnabled = useOpsOrdersDb && await canListOpsOrders('getir');
    if (opsListEnabled) {
      const paginated = await listHzlMrktOpsOrdersFromOpsDb(searchParams, {
        listChannelOrders: (channelId, params) => channelOrders.listChannelOrders(channelId, params),
        healthCheckForChannel
      });
      if (paginated) return paginated;
    }

    const channelFilter = String(searchParams.get('channel') || 'all').trim();
    const days = searchParams.get('days');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const channelIds = HZLMRKTOPS_BUYBOX_CHANNEL_IDS.filter(
      (channelId) => channelFilter === 'all' || channelFilter === channelId
    );

    const channelResults = await Promise.all(
      channelIds.map((channelId) => loadHzlMrktOpsChannelOrders(
        channelId,
        channelOrders,
        searchParams,
        healthCheckForChannel
      ))
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
    const getirChannel = channelResults.find((result) => result?.entry?.id === 'getir');

    return {
      channel: 'hzlmrktops',
      channelLabel: 'HzlMrktOps',
      channelFilter,
      getirSync: getirChannel?.getirSync || null,
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
    const exportParams = new URLSearchParams(searchParams);
    exportParams.delete('page');
    exportParams.set('limit', '200');

    let rows = [];
    let range = null;
    for (let page = 1; ; page += 1) {
      exportParams.set('page', String(page));
      const result = await listHzlMrktOpsOrders(exportParams);
      range = result.range;
      rows.push(...result.rows);
      if (!result.paginated || page >= (result.totalPages || 1)) break;
    }

    const status = String(searchParams.get('status') || '').trim();
    const profit = String(searchParams.get('profit') || '').trim();

    if (status) rows = rows.filter((row) => String(row.status) === status);
    if (profit === 'profit') rows = rows.filter((row) => row.netProfit > 0);
    if (profit === 'loss') rows = rows.filter((row) => row.netProfit < 0);
    if (profit === 'zero') rows = rows.filter((row) => row.netProfit === 0);

    const csv = orderRowToCsv(rows);
    const label = range?.days ? `${range.days}gun` : 'ozel';

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

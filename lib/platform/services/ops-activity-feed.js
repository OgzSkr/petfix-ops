import { randomUUID } from 'node:crypto';
import { getOpsHubPool, isOpsHubReady } from '../../ops-hub/bootstrap.js';
import { listShadowEvents } from '../../ops-hub/db/repository.js';
import { getBranchBySlug } from '../../ops-hub/branches/branch-repository.js';

const MAX_EVENTS = 200;

const CHANNEL_LABELS = {
  getir: 'Getir',
  yemeksepeti: 'Yemeksepeti',
  trendyol_go: 'Trendyol Go'
};

const SHADOW_EVENT_LABELS = {
  getir_order_new: 'Getir webhook — yeni sipariş',
  getir_order_cancelled: 'Getir webhook — iptal',
  webhook_ingest: 'Webhook ingest',
  webhook_duplicate: 'Webhook tekrarı',
  webhook_update: 'Webhook güncelleme',
  shadow_simulation: 'Shadow simülasyon',
  shadow_issue: 'Shadow uyarı',
  benimpos_sale_simulation: 'BenimPOS satış (simülasyon)',
  benimpos_sale_write: 'BenimPOS satış (canlı)',
  stock_push_simulation: 'Stok push (simülasyon)',
  stock_push_write: 'Stok push (canlı)',
  channel_status_simulation: 'Kanal durumu (simülasyon)',
  channel_status_write: 'Kanal durumu (canlı)'
};

function ensureFeed(runtime) {
  if (!Array.isArray(runtime.opsActivityEvents)) {
    runtime.opsActivityEvents = [];
  }
  return runtime.opsActivityEvents;
}

function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel || '';
}

function normalizeEvent(input = {}) {
  const at = input.at || new Date().toISOString();
  return {
    id: input.id || randomUUID(),
    at,
    kind: input.kind || 'info',
    channel: input.channel || null,
    channelLabel: channelLabel(input.channel),
    title: String(input.title || 'Sistem olayı'),
    detail: String(input.detail || ''),
    ok: input.ok !== false,
    source: input.source || 'runtime',
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
  };
}

function shadowEventToActivity(row) {
  const payload = row.payload || {};
  const channel = payload.channel || null;
  const title = SHADOW_EVENT_LABELS[row.event_type] || row.event_type || 'Shadow olayı';
  let detail = '';
  if (payload.type) detail = payload.type;
  if (payload.kind) detail = detail ? `${detail} · ${payload.kind}` : payload.kind;
  if (!detail && row.order_id) detail = `Sipariş ${String(row.order_id).slice(0, 8)}…`;

  return normalizeEvent({
    id: row.id,
    at: row.created_at,
    kind: 'shadow',
    channel,
    title,
    detail,
    ok: row.event_type !== 'shadow_issue',
    source: 'shadow_db',
    meta: { eventType: row.event_type, orderId: row.order_id || null }
  });
}

function summarizeChannelPollResult(channel, result = {}) {
  if (result.error) {
    return `${channelLabel(channel)}: ${result.error}`;
  }
  const parts = [];
  if (Number(result.ingested) > 0) parts.push(`${result.ingested} yeni`);
  if (Number(result.duplicates) > 0) parts.push(`${result.duplicates} güncelleme`);
  if (Number(result.active?.refreshed) > 0) parts.push(`${result.active.refreshed} aktif yenilendi`);
  if (Number(result.fetched) > 0 && !parts.length) parts.push(`${result.fetched} kayıt tarandı`);
  if (!parts.length) parts.push('değişiklik yok');
  return `${channelLabel(channel)}: ${parts.join(', ')}`;
}

export function activityEventsFromPollReport(report = {}) {
  const at = report.finishedAt || new Date().toISOString();
  const channels = report.channels || {};
  const details = Object.entries(channels)
    .filter(([name]) => !String(name).endsWith('_delivered'))
    .map(([name, result]) => summarizeChannelPollResult(name, result));

  const events = [
    normalizeEvent({
      kind: 'poll',
      title: report.ok ? 'Kanal poll tamamlandı' : 'Kanal poll hatalı',
      detail: details.join(' · ') || (report.errors?.[0] || 'Poll çalıştı'),
      ok: report.ok !== false,
      at,
      meta: { errors: report.errors || [] }
    })
  ];

  for (const [name, result] of Object.entries(channels)) {
    if (String(name).endsWith('_delivered')) continue;
    if (result?.error) continue;
    const ingested = Number(result.ingested || 0);
    const refreshed = Number(result.active?.refreshed || 0);
    if (ingested <= 0 && refreshed <= 0) continue;
    events.push(
      normalizeEvent({
        kind: 'poll',
        channel: name,
        title: `${channelLabel(name)} poll`,
        detail: summarizeChannelPollResult(name, result),
        ok: true,
        at,
        meta: { ingested, refreshed }
      })
    );
  }

  return events;
}

export function activityEventFromGetirSync(summary = {}, report = {}) {
  const messages = summary.messages || [];
  const detail = messages.length
    ? messages.join(' · ')
    : `${summary.ingested || 0} yeni, ${summary.fetched || 0} taranan`;
  const hasFailure = (summary.failed || 0) > 0 || messages.some((m) => /yazılamadı|eksik|hata/i.test(m));

  return normalizeEvent({
    kind: report.delivered ? 'backfill' : 'sync',
    channel: 'getir',
    title: report.delivered ? 'Getir geçmiş senkronu' : 'Getir canlı senkron',
    detail,
    ok: summary.apiReady !== false && !hasFailure,
    meta: {
      ingested: summary.ingested || 0,
      fetched: summary.fetched || 0,
      failed: summary.failed || 0
    }
  });
}

export function activityEventFromGetirWebhook(result = {}) {
  return normalizeEvent({
    kind: 'webhook',
    channel: 'getir',
    title: result.duplicate ? 'Getir webhook güncelleme' : 'Getir webhook — yeni sipariş',
    detail: result.message || (result.duplicate ? 'Mevcut sipariş güncellendi' : 'Sipariş ingest edildi'),
    ok: result.ok !== false,
    meta: {
      orderId: result.orderId || null,
      duplicate: Boolean(result.duplicate),
      kind: result.kind || null
    }
  });
}

export function createOpsActivityFeedService({ runtime }) {
  function append(input) {
    const feed = ensureFeed(runtime);
    const event = normalizeEvent(input);
    feed.unshift(event);
    if (feed.length > MAX_EVENTS) feed.length = MAX_EVENTS;
    return event;
  }

  function appendMany(items = []) {
    return items.map((item) => append(item));
  }

  async function buildFeed({ limit = 50, includeShadow = true, branchSlug = 'main' } = {}) {
    const cap = Math.min(Math.max(1, Number(limit) || 50), MAX_EVENTS);
    const runtimeEvents = ensureFeed(runtime).slice(0, cap);
    let shadowEvents = [];

    if (includeShadow && isOpsHubReady()) {
      try {
        const pool = getOpsHubPool();
        const branch = await getBranchBySlug(pool, branchSlug);
        if (branch?.id) {
          const rows = await listShadowEvents(pool, { branchId: branch.id, limit: cap });
          shadowEvents = rows.map(shadowEventToActivity);
        }
      } catch {
        shadowEvents = [];
      }
    }

    const merged = [...runtimeEvents, ...shadowEvents]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, cap);

    return {
      ok: true,
      events: merged,
      runtimeCount: runtimeEvents.length,
      shadowCount: shadowEvents.length
    };
  }

  return { append, appendMany, buildFeed };
}

let boundOpsActivityFeed = null;

export function bindOpsActivityFeed(service) {
  boundOpsActivityFeed = service || null;
}

export function appendOpsActivityIfBound(input) {
  if (!boundOpsActivityFeed) return null;
  return boundOpsActivityFeed.append(input);
}

'use strict';

const bootstrap = window.__OPS_SYSTEM__ || { authRequired: true };
const ops = window.OpsCommon;

const modePill = document.getElementById('systemModePill');
const modeLabel = document.getElementById('systemModeLabel');
const modeHint = document.getElementById('systemModeHint');
const flagGrid = document.getElementById('systemFlagGrid');
const automationGrid = document.getElementById('systemAutomationGrid');
const activityFeed = document.getElementById('systemActivityFeed');

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function updateSystemHeroStats(mode, events = []) {
  const heroMode = document.getElementById('systemHeroMode');
  const heroFlags = document.getElementById('systemHeroFlags');
  const heroEvents = document.getElementById('systemHeroEvents');
  if (heroMode) heroMode.textContent = mode?.modeLabel || '—';
  if (heroFlags) heroFlags.textContent = String(mode?.liveFlagsCount ?? 0);
  if (heroEvents) heroEvents.textContent = events.length ? String(events.length) : '0';
}

function renderModeCard(mode) {
  if (!modePill || !modeLabel || !modeHint || !flagGrid) return;
  const isShadow = mode.mode === 'shadow';
  modePill.textContent = isShadow ? 'Eğitim' : 'Canlı';
  modePill.className = `ops-system-mode-pill ops-system-mode-pill--${isShadow ? 'shadow' : 'live'}`;
  modeLabel.textContent = mode.modeLabel || (isShadow ? 'Eğitim modu' : 'Canlı mod');
  modeHint.textContent = mode.modeHint || '';

  flagGrid.innerHTML = (mode.flags || [])
    .map((flag) => {
      const state = flag.effective ? 'Açık' : flag.enabled ? 'Beklemede' : 'Kapalı';
      const cls = flag.effective ? 'ok' : flag.enabled ? 'warn' : 'muted';
      return `<div class="ops-flag-chip ops-flag-chip--${cls}">
        <span>${ops.escapeHtml(flag.label)}</span>
        <strong>${state}</strong>
      </div>`;
    })
    .join('');
}

function renderAutomation(mode) {
  if (!automationGrid) return;
  const cards = [];
  const poll = mode.poll;
  if (poll) {
    cards.push({
      title: 'Otomatik sipariş çekme',
      value: poll.enabled ? (poll.running ? 'Çalışıyor' : poll.scheduled ? 'Zamanlanmış' : 'Kapalı') : 'Devre dışı',
      meta: poll.lastRunAt
        ? `Son: ${formatTime(poll.lastRunAt)}${poll.lastRunOk === false ? ' (hata)' : ''}`
        : 'Henüz çalışmadı',
      tone: poll.lastRunOk === false ? 'warn' : poll.enabled ? 'ok' : 'muted'
    });
  }

  const matching = mode.matchingSync;
  if (matching) {
    cards.push({
      title: 'Otomatik ürün güncelleme',
      value: matching.enabled ? (matching.running ? 'Çalışıyor' : matching.scheduled ? 'Zamanlanmış' : 'Kapalı') : 'Devre dışı',
      meta: matching.lastRunAt
        ? `Son: ${formatTime(matching.lastRunAt)}${matching.lastRunOk === false ? ' (hata)' : ''}`
        : 'Henüz çalışmadı',
      tone: matching.lastRunOk === false ? 'warn' : matching.enabled ? 'ok' : 'muted'
    });
  }

  const worker = mode.worker;
  if (worker) {
    cards.push({
      title: 'Fiyat takip servisi',
      value: worker.running ? 'Aktif' : 'Kapalı',
      meta: worker.startedAt ? `Başlangıç: ${formatTime(worker.startedAt)}` : '—',
      tone: worker.running ? 'ok' : 'muted'
    });
  }

  automationGrid.innerHTML = cards.length
    ? cards
        .map(
          (card) => `<div class="ops-health-card ops-health-card--${card.tone}">
            <strong>${ops.escapeHtml(card.title)}</strong>
            <span class="ops-kpi-value" style="font-size:1.1rem">${ops.escapeHtml(card.value)}</span>
            <span class="ops-meta">${ops.escapeHtml(card.meta)}</span>
          </div>`
        )
        .join('')
    : '<p class="ops-meta">Otomasyon bilgisi yok.</p>';
}

function activityIcon(event) {
  if (event.kind === 'webhook') return '⚡';
  if (event.kind === 'poll') return '↻';
  if (event.kind === 'sync' || event.kind === 'backfill') return '⇄';
  if (event.kind === 'shadow') return '◐';
  return '•';
}

function renderActivity(events = []) {
  if (!activityFeed) return;
  if (!events.length) {
    activityFeed.innerHTML = '<li class="ops-meta">Henüz kayıtlı hareket yok. Siparişler gelmeye başladığında burada görünür.</li>';
    return;
  }

  activityFeed.innerHTML = events
    .slice(0, 30)
    .map((event) => {
      const tone = event.ok === false ? 'error' : 'ok';
      const channel = event.channelLabel ? `<span class="ops-activity-channel">${ops.escapeHtml(event.channelLabel)}</span>` : '';
      return `<li class="ops-activity-item ops-activity-item--${tone}">
        <span class="ops-activity-icon" aria-hidden="true">${activityIcon(event)}</span>
        <div class="ops-activity-body">
          <div class="ops-activity-title">${channel}${ops.escapeHtml(event.title)}</div>
          <div class="ops-activity-detail">${ops.escapeHtml(event.detail || '')}</div>
          <time class="ops-meta">${formatTime(event.at)}</time>
        </div>
      </li>`;
    })
    .join('');
}

async function loadSystemPage(options = {}) {
  const silent = Boolean(options.silent);
  const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
  if (!authFetch) return;

  if (!silent) {
    window.PfStatus?.loading?.('Sistem Nabzı yükleniyor', 'Otomasyon durumu kontrol ediliyor');
  }

  try {
    const [modeRes, feedRes] = await Promise.all([
      authFetch('/api/ops/system-mode').then((r) => r.json()),
      authFetch('/api/ops/activity-feed?limit=30').then((r) => r.json())
    ]);

    if (modeRes.ok) {
      renderModeCard(modeRes);
      renderAutomation(modeRes);
      updateSystemHeroStats(modeRes, feedRes.ok ? (feedRes.events || []) : []);
    }
    if (feedRes.ok) renderActivity(feedRes.events || []);

    if (!silent) {
      const eventCount = feedRes.ok ? (feedRes.events || []).length : 0;
      window.PfStatus?.success?.(
        'Sistem Nabzı hazır',
        eventCount ? `${eventCount} son hareket listelendi` : 'Otomasyon durumu güncellendi'
      );
    }
  } catch (error) {
    if (!silent) {
      window.PfStatus?.error?.('Sistem Nabzı yüklenemedi', error.message);
    }
    activityFeed.innerHTML = `<li class="ops-meta">Yüklenemedi: ${ops.escapeHtml(error.message)}</li>`;
    throw error;
  }
}

async function init() {
  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({ authRequired: bootstrap.authRequired, onRefresh: loadSystemPage });
  await ops.loadOpsConfig();
  await loadSystemPage();
}

window.onPanelRefresh = () => loadSystemPage({ silent: true });
init().catch((error) => ops.showToast(error.message));

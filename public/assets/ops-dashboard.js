'use strict';

const bootstrap = window.__OPS_DASHBOARD__ || { authRequired: true };

function getOps() {
  return window.OpsCommon || null;
}

function getEl(id) {
  return document.getElementById(id);
}

function renderRecentActivity(events = []) {
  const feed = getEl('recentActivityFeed');
  const ops = getOps();
  if (!feed || !ops) return;
  if (!events.length) {
    feed.innerHTML = '<li class="ops-meta">Henüz kayıtlı hareket yok. Siparişler gelmeye başladığında burada görünür.</li>';
    return;
  }
  feed.innerHTML = events
    .slice(0, 5)
    .map((event) => {
      const channel = event.channelLabel ? `${ops.escapeHtml(event.channelLabel)} · ` : '';
      return `<li class="ops-activity-item ops-activity-item--${event.ok === false ? 'error' : 'ok'}">
        <div class="ops-activity-body">
          <div class="ops-activity-title">${channel}${ops.escapeHtml(event.title)}</div>
          <div class="ops-activity-detail">${ops.escapeHtml(event.detail || '')}</div>
          <time class="ops-meta">${ops.formatTime(event.at)}</time>
        </div>
      </li>`;
    })
    .join('');
}

async function loadRecentActivity() {
  const feed = getEl('recentActivityFeed');
  const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
  if (!feed || !authFetch) return;
  try {
    const response = await authFetch('/api/ops/activity-feed?limit=5');
    const data = await response.json();
    if (response.ok) renderRecentActivity(data.events || []);
  } catch {
    feed.innerHTML = '<li class="ops-meta">Aktivite yüklenemedi.</li>';
  }
}

function renderModeKpi(mode) {
  const kpiMode = getEl('kpiMode');
  const kpiModeHint = getEl('kpiModeHint');
  if (!kpiMode || !mode) return;
  const isShadow = mode.mode === 'shadow';
  kpiMode.textContent = isShadow ? 'Eğitim' : 'Canlı';
  kpiMode.className = `ops-kpi-value ops-kpi-value--mode ops-kpi-value--${isShadow ? 'shadow' : 'live'}`;
  if (kpiModeHint) {
    kpiModeHint.textContent = isShadow
      ? 'Gerçek sipariş ve kasa işlemi yapılmaz'
      : 'Onayladığınız işlemler gerçek sisteme yazılır';
  }
}

function renderPollNote(poll) {
  const pollStatusNote = getEl('pollStatusNote');
  const ops = getOps();
  if (!pollStatusNote || !poll || !ops) return;
  if (!poll.enabled) {
    pollStatusNote.textContent = 'Otomatik sipariş çekme kapalı — açmak için Kanallar sayfasındaki otomasyon bölümüne bakın.';
    return;
  }
  const last = poll.lastRunAt ? ops.formatTime(poll.lastRunAt) : 'henüz yok';
  const state = poll.lastRunOk === false ? 'son kontrol hatalı' : 'düzenli çalışıyor';
  pollStatusNote.textContent = `Siparişler ${state} · son kontrol: ${last}`;
}

function setKpiLoading(active) {
  document.querySelectorAll('#kpiRow .ops-kpi-card').forEach((card) => {
    card.classList.toggle('is-loading', active);
  });
}

async function loadDashboard(options = {}) {
  const silent = Boolean(options.silent);
  const ops = getOps();
  const channelSummary = getEl('channelSummary');
  const kpiChannels = getEl('kpiChannels');
  const kpiAlerts = getEl('kpiAlerts');
  if (!ops) return;

  if (!silent) {
    setKpiLoading(true);
    window.PfStatus?.loading?.('Ana panel yükleniyor', 'Kanal durumu kontrol ediliyor');
  }

  try {
    const authFetch = window.BuyBoxCommon?.authFetch?.bind(window.BuyBoxCommon);
    const integrationsRes = await ops.api('/ops/v1/integrations');
    let modeRes = null;
    if (authFetch) {
      try {
        const response = await authFetch('/api/ops/system-mode');
        modeRes = await response.json();
      } catch {
        modeRes = null;
      }
    }

    const integrations = integrationsRes.integrations || [];
    const connected = integrations.filter((i) => i.status === 'connected').length;
    const alerts = integrations.filter((i) => i.status === 'error' || i.status === 'missing').length;

    if (kpiChannels) kpiChannels.textContent = String(connected);
    if (kpiAlerts) kpiAlerts.textContent = String(alerts);

    if (modeRes?.ok) {
      renderModeKpi(modeRes);
      renderPollNote(modeRes.poll);
    }

    if (channelSummary) {
      channelSummary.innerHTML = integrations.length
        ? integrations
            .map((row) => {
              const msg = ops.gateUserMessage(row.gate, row.gateNote);
              return `
          <div class="ops-health-row">
            <div>
              <strong>${ops.escapeHtml(row.label)}</strong>
              <div class="ops-meta">${ops.escapeHtml(msg)}</div>
            </div>
            <span class="ops-int-pill ${ops.escapeHtml(row.status)}">${ops.escapeHtml(ops.integrationStatusLabel(row.status))}</span>
          </div>`;
            })
            .join('')
        : '<p class="ops-meta">Kanal bilgisi yok.</p>';
    }

    await loadRecentActivity();

    if (!silent) {
      const detail = alerts > 0
        ? `${connected} açık kanal · ${alerts} kurulum uyarısı`
        : `${connected} açık kanal`;
      window.PfStatus?.success?.('Ana panel hazır', detail);
    }
  } catch (error) {
    if (!silent) {
      window.PfStatus?.error?.('Ana panel yüklenemedi', error.message || 'Bilinmeyen hata');
    }
    ops.showToast(error.message || 'Panel yüklenemedi');
    throw error;
  } finally {
    setKpiLoading(false);
  }
}

async function init() {
  const ops = getOps();
  if (!ops) {
    console.error('[ops-dashboard] OpsCommon yüklenemedi');
    return;
  }

  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({ authRequired: bootstrap.authRequired, onRefresh: loadDashboard });
  await ops.loadOpsConfig().catch(() => {});
  await loadDashboard();
  ops.startAutoRefresh(() => loadDashboard({ silent: true }), 60000);
  window.onPanelRefresh = () => loadDashboard({ silent: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => getOps()?.showToast?.(error.message || String(error)));
  });
} else {
  init().catch((error) => getOps()?.showToast?.(error.message || String(error)));
}

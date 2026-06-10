'use strict';

const bootstrap = window.__OPS_HEALTH__ || { authRequired: true };
const ops = window.OpsCommon;

const infraStatus = document.getElementById('infraStatus');
const channelHealth = document.getElementById('channelHealth');
const issueList = document.getElementById('issueList');
const issueEmpty = document.getElementById('issueEmpty');
const healthRaw = document.getElementById('healthRaw');
const stockChannelFilters = document.getElementById('stockChannelFilters');
const stockSummary = document.getElementById('stockSummary');
const stockDriftTable = document.getElementById('stockDriftTable');
const stockEmpty = document.getElementById('stockEmpty');
const stockNote = document.getElementById('stockNote');

let activeStockChannel = 'trendyol_go';

const CHANNEL_LABELS = {
  trendyol_go: 'Trendyol Go',
  yemeksepeti: 'Yemeksepeti',
  getir: 'Getir'
};

function channelHealthLabel(channelKey, field, ok) {
  const labels = {
    packages: 'Sipariş alımı',
    catalog: 'Katalog',
    ordersApi: 'Sipariş API',
    oauth: 'Kimlik doğrulama',
    webhook: 'Webhook'
  };
  const name = labels[field] || field;
  const status = ok ? 'Aktif' : 'Kapalı';
  return { name, status, ok };
}

function userIssueFromHealth(channelKey, channelData) {
  const issues = [];
  const label = CHANNEL_LABELS[channelKey] || channelKey;

  if (channelData.result === 'FAIL') {
    if (channelKey === 'getir') {
      issues.push(`${label}: Bağlantı bilgileri eksik — kurulum gerekli`);
    } else if (channelKey === 'trendyol_go') {
      issues.push(`${label}: Sipariş alımı şu an çalışmıyor`);
    } else {
      issues.push(`${label}: Bağlantı sorunu var`);
    }
  } else if (channelData.result === 'PARTIAL') {
    if (channelKey === 'trendyol_go') {
      issues.push(`${label}: Stok güncelleme henüz aktif değil`);
    } else if (channelKey === 'yemeksepeti') {
      issues.push(`${label}: Webhook kurulumu tamamlanmalı`);
    } else {
      issues.push(`${label}: Bazı özellikler kısmen aktif`);
    }
  }

  return issues;
}

function stockCapabilityNote(plan) {
  if (plan.capability?.livePush) {
    return ops.canStockWrite()
      ? 'Stok güncelleme canlı modda açık.'
      : 'Stok güncelleme yönetici tarafından henüz açılmadı.';
  }
  if (plan.opsChannel === 'trendyol_go') {
    return 'Trendyol stok karşılaştırması okunuyor; otomatik güncelleme henüz kapalı.';
  }
  return 'Bu kanal için otomatik stok güncelleme henüz kapalı.';
}

async function loadStockDrift(channel = activeStockChannel) {
  stockSummary.innerHTML = '';
  stockDriftTable.innerHTML = '';
  stockEmpty.classList.add('hidden');
  stockNote.textContent = 'Yükleniyor...';

  try {
    const data = await ops.api(`/ops/v1/stock/drift?channel=${encodeURIComponent(channel)}&limit=50`);
    const plan = data.plan || {};
    const summary = plan.summary || {};
    const drift = plan.driftSummary || {};

    stockSummary.innerHTML = `
      <div class="ops-kpi-card">
        <div class="ops-kpi-value">${summary.coveragePercent ?? 0}%</div>
        <div class="ops-kpi-label">Eşleşme kapsamı</div>
      </div>
      <div class="ops-kpi-card">
        <div class="ops-kpi-value">${drift.driftRows ?? 0}</div>
        <div class="ops-kpi-label">Farklı ürün</div>
      </div>
      <div class="ops-kpi-card">
        <div class="ops-kpi-value">${summary.pushCount ?? 0}</div>
        <div class="ops-kpi-label">Güncelleme bekleyen</div>
      </div>
      <div class="ops-kpi-card">
        <div class="ops-kpi-value">${drift.maxAbsDrift ?? 0}</div>
        <div class="ops-kpi-label">En büyük fark</div>
      </div>`;

    stockNote.textContent = stockCapabilityNote(plan);

    const driftRows = (plan.preview || []).filter((row) => row.drift != null && row.drift !== 0);
    if (!driftRows.length) {
      stockEmpty.classList.remove('hidden');
      return;
    }

    for (const row of driftRows.slice(0, 20)) {
      const card = document.createElement('div');
      card.className = 'ops-line';
      const sign = row.drift > 0 ? '+' : '';
      card.innerHTML = `
        <div class="ops-line-title">${ops.escapeHtml(row.title || row.barcode)}</div>
        <div class="ops-line-meta">${ops.escapeHtml(row.barcode)}</div>
        <div class="ops-line-qty">Master: ${row.targetQuantity} · Kanal: ${row.channelQuantity ?? '—'} · Fark: ${sign}${row.drift}</div>`;
      stockDriftTable.appendChild(card);
    }
  } catch (error) {
    stockNote.textContent = error.message;
  }
}

async function loadHealth() {
  try {
    const [readyRes, healthRes] = await Promise.all([
      ops.api('/ready').catch(() => ({ ok: false })),
      ops.api('/ops/v1/integrations/health')
    ]);

    infraStatus.innerHTML = `
      <div class="ops-health-row">
        <strong>API sunucusu</strong>
        <span class="ops-health-indicator ops-health-indicator--ok">Çalışıyor</span>
      </div>
      <div class="ops-health-row">
        <strong>Veritabanı</strong>
        <span class="ops-health-indicator ${readyRes.ok ? 'ops-health-indicator--ok' : 'ops-health-indicator--bad'}">${readyRes.ok ? 'Hazır' : 'Bağlantı sorunu'}</span>
      </div>`;

    const channels = healthRes.channels || {};
    const rows = [];
    const issues = [];

    for (const [key, data] of Object.entries(channels)) {
      const label = CHANNEL_LABELS[key] || key;
      const indicator = ops.healthIndicator(data.result);
      rows.push(`
        <div class="ops-health-row">
          <div>
            <strong>${ops.escapeHtml(label)}</strong>
            <div class="ops-meta">${ops.escapeHtml(indicator.label)}</div>
          </div>
          <span class="${indicator.className}">${ops.escapeHtml(indicator.label)}</span>
        </div>`);

      issues.push(...userIssueFromHealth(key, data));

      if (data.packages) {
        const pkg = channelHealthLabel(key, 'packages', data.packages.ok);
        rows.push(`
          <div class="ops-health-row" style="margin-left:12px">
            <span class="ops-meta">${ops.escapeHtml(label)} — ${ops.escapeHtml(pkg.name)}</span>
            <span class="ops-health-indicator ${pkg.ok ? 'ops-health-indicator--ok' : 'ops-health-indicator--bad'}">${ops.escapeHtml(pkg.status)}</span>
          </div>`);
      }
      if (data.catalog) {
        const cat = channelHealthLabel(key, 'catalog', data.catalog.ok);
        rows.push(`
          <div class="ops-health-row" style="margin-left:12px">
            <span class="ops-meta">${ops.escapeHtml(label)} — ${ops.escapeHtml(cat.name)}</span>
            <span class="ops-health-indicator ${cat.ok ? 'ops-health-indicator--ok' : 'ops-health-indicator--bad'}">${ops.escapeHtml(cat.status)}</span>
          </div>`);
      }
    }

    channelHealth.innerHTML = rows.join('');

    if (issues.length) {
      issueEmpty.classList.add('hidden');
      issueList.innerHTML = issues.map((item) => `<li>${ops.escapeHtml(item)}</li>`).join('');
    } else {
      issueEmpty.classList.remove('hidden');
      issueList.innerHTML = '';
    }

    healthRaw.textContent = JSON.stringify({ ready: readyRes, health: healthRes }, null, 2);
  } catch (error) {
    ops.showToast(error.message);
  }
}

async function refreshAll() {
  await loadHealth();
  await loadStockDrift();
}

stockChannelFilters?.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-channel]');
  if (!chip) return;
  activeStockChannel = chip.getAttribute('data-channel') || 'trendyol_go';
  stockChannelFilters.querySelectorAll('.ops-chip').forEach((el) => el.classList.remove('is-active'));
  chip.classList.add('is-active');
  loadStockDrift(activeStockChannel);
});

async function init() {
  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({ authRequired: bootstrap.authRequired, onRefresh: refreshAll });
  await ops.loadOpsConfig();
  await refreshAll();
}

init().catch((error) => ops.showToast(error.message));

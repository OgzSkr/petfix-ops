'use strict';

(function () {
const bootstrapEl = document.getElementById('bootstrap');
const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent) : {};

if (bootstrap.authRequired && !window.BuyBoxCommon.getStoredToken()) {
  window.BuyBoxCommon.redirectToLogin();
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => window.BuyBoxCommon.logout());
}

let healthState = null;
let ordersState = null;

function renderCombinedStatus() {
  const el = document.getElementById('channelHealth');
  if (!el) return;

  if (ordersState?.loading) {
    el.innerHTML = '<div class="channel-health-box channel-health-box--loading">' +
      '<span class="status-badge status-badge--info">Yükleniyor</span>' +
      '<p class="muted">Sipariş durumu kontrol ediliyor…</p></div>';
    return;
  }

  if (ordersState?.error) {
    el.innerHTML = renderStatusBox({
      badges: ['<span class="status-badge status-badge--warning">Hata</span>'],
      title: bootstrap.channelLabel || 'Kanal',
      message: ordersState.error,
      note: 'API yanıt vermedi veya kimlik bilgileri eksik olabilir.'
    });
    return;
  }

  const health = healthState || {};
  const configured = Boolean(health.configured ?? ordersState?.configured);
  const badges = [];

  if (configured) {
    badges.push('<span class="status-badge status-badge--success">API Bağlı</span>');
  } else {
    badges.push('<span class="status-badge status-badge--warning">API Eksik</span>');
  }

  if (ordersState) {
    if (ordersState.skipped) {
      badges.push('<span class="status-badge status-badge--info">Önbellek</span>');
    } else if (ordersState.orderCount > 0) {
      badges.push('<span class="status-badge status-badge--success">Güncel</span>');
    } else if (configured) {
      badges.push('<span class="status-badge status-badge--ready">Veri yok</span>');
    }
  } else if (configured) {
    badges.push('<span class="status-badge status-badge--ready">Hazır</span>');
  }

  let message = health.message || '';
    if (ordersState) {
    const count = Number(ordersState.orderCount || 0);
    const sources = ordersState.orderSources || null;
    if (ordersState.skipped) {
      message = `Önbellekten ${count} sipariş gösteriliyor` +
        (ordersState.cooldownSeconds ? ` · ${ordersState.cooldownSeconds} sn sonra yenilenebilir` : '');
    } else if (count > 0) {
      message = `${count} sipariş yüklendi` +
        (ordersState.fetched > count ? ` (${ordersState.fetched} API kaydından süzüldü)` : '');
      if (sources && bootstrap.channelId === 'yemeksepeti') {
        message += ` · Partner API: ${sources.partnerApi}, Webhook: ${sources.opsWebhook}`;
      }
    } else if (configured) {
      if (bootstrap.channelId === 'yemeksepeti' && sources) {
        message = `Partner API: ${sources.partnerApi} sipariş · Webhook/Ops: ${sources.opsWebhook} sipariş · Seçili dönemde birleşik liste boş`;
      } else {
        message = 'API bağlı · Seçili dönemde sipariş bulunamadı';
      }
    }
    if (ordersState.stats && Number(ordersState.stats.loss) > 0) {
      message += ` · ${ordersState.stats.loss} zarar eden sipariş`;
    }
  }

  el.innerHTML = renderStatusBox({
    badges,
    title: bootstrap.channelLabel || health.label || 'Kanal',
    message,
    note: buildHealthNote(configured, health)
  });
}

function buildHealthNote(configured, health) {
  if (!configured) {
    return 'Ayarlar sayfasından API bilgilerini girerek bağlantıyı tamamlayın.';
  }
  if (bootstrap.channelId !== 'yemeksepeti') return '';
  const portal = health.partnerPortalUrl
    ? `<a href="${esc(health.partnerPortalUrl)}" target="_blank" rel="noopener">Partner Portal → Shop Integrations</a>`
    : 'Partner Portal → Shop Integrations';
  if (Number(health.partnerApiOrdersLast7Days || health.ordersLast7Days) === 0 && !Number(health.opsWebhookOrdersLast7Days)) {
    return `YS Partner API son 7 günde 0 sipariş döndürdü. Canlı siparişler webhook ile gelir; ${portal} üzerinden Orders entegrasyonunu ve webhook loglarını kontrol edin.`;
  }
  return '';
}

function renderStatusBox({ badges, title, message, note }) {
  const logos = window.PetFixChannelLogos;
  const logoHtml = bootstrap.channelId && logos
    ? `<span class="orders-source-channel">${logos.render(bootstrap.channelId, { size: 'sm' })}</span>`
    : '';
  return `<div class="channel-health-box">
    <div class="channel-health-badges">${badges.join('')}</div>
    <p class="channel-health-title">${logoHtml}<strong>${esc(title)}</strong></p>
    <p class="muted">${esc(message || '—')}</p>
    ${note ? `<p class="channel-empty-note">${esc(note)}</p>` : ''}
  </div>`;
}

async function loadHealth() {
  try {
    const statusPath = bootstrap.channelId === 'yemeksepeti'
      ? '/api/yemeksepeti/status'
      : '/api/channels/health';
    const response = await window.BuyBoxCommon.authFetch(statusPath);
    const payload = await response.json();
    if (bootstrap.channelId === 'yemeksepeti') {
      healthState = {
        ...(payload || {}),
        label: bootstrap.channelLabel || 'Yemeksepeti',
        configured: Boolean(payload?.configured),
        partnerPortalUrl: payload?.partnerPortalUrl || 'https://partner-app.yemeksepeti.com/'
      };
    } else {
      const channel = (payload.channels || []).find((item) => item.id === bootstrap.channelId);
      if (!channel) {
        healthState = { configured: false, message: 'Kanal bilgisi bulunamadı' };
      } else {
        healthState = { ...(channel.health || {}), label: channel.label };
      }
    }
  } catch (error) {
    healthState = { configured: false, message: error.message || 'Durum yüklenemedi' };
  }
  renderCombinedStatus();
}

window.BuyBoxChannelPage = {
  setOrdersLoading(loading = true) {
    ordersState = { loading };
    renderCombinedStatus();
  },
  updateOrdersStatus(state = {}) {
    ordersState = { loading: false, ...state };
    renderCombinedStatus();
  }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

if (bootstrap.channelHealthEnabled !== false) {
  loadHealth();
}
if (bootstrap.benimposSaleEnabled) {
  loadSalesReadiness();
}

async function loadSalesReadiness() {
  const banner = document.getElementById('benimposReadinessBanner');
  if (!banner) return;
  try {
    const response = await window.BuyBoxCommon.authFetch(
      '/api/benimpos/sales-readiness?channelId=' + encodeURIComponent(bootstrap.channelId || 'uber-eats')
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;

    if (data.readyForSales) {
      banner.hidden = true;
      return;
    }

    banner.hidden = false;
    banner.className = 'benimpos-readiness-banner benimpos-readiness-banner--warn';
    banner.innerHTML =
      '<strong>BenimPOS satışı için eşleştirme gerekli</strong>' +
      '<p>Gerçek satış yalnızca <em>manuel onaylı</em> eşleştirmelerle yapılabilir.</p>' +
      '<ul>' + (data.blockers || []).slice(0, 3).map((b) => `<li>${esc(b)}</li>`).join('') + '</ul>' +
      '<div class="benimpos-readiness-links">' +
        (data.nextSteps || []).map((s) =>
          `<a class="btn-brown" href="${esc(s.href)}">${esc(s.label)}</a>`
        ).join(' ') +
      '</div>';
  } catch {
    banner.hidden = true;
  }
}
})();

'use strict';

window.OpsCommon = (() => {
  const common = window.BuyBoxCommon;

  const CHANNEL_LABELS = {
    trendyol_go: 'Trendyol Go',
    yemeksepeti: 'Yemeksepeti',
    getir: 'Getir'
  };

  const STATUS_LABELS = {
    received: 'Yeni',
    picking: 'Toplanıyor',
    picked: 'Hazır',
    ready: 'Kanala bildirildi',
    completed: 'Tamamlandı',
    cancelled: 'İptal',
    failed: 'Hata'
  };

  const MATCHING_LABELS = {
    matched: 'Eşleşti',
    unmapped: 'Ürün tanımsız',
    blocked: 'Eşleşme sorunu',
    legacy: 'Eski kayıt'
  };

  const INTEGRATION_STATUS_LABELS = {
    connected: 'Bağlı',
    ready: 'Hazır',
    missing: 'Kurulum gerekli',
    error: 'Bağlantı sorunu',
    disabled: 'Kapalı'
  };

  const GATE_USER_MESSAGES = {
    G1: 'Siparişler alınıyor',
    G2: 'Stok güncelleme henüz kapalı',
    G3: 'Bağlantı bilgileri eksik',
    G4: 'Webhook kurulumu gerekli'
  };

  const HEALTH_RESULT_LABELS = {
    PARTIAL: 'Kısmen aktif',
    FAIL: 'Kapalı',
    OK: 'Aktif'
  };

  let opsConfig = { shadowModeDefault: true, flags: {} };
  let refreshTimer = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function channelLabel(channel) {
    return CHANNEL_LABELS[channel] || channel;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  function matchingLabel(status) {
    return MATCHING_LABELS[status] || 'Kontrol gerekli';
  }

  function integrationStatusLabel(status) {
    return INTEGRATION_STATUS_LABELS[status] || status;
  }

  function gateUserMessage(gate, gateNote) {
    if (gate && GATE_USER_MESSAGES[gate]) {
      return GATE_USER_MESSAGES[gate];
    }
    if (gateNote && !/\b(G[1-6]|PARTIAL|FAIL|FF_)\b/i.test(gateNote)) {
      return gateNote;
    }
    return 'Kurulum devam ediyor';
  }

  function humanizeGuideStep(step) {
    return String(step)
      .replace(/\bG[1-6]\b/g, '')
      .replace(/\bPARTIAL\b/gi, '')
      .replace(/\bFAIL\b/gi, '')
      .replace(/simülasyon modunda kalır/gi, 'henüz kapalı')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function formatTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit'
    });
  }

  function formatRelativeMinutes(minutes) {
    if (minutes < 1) return 'Az önce';
    if (minutes < 60) return `${minutes} dk önce`;
    const hours = Math.floor(minutes / 60);
    return `${hours} sa önce`;
  }

  function computeSla(orderedAt) {
    if (!orderedAt) {
      return { level: 'normal', minutes: 0, label: '—' };
    }
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(orderedAt).getTime()) / 60000));
    let level = 'normal';
    if (minutes >= 15) level = 'critical';
    else if (minutes >= 5) level = 'warn';

    const label =
      level === 'critical'
        ? `${minutes} dk — acil`
        : level === 'warn'
          ? `${minutes} dk beklemede`
          : formatRelativeMinutes(minutes);

    return { level, minutes, label };
  }

  function isShadowMode(config = opsConfig) {
    return config.shadowModeDefault !== false;
  }

  function isLiveWritesEnabled(config = opsConfig) {
    return !isShadowMode(config);
  }

  function canChannelWrite(config = opsConfig) {
    return isLiveWritesEnabled(config) && config.flags?.FF_CHANNEL_STATUS_WRITE === true;
  }

  function canBenimposWrite(config = opsConfig) {
    return isLiveWritesEnabled(config) && config.flags?.FF_BENIMPOS_SALE_WRITE === true;
  }

  function canStockWrite(config = opsConfig) {
    return isLiveWritesEnabled(config) && config.flags?.FF_STOCK_PUSH === true;
  }

  function getConfig() {
    return opsConfig;
  }

  async function loadOpsConfig() {
    try {
      const data = await api('/ops/v1/config');
      opsConfig = data.config || { shadowModeDefault: true, flags: {} };
    } catch {
      opsConfig = { shadowModeDefault: true, flags: {} };
    }
    applyModeBanner();
    return opsConfig;
  }

  function applyModeBanner() {
    const banner = document.getElementById('modeBanner');
    const text = document.getElementById('modeBannerText');
    if (!banner) return;

    if (isShadowMode()) {
      banner.classList.remove('hidden', 'ops-mode-banner--live');
      banner.classList.add('ops-mode-banner--shadow');
      if (text) {
        text.textContent = 'Eğitim modu — gerçek kanal ve kasa işlemi yapılmaz';
      }
    } else {
      banner.classList.remove('hidden', 'ops-mode-banner--shadow');
      banner.classList.add('ops-mode-banner--live');
      if (text) {
        text.textContent = 'Canlı mod — onayladığınız işlemler gerçek sisteme yazılır';
      }
    }
  }

  async function api(path, options = {}) {
    const response = await common.authFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `İstek başarısız (${response.status})`);
    }
    return data;
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) common.showToast(toast, message);
  }

  function ensureAuth(authRequired = true) {
    if (!authRequired) return;
    if (!common.getStoredToken()) {
      common.redirectToLogin();
    }
  }

  function bindShellControls({ onRefresh, authRequired = true } = {}) {
    const refreshBtn = document.getElementById('refreshBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const navToggle = document.getElementById('navToggle');
    const sidebar = document.querySelector('.ops-sidebar');

    if (refreshBtn && onRefresh) {
      refreshBtn.addEventListener('click', onRefresh);
    }
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => common.logout());
    }
    if (navToggle && sidebar) {
      navToggle.addEventListener('click', () => sidebar.classList.toggle('is-open'));
    }
  }

  function confirmAction({ title, body, confirmLabel = 'Onayla' }) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const titleEl = document.getElementById('confirmModalTitle');
      const bodyEl = document.getElementById('confirmModalBody');
      const okBtn = document.getElementById('confirmModalOk');
      const cancelBtn = document.getElementById('confirmModalCancel');
      if (!modal || !okBtn || !cancelBtn) {
        resolve(window.confirm(body || title));
        return;
      }

      titleEl.textContent = title || 'Onay gerekli';
      bodyEl.textContent = body || '';
      okBtn.textContent = confirmLabel;
      modal.classList.remove('hidden');

      function cleanup(result) {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.querySelector('[data-dismiss="modal"]')?.removeEventListener('click', onCancel);
        resolve(result);
      }

      function onOk() {
        cleanup(true);
      }
      function onCancel() {
        cleanup(false);
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.querySelector('[data-dismiss="modal"]')?.addEventListener('click', onCancel);
    });
  }

  function renderCopyField(label, value, { secret = false } = {}) {
    const display = secret && value ? '••••••••' : value || '';
    const id = `copy-${label.replace(/\W+/g, '-').toLowerCase()}`;
    return `
      <div class="ops-copy-row">
        <label for="${id}">${escapeHtml(label)}</label>
        <div class="ops-copy">
          <input id="${id}" type="text" readonly value="${escapeHtml(display)}">
          <button type="button" class="ops-btn ops-btn-secondary" data-copy="${escapeHtml(value || '')}">Kopyala</button>
        </div>
      </div>`;
  }

  function bindCopyButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const value = btn.getAttribute('data-copy') || '';
        if (!value) {
          showToast('Kopyalanacak değer yok');
          return;
        }
        try {
          await navigator.clipboard.writeText(value);
          showToast('Panoya kopyalandı');
        } catch {
          showToast('Kopyalama başarısız');
        }
      });
    });
  }

  function startAutoRefresh(callback, intervalMs = 30000) {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      callback().catch(() => {});
    }, intervalMs);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function channelBadgeClass(channel) {
    return `ops-channel-badge ops-channel-badge--${channel}`;
  }

  function feedbackScanSuccess() {
    try {
      if (navigator.vibrate) navigator.vibrate(40);
    } catch {
      /* ignore */
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      /* ignore */
    }
  }

  function shadowIssueLabel(payload) {
    const type = payload?.type;
    if (type === 'unmapped_line') return 'Ürün tanımsız satır';
    if (type === 'blocked_line') return 'Eşleşme sorunu';
    if (type === 'legacy_line') return 'Eski eşleştirme kaydı';
    return 'Sipariş uyarısı';
  }

  const SHADOW_MIN_ORDERS = 20;
  const SHADOW_MIN_DAYS = 7;

  function computeShadowDays(orders) {
    if (!orders.length) return 0;
    const times = orders
      .map((o) => new Date(o.orderedAt || o.ordered_at).getTime())
      .filter((t) => Number.isFinite(t));
    if (!times.length) return 0;
    const earliest = Math.min(...times);
    return Math.max(0, Math.floor((Date.now() - earliest) / 86400000));
  }

  function healthIndicator(result) {
    const label = HEALTH_RESULT_LABELS[result] || result;
    if (result === 'OK' || result === 'PARTIAL') {
      const cls = result === 'OK' ? 'ok' : 'warn';
      return { className: `ops-health-indicator ops-health-indicator--${cls}`, label };
    }
    return { className: 'ops-health-indicator ops-health-indicator--bad', label };
  }

  return {
    CHANNEL_LABELS,
    STATUS_LABELS,
    MATCHING_LABELS,
    escapeHtml,
    channelLabel,
    statusLabel,
    matchingLabel,
    integrationStatusLabel,
    gateUserMessage,
    humanizeGuideStep,
    formatTime,
    computeSla,
    isShadowMode,
    isLiveWritesEnabled,
    canChannelWrite,
    canBenimposWrite,
    canStockWrite,
    getConfig,
    loadOpsConfig,
    applyModeBanner,
    api,
    showToast,
    ensureAuth,
    bindShellControls,
    confirmAction,
    renderCopyField,
    bindCopyButtons,
    startAutoRefresh,
    stopAutoRefresh,
    channelBadgeClass,
    feedbackScanSuccess,
    shadowIssueLabel,
    SHADOW_MIN_ORDERS,
    SHADOW_MIN_DAYS,
    computeShadowDays,
    healthIndicator
  };
})();

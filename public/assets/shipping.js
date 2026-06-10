'use strict';

const bootstrapEl = document.getElementById('bootstrap');
const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent) : {};

if (bootstrap.authRequired && !window.BuyBoxCommon?.getStoredToken?.()) {
  window.BuyBoxCommon.redirectToLogin();
}

document.querySelectorAll('.pf-kpi-card--link[data-href]').forEach((card) => {
  card.addEventListener('click', () => {
    const href = card.getAttribute('data-href');
    if (href) window.location.href = href;
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      card.click();
    }
  });
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'link');
});

async function loadDhlStatus() {
  const panel = document.getElementById('dhlStatusPanel');
  const kpiValue = document.getElementById('dhlKpiValue');
  const kpiHint = document.getElementById('dhlKpiHint');
  const kpiCard = document.getElementById('dhlKpiCard');
  if (!panel) return;

  try {
    const response = await window.BuyBoxCommon.authFetch('/api/dhl-settings');
    if (response.status === 401) {
      panel.innerHTML = '<p class="muted">DHL durumu için giriş yapın veya token girin.</p>';
      if (kpiValue) kpiValue.textContent = '—';
      if (kpiHint) kpiHint.textContent = 'Kimlik doğrulama gerekli';
      return;
    }
    if (!response.ok) {
      panel.innerHTML = '<p class="pf-status pf-status--warn">DHL ayarları okunamadı.</p>';
      return;
    }

    const settings = await response.json();
    const configured = Boolean(settings.configured);

    if (kpiValue) kpiValue.textContent = configured ? 'Bağlı' : 'Eksik';
    if (kpiHint) {
      kpiHint.textContent = configured
        ? (settings.environment || 'PROD') + ' ortamı'
        : 'API bilgileri girilmedi';
    }
    if (kpiCard) {
      kpiCard.classList.toggle('pf-kpi-card--ok', configured);
      kpiCard.classList.toggle('pf-kpi-card--warn', !configured);
    }

    const rows = [
      ['Müşteri no', settings.customerNumber || '—'],
      ['Ortam', settings.environment || '—'],
      ['Client ID', settings.clientIdConfigured ? 'Kayıtlı' : 'Eksik'],
      ['Client Secret', settings.clientSecretConfigured ? 'Kayıtlı' : 'Eksik'],
      ['Şifre', settings.passwordConfigured ? 'Kayıtlı' : 'Eksik']
    ];

    panel.innerHTML =
      '<dl class="pf-dhl-dl">' +
      rows.map(([label, value]) =>
        '<div><dt>' + esc(label) + '</dt><dd>' + esc(String(value)) + '</dd></div>'
      ).join('') +
      '</dl>';
  } catch {
    panel.innerHTML = '<p class="pf-status pf-status--warn">DHL durumu yüklenemedi.</p>';
  }
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

loadDhlStatus().catch(() => {});

'use strict';

const bootstrapEl = document.getElementById('bootstrap');
const bootstrap = bootstrapEl ? JSON.parse(bootstrapEl.textContent) : {};

if (bootstrap.authRequired && !window.BuyBoxCommon.getStoredToken()) {
  window.BuyBoxCommon.redirectToLogin();
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => window.BuyBoxCommon.logout());
}

function setEffectiveHint(data) {
  const el = document.getElementById('prefEffectiveHint');
  if (!el || !data?.effective) return;

  const { effective, preferences } = data;
  const parts = ['Canlı mod: ayarlarınıza göre gerçek yazma yapılabilir.'];

  if (preferences?.benimposAutoSale) {
    parts.push('Toplama bitince fiş otomatik oluşturulur ve BenimPOS kasasına yazılır.');
  } else {
    parts.push('Kasa satışını toplama ekranından elle gönderirsiniz.');
  }

  if (preferences?.stockAutoSyncEnabled) {
    parts.push(
      effective.stockAutoSyncLive
        ? 'BenimPOS stok değişiklikleri otomatik olarak kanallara yazılır.'
        : 'Otomatik stok açık ama kanallara yazma izni kapalı — stok simüle edilir.'
    );
  }

  if (parts.length) {
    el.textContent = parts.join(' ');
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function loadOpsPreferences() {
  const response = await window.BuyBoxCommon.authFetch('/api/ops/preferences');
  if (!response.ok) return;
  const data = await response.json();
  const prefs = data.preferences || {};

  const map = {
    prefBenimposAutoSale: prefs.benimposAutoSale,
    prefChannelStatusWrite: prefs.channelStatusWrite,
    prefStockPush: prefs.stockPush,
    prefStockAutoSync: prefs.stockAutoSyncEnabled,
    prefPollEnabled: prefs.pollEnabled
  };

  Object.entries(map).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  });

  setEffectiveHint(data);
}

const saveOpsBtn = document.getElementById('saveOpsPreferences');
if (saveOpsBtn) {
  saveOpsBtn.addEventListener('click', async () => {
    const status = document.getElementById('opsPreferencesStatus');
    status.textContent = 'Kaydediliyor...';

    const payload = {
      benimposAutoSale: document.getElementById('prefBenimposAutoSale')?.checked === true,
      channelStatusWrite: document.getElementById('prefChannelStatusWrite')?.checked === true,
      stockPush: document.getElementById('prefStockPush')?.checked === true,
      stockAutoSyncEnabled: document.getElementById('prefStockAutoSync')?.checked === true,
      pollEnabled: document.getElementById('prefPollEnabled')?.checked === true
    };

    const response = await window.BuyBoxCommon.authFetch('/api/ops/preferences', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    status.textContent = response.ok ? 'Operasyon ayarları kaydedildi.' : (result.error || 'Kaydedilemedi.');
    if (response.ok) {
      setEffectiveHint(result);
      if (window.PfStatus?.success) {
        window.PfStatus.success('Operasyon ayarları güncellendi');
      }
    }
  });
}

async function loadBenimposSettings() {
  const response = await window.BuyBoxCommon.authFetch('/api/benimpos-settings');
  if (!response.ok) return;
  const settings = await response.json();
  document.getElementById('benimposBranchId').value = settings.branchId || '';
  document.getElementById('benimposApiUrl').value = settings.apiUrl || 'https://dev.benimpos.com/api';
  document.getElementById('benimposApiKey').value = '';
  document.getElementById('benimposApiKey').placeholder = settings.apiKeyConfigured
    ? 'Kayıtlı — değiştirmek için yeni key girin'
    : 'API Key';
  document.getElementById('benimposSecretKey').value = '';
  document.getElementById('benimposSecretKey').placeholder = settings.secretKeyConfigured
    ? 'Kayıtlı — değiştirmek için yeni secret girin'
    : 'Secret Key';
}

const saveBenimposBtn = document.getElementById('saveBenimposSettings');
if (saveBenimposBtn) {
  saveBenimposBtn.addEventListener('click', async () => {
    const status = document.getElementById('benimposSettingsStatus');
    status.textContent = 'Kaydediliyor...';
    const response = await window.BuyBoxCommon.authFetch('/api/benimpos-settings', {
      method: 'POST',
      body: JSON.stringify({
        branchId: document.getElementById('benimposBranchId').value.trim(),
        apiUrl: document.getElementById('benimposApiUrl').value.trim(),
        apiKey: document.getElementById('benimposApiKey').value.trim(),
        secretKey: document.getElementById('benimposSecretKey').value.trim()
      })
    });
    const result = await response.json().catch(() => ({}));
    status.textContent = response.ok ? 'BenimPOS ayarları kaydedildi.' : (result.error || 'Kaydedilemedi.');
    if (response.ok) await loadBenimposSettings();
  });
}

const testBenimposBtn = document.getElementById('testBenimposBtn');
if (testBenimposBtn) {
  testBenimposBtn.addEventListener('click', async () => {
    const status = document.getElementById('benimposSettingsStatus');
    status.textContent = 'Bağlantı test ediliyor...';
    const response = await window.BuyBoxCommon.authFetch('/api/benimpos/status');
    const result = await response.json().catch(() => ({}));
    status.textContent = result.message || (response.ok ? 'Bağlantı OK.' : (result.error || 'Bağlantı başarısız.'));
  });
}

const syncBenimposCostsBtn = document.getElementById('syncBenimposCostsBtn');
if (syncBenimposCostsBtn) {
  syncBenimposCostsBtn.addEventListener('click', async () => {
    const status = document.getElementById('benimposSettingsStatus');
    status.textContent = 'BenimPOS ürünleri okunuyor (yalnızca boş maliyetler güncellenir)...';
    const response = await window.BuyBoxCommon.authFetch('/api/benimpos/sync-costs', { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      status.textContent = `Tamam: ${result.filled || 0} maliyet dolduruldu, ${result.added || 0} yeni kayıt, ${result.skippedHasCost || 0} zaten dolu atlandı (${result.totalProductsCount || 0} BenimPOS ürünü okundu).`;
    } else {
      status.textContent = result.error || 'Senkron başarısız.';
    }
  });
}

loadOpsPreferences().catch(() => {});
loadBenimposSettings().catch(() => {});

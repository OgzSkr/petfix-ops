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

window.BuyBoxCommon.initPlatformNav?.();

async function loadTrendyolSettings() {
  const response = await window.BuyBoxCommon.authFetch('/api/trendyol-settings');
  if (!response.ok) return;
  const settings = await response.json();
  document.getElementById('sellerId').value = settings.sellerId || '';
  document.getElementById('apiKey').value = '';
  document.getElementById('apiKey').placeholder = settings.apiKeyConfigured
    ? 'Kayıtlı — değiştirmek için yeni key girin'
    : 'API Key';
  document.getElementById('apiSecret').value = '';
  document.getElementById('apiSecret').placeholder = settings.apiSecretConfigured
    ? 'Kayıtlı — değiştirmek için yeni secret girin'
    : 'API Secret';
  document.getElementById('environment').value = settings.environment || 'PROD';
  document.getElementById('pollIntervalMs').value = settings.pollIntervalMs || '1000';
  document.getElementById('batchSize').value = settings.batchSize || '10';
}

document.getElementById('saveTrendyolSettings').addEventListener('click', async () => {
  const status = document.getElementById('trendyolSettingsStatus');
  status.textContent = 'Kaydediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/trendyol-settings', {
    method: 'POST',
    body: JSON.stringify({
      sellerId: document.getElementById('sellerId').value.trim(),
      apiKey: document.getElementById('apiKey').value.trim(),
      apiSecret: document.getElementById('apiSecret').value.trim(),
      environment: document.getElementById('environment').value,
      pollIntervalMs: document.getElementById('pollIntervalMs').value.trim(),
      batchSize: document.getElementById('batchSize').value.trim()
    })
  });
  const result = await response.json().catch(() => ({}));
  status.textContent = response.ok ? 'Trendyol Pazaryeri ayarları kaydedildi.' : (result.error || 'Kaydedilemedi.');
  if (response.ok) await loadTrendyolSettings();
});

document.getElementById('startWorkerBtn').addEventListener('click', async () => {
  const status = document.getElementById('trendyolSettingsStatus');
  status.textContent = 'Worker başlatılıyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/worker/start', { method: 'POST' });
  const result = await response.json().catch(() => ({}));
  status.textContent = result.message || (response.ok ? 'Başlatıldı.' : 'Başlatılamadı.');
});

document.getElementById('stopWorkerBtn').addEventListener('click', async () => {
  const status = document.getElementById('trendyolSettingsStatus');
  status.textContent = 'Worker durduruluyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/worker/stop', { method: 'POST' });
  const result = await response.json().catch(() => ({}));
  status.textContent = result.message || (response.ok ? 'Durduruldu.' : 'Durdurulamadı.');
});

loadTrendyolSettings().catch(() => {});
loadUberEatsSettings().catch(() => {});
loadYemeksepetiSettings().catch(() => {});

async function loadUberEatsSettings() {
  const response = await window.BuyBoxCommon.authFetch('/api/uber-eats-settings');
  if (!response.ok) return;
  const settings = await response.json();
  document.getElementById('uberSupplierId').value = settings.supplierId || '';
  document.getElementById('uberIntegrationRef').value = settings.integrationRef || '';
  document.getElementById('uberStoreId').value = settings.storeId || '';
  document.getElementById('uberApiKey').value = '';
  document.getElementById('uberApiKey').placeholder = settings.apiKeyConfigured
    ? 'Kayıtlı — değiştirmek için yeni key girin'
    : 'API Key';
  document.getElementById('uberApiSecret').value = '';
  document.getElementById('uberApiSecret').placeholder = settings.apiSecretConfigured
    ? 'Kayıtlı — değiştirmek için yeni secret girin'
    : 'API Secret';
  document.getElementById('uberChannel').value = settings.channel || 'market';
  document.getElementById('uberEnvironment').value = settings.environment || 'PROD';
}

document.getElementById('saveUberEatsSettings').addEventListener('click', async () => {
  const status = document.getElementById('uberEatsSettingsStatus');
  status.textContent = 'Kaydediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/uber-eats-settings', {
    method: 'POST',
    body: JSON.stringify({
      supplierId: document.getElementById('uberSupplierId').value.trim(),
      integrationRef: document.getElementById('uberIntegrationRef').value.trim(),
      storeId: document.getElementById('uberStoreId').value.trim(),
      apiKey: document.getElementById('uberApiKey').value.trim(),
      apiSecret: document.getElementById('uberApiSecret').value.trim(),
      channel: document.getElementById('uberChannel').value,
      environment: document.getElementById('uberEnvironment').value
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok) {
    status.textContent = result.health?.message || 'Uber Eats ayarları kaydedildi.';
    await loadUberEatsSettings();
  } else {
    status.textContent = result.error || 'Kaydedilemedi.';
  }
});

async function loadYemeksepetiSettings() {
  const response = await window.BuyBoxCommon.authFetch('/api/yemeksepeti-settings');
  if (!response.ok) return;
  const settings = await response.json();
  document.getElementById('ysChainId').value = settings.chainId || '';
  document.getElementById('ysVendorId').value = settings.vendorId || '';
  document.getElementById('ysClientId').value = '';
  document.getElementById('ysClientId').placeholder = settings.clientIdConfigured
    ? 'Kayıtlı — değiştirmek için yeni Client ID girin'
    : 'Client ID';
  document.getElementById('ysClientSecret').value = '';
  document.getElementById('ysClientSecret').placeholder = settings.clientSecretConfigured
    ? 'Kayıtlı — değiştirmek için yeni secret girin'
    : 'Client Secret';
  const portalLink = document.getElementById('ysPartnerPortalLink');
  if (portalLink && settings.partnerPortalUrl) {
    portalLink.href = settings.partnerPortalUrl;
  }
}

document.getElementById('saveYemeksepetiSettings').addEventListener('click', async () => {
  const status = document.getElementById('yemeksepetiSettingsStatus');
  status.textContent = 'Kaydediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/yemeksepeti-settings', {
    method: 'POST',
    body: JSON.stringify({
      chainId: document.getElementById('ysChainId').value.trim(),
      vendorId: document.getElementById('ysVendorId').value.trim(),
      clientId: document.getElementById('ysClientId').value.trim(),
      clientSecret: document.getElementById('ysClientSecret').value.trim()
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok) {
    status.textContent = result.health?.message || 'Yemeksepeti ayarları kaydedildi.';
    await loadYemeksepetiSettings();
  } else {
    status.textContent = result.error || 'Kaydedilemedi.';
  }
});

document.getElementById('testYemeksepetiBtn')?.addEventListener('click', async () => {
  const status = document.getElementById('yemeksepetiSettingsStatus');
  status.textContent = 'Bağlantı test ediliyor (OAuth + katalog + sipariş)…';
  const response = await window.BuyBoxCommon.authFetch('/api/yemeksepeti/status');
  const result = await response.json().catch(() => ({}));
  status.textContent = result.message || (response.ok ? 'Bağlantı OK.' : (result.error || 'Bağlantı başarısız.'));
});

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

document.getElementById('saveBenimposSettings').addEventListener('click', async () => {
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
  if (response.ok) {
    status.textContent = result.health?.message || 'BenimPOS ayarları kaydedildi.';
    await loadBenimposSettings();
  } else {
    status.textContent = result.error || 'Kaydedilemedi.';
  }
});

document.getElementById('testBenimposBtn').addEventListener('click', async () => {
  const status = document.getElementById('benimposSettingsStatus');
  status.textContent = 'Bağlantı test ediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/benimpos/status');
  const result = await response.json().catch(() => ({}));
  status.textContent = result.message || (response.ok ? 'Bağlantı OK.' : (result.error || 'Bağlantı başarısız.'));
});

document.getElementById('syncBenimposCostsBtn').addEventListener('click', async () => {
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

loadBenimposSettings().catch(() => {});
loadWooCommerceSettings().catch(() => {});

async function loadWooCommerceSettings() {
  const response = await window.BuyBoxCommon.authFetch('/api/woocommerce-settings');
  if (!response.ok) return;
  const settings = await response.json();
  document.getElementById('wooBaseUrl').value = settings.baseUrl || '';
  document.getElementById('wooKey').value = '';
  document.getElementById('wooKey').placeholder = settings.keyConfigured
    ? 'Kayıtlı — değiştirmek için yeni key girin'
    : 'Consumer Key (ck_…)';
  document.getElementById('wooSecret').value = '';
  document.getElementById('wooSecret').placeholder = settings.secretConfigured
    ? 'Kayıtlı — değiştirmek için yeni secret girin'
    : 'Consumer Secret (cs_…)';
}

document.getElementById('saveWooCommerceSettings').addEventListener('click', async () => {
  const status = document.getElementById('woocommerceSettingsStatus');
  status.textContent = 'Kaydediliyor ve bağlantı test ediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/woocommerce-settings', {
    method: 'POST',
    body: JSON.stringify({
      baseUrl: document.getElementById('wooBaseUrl').value.trim(),
      key: document.getElementById('wooKey').value.trim(),
      secret: document.getElementById('wooSecret').value.trim()
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok) {
    status.textContent = result.health?.message || 'WooCommerce ayarları kaydedildi.';
    await loadWooCommerceSettings();
  } else {
    status.textContent = result.error || 'Kaydedilemedi.';
  }
});

document.getElementById('testWooCommerceBtn').addEventListener('click', async () => {
  const status = document.getElementById('woocommerceSettingsStatus');
  status.textContent = 'Bağlantı test ediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/woocommerce/status');
  const result = await response.json().catch(() => ({}));
  status.textContent = result.message || (response.ok ? 'Bağlantı OK.' : (result.error || 'Bağlantı başarısız.'));
});

async function loadDhlSettings() {
  const customerEl = document.getElementById('dhlCustomerNumber');
  if (!customerEl) return;
  const response = await window.BuyBoxCommon.authFetch('/api/dhl-settings');
  if (!response.ok) return;
  const settings = await response.json();
  customerEl.value = settings.customerNumber || '';
  document.getElementById('dhlClientId').value = '';
  document.getElementById('dhlClientId').placeholder = settings.clientIdConfigured
    ? 'Kayıtlı — değiştirmek için yeni Client ID girin'
    : 'X-IBM-Client-Id';
  document.getElementById('dhlClientSecret').value = '';
  document.getElementById('dhlClientSecret').placeholder = settings.clientSecretConfigured
    ? 'Kayıtlı — değiştirmek için yeni secret girin'
    : 'X-IBM-Client-Secret';
  document.getElementById('dhlPassword').value = '';
  document.getElementById('dhlPassword').placeholder = settings.passwordConfigured
    ? 'Kayıtlı — değiştirmek için yeni şifre girin'
    : 'DHL panel şifresi';
  document.getElementById('dhlEnvironment').value = settings.environment || 'PROD';
}

async function saveDhlSettings() {
  const status = document.getElementById('dhlSettingsStatus');
  status.textContent = 'Kaydediliyor...';
  const response = await window.BuyBoxCommon.authFetch('/api/dhl-settings', {
    method: 'POST',
    body: JSON.stringify({
      customerNumber: document.getElementById('dhlCustomerNumber').value.trim(),
      clientId: document.getElementById('dhlClientId').value.trim(),
      clientSecret: document.getElementById('dhlClientSecret').value.trim(),
      password: document.getElementById('dhlPassword').value.trim(),
      environment: document.getElementById('dhlEnvironment').value
    })
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok) {
    status.textContent = result.health?.message || 'DHL ayarları kaydedildi.';
    await loadDhlSettings();
  } else {
    status.textContent = result.error || 'Kaydedilemedi.';
  }
}

const saveDhlBtn = document.getElementById('saveDhlSettings');
if (saveDhlBtn) {
  saveDhlBtn.addEventListener('click', () => saveDhlSettings().catch(() => {}));
}

const testDhlBtn = document.getElementById('testDhlBtn');
if (testDhlBtn) {
  testDhlBtn.addEventListener('click', async () => {
    const status = document.getElementById('dhlSettingsStatus');
    status.textContent = 'Bağlantı test ediliyor...';
    await saveDhlSettings();
  });
}

loadDhlSettings().catch(() => {});

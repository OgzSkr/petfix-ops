'use strict';

const bootstrap = window.__OPS_INTEGRATIONS__ || { authRequired: true };
const ops = window.OpsCommon;

const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');
const integrationCards = document.getElementById('integrationCards');
const setupAlerts = document.getElementById('setupAlerts');
const setupAlertsList = document.getElementById('setupAlertsList');
const backBtn = document.getElementById('backBtn');
const detailTitle = document.getElementById('detailTitle');
const detailSummary = document.getElementById('detailSummary');
const detailStatus = document.getElementById('detailStatus');
const detailOpsNote = document.getElementById('detailOpsNote');
const detailGate = document.getElementById('detailGate');
const detailLastTest = document.getElementById('detailLastTest');
const prerequisiteBox = document.getElementById('prerequisiteBox');
const setupChecklist = document.getElementById('setupChecklist');
const setupChecklistTitle = document.getElementById('setupChecklistTitle');
const setupChecklistProgress = document.getElementById('setupChecklistProgress');
const setupChecklistItems = document.getElementById('setupChecklistItems');
const portalLink = document.getElementById('portalLink');
const webhookSetup = document.getElementById('webhookSetup');
const webhookFields = document.getElementById('webhookFields');
const configForm = document.getElementById('configForm');
const formFields = document.getElementById('formFields');
const autoAcceptOrders = document.getElementById('autoAcceptOrders');
const autoAcceptWrap = document.getElementById('autoAcceptWrap');
const enabledToggle = document.getElementById('enabledToggle');
const testBtn = document.getElementById('testBtn');
const testResult = document.getElementById('testResult');
const workerPanelBody = document.getElementById('workerPanelBody');
const pollEnabledToggle = document.getElementById('pollEnabledToggle');
const pollIntervalInput = document.getElementById('pollIntervalInput');
const matchingEnabledToggle = document.getElementById('matchingEnabledToggle');
const saveWorkerSettingsBtn = document.getElementById('saveWorkerSettingsBtn');
const runPollBtn = document.getElementById('runPollBtn');
const runMatchingBtn = document.getElementById('runMatchingBtn');
const runDailyBtn = document.getElementById('runDailyBtn');
const workerActionResult = document.getElementById('workerActionResult');
const capabilitiesPanel = document.getElementById('capabilitiesPanel');
const guideSteps = document.getElementById('guideSteps');
const detailLogo = document.getElementById('detailLogo');
const intStatTotal = document.getElementById('intStatTotal');
const intStatConnected = document.getElementById('intStatConnected');
const intStatAttention = document.getElementById('intStatAttention');

const OPS_REGISTRY = {
  trendyol_go: 'uber-eats',
  yemeksepeti: 'yemeksepeti',
  getir: 'getir'
};

const CAP_LABELS = {
  fetchOrders: 'Sipariş',
  syncProducts: 'Ürün sync',
  updateStock: 'Stok',
  updatePrice: 'Fiyat',
  updateOrderStatus: 'Durum',
  handleWebhook: 'Webhook'
};

let controlBoard = null;
let currentChannel = null;
let webhooks = null;

function renderWorkerPanel(board) {
  if (!workerPanelBody || !board) return;
  const poll = board.workers?.opsPoll;
  const match = board.workers?.matchingSync;
  const pollOn = poll?.settings?.enabled;
  const pollLine = poll
    ? `Sipariş çekme: ${pollOn ? 'açık' : 'kapalı'}${poll.scheduled ? ' (zamanlayıcı aktif)' : ''} · ${poll.settings?.intervalMinutes || 2} dk aralık`
    : 'Sipariş çekme: —';
  const pollRun = poll?.lastRunAt ? `Son: ${ops.formatTime(poll.lastRunAt)}${poll.lastRunOk === false ? ' (hata)' : ''}` : '';
  const matchLine = match?.settings
    ? `Ürün güncelleme: ${match.settings.enabled ? 'açık' : 'kapalı'} · ${match.settings.intervalMinutes || '?'} dk aralık`
    : 'Ürün güncelleme: —';
  workerPanelBody.innerHTML = `<p>${ops.escapeHtml(pollLine)}${pollRun ? ` · ${ops.escapeHtml(pollRun)}` : ''}</p><p>${ops.escapeHtml(matchLine)}</p>`;

  if (pollEnabledToggle) {
    pollEnabledToggle.checked = Boolean(poll?.settings?.enabled);
  }
  if (pollIntervalInput && poll?.settings?.intervalMinutes) {
    pollIntervalInput.value = String(poll.settings.intervalMinutes);
  }
  if (matchingEnabledToggle && match?.settings) {
    matchingEnabledToggle.checked = Boolean(match.settings.enabled);
  }
}

function renderCapabilities(opsChannel) {
  if (!capabilitiesPanel) return;
  const registryId = OPS_REGISTRY[opsChannel];
  const row = (controlBoard?.opsChannels || []).find((c) => c.registryId === registryId);
  if (!row?.capabilities) {
    capabilitiesPanel.textContent = '—';
    return;
  }
  capabilitiesPanel.innerHTML = Object.entries(row.capabilities)
    .map(([key, value]) => {
      const label = CAP_LABELS[key] || key;
      const cls = value === false ? 'missing' : 'connected';
      const text = value === false ? `${label}: yok` : `${label}: ${value}`;
      return `<span class="ops-int-pill ${cls}" style="margin:2px 4px 2px 0">${ops.escapeHtml(text)}</span>`;
    })
    .join('');
}

async function loadControlBoard() {
  try {
    controlBoard = await ops.api('/api/channels/control-board');
    renderWorkerPanel(controlBoard);
  } catch (error) {
    if (workerPanelBody) {
      workerPanelBody.textContent = `Kontrol paneli yüklenemedi: ${error.message}`;
    }
  }
  return controlBoard;
}

async function saveWorkerSettings() {
  if (!workerActionResult) return;
  const ok = await ops.confirmAction({
    title: 'Otomasyon ayarlarını kaydet?',
    body: 'Sipariş çekme ve ürün güncelleme zamanlaması değişecek.',
    confirmLabel: 'Kaydet'
  });
  if (!ok) return;

  workerActionResult.textContent = 'Kaydediliyor…';
  workerActionResult.className = 'ops-feedback';
  window.PfStatus?.loading?.('Otomasyon ayarları kaydediliyor');
  try {
    await Promise.all([
      ops.api('/api/ops/poll/settings', {
        method: 'POST',
        body: JSON.stringify({
          enabled: pollEnabledToggle?.checked === true,
          intervalMinutes: Number(pollIntervalInput?.value || 2)
        })
      }),
      ops.api('/api/product-matching/sync-schedule', {
        method: 'POST',
        body: JSON.stringify({
          enabled: matchingEnabledToggle?.checked === true
        })
      })
    ]);
    workerActionResult.textContent = 'Ayarlar kaydedildi';
    workerActionResult.className = 'ops-feedback ok';
    window.PfStatus?.success?.('Otomasyon ayarları kaydedildi', 'Sipariş ve ürün güncelleme zamanlaması güncellendi');
    await loadControlBoard();
  } catch (error) {
    workerActionResult.textContent = error.message;
    workerActionResult.className = 'ops-feedback err';
    window.PfStatus?.error?.('Ayarlar kaydedilemedi', error.message);
  }
}

async function runWorkerAction(action) {
  if (!workerActionResult) return;

  const messages = {
    'ops-poll': {
      title: 'Şimdi sipariş çekilsin mi?',
      body: 'Tüm açık mağazalardan yeni siparişler kontrol edilecek.',
      confirmLabel: 'Sipariş çek'
    },
    'matching-sync': {
      title: 'Şimdi ürün listesi güncellensin mi?',
      body: 'Kanallardaki ürün katalogları yeniden indirilecek.',
      confirmLabel: 'Güncelle'
    },
    'daily-sync': {
      title: 'Gün sonu senkron çalıştırılsın mı?',
      body: 'Bu işlem birkaç dakika sürebilir. Devam etmek istiyor musunuz?',
      confirmLabel: 'Çalıştır'
    }
  };
  const prompt = messages[action] || {
    title: 'İşlemi çalıştır?',
    body: 'Bu işlem arka planda çalışacak.',
    confirmLabel: 'Onayla'
  };
  const ok = await ops.confirmAction(prompt);
  if (!ok) return;

  workerActionResult.textContent = 'Çalışıyor…';
  workerActionResult.className = 'ops-feedback';
  const statusLabels = {
    'ops-poll': 'Siparişler çekiliyor',
    'matching-sync': 'Ürün listeleri güncelleniyor',
    'daily-sync': 'Gün sonu senkron çalışıyor'
  };
  window.PfStatus?.loading?.(statusLabels[action] || 'İşlem çalışıyor', 'Bu birkaç dakika sürebilir');
  try {
    const data = await ops.api('/api/channels/control/actions', {
      method: 'POST',
      body: JSON.stringify({ action })
    });
    const skipped = data.skipped;
    const hasErrors = data.ok === false;
    workerActionResult.textContent = skipped
      ? `Atlandı: ${data.reason || 'bilinmiyor'}`
      : hasErrors
        ? 'Tamamlandı (hatalar var — logları kontrol edin)'
        : 'Tamamlandı';
    workerActionResult.className = hasErrors ? 'ops-feedback err' : 'ops-feedback ok';
    if (skipped) {
      window.PfStatus?.error?.('İşlem atlandı', data.reason || 'Bilinmeyen neden');
    } else if (hasErrors) {
      window.PfStatus?.error?.('İşlem tamamlandı', 'Bazı adımlarda hata oluştu — Sistem Nabzı\'na bakın');
    } else {
      window.PfStatus?.success?.('İşlem tamamlandı', statusLabels[action] || 'Arka plan görevi bitti');
    }
    await loadControlBoard();
  } catch (error) {
    workerActionResult.textContent = error.message;
    workerActionResult.className = 'ops-feedback err';
    window.PfStatus?.error?.('İşlem başarısız', error.message);
  }
}

function channelLogoId(channel) {
  return OPS_REGISTRY[channel] || channel;
}

function renderChannelLogoHtml(channel, size = 'md') {
  const logos = window.PetFixChannelLogos;
  if (!logos?.render) return '';
  return logos.render(channelLogoId(channel), { size });
}

function updateIntegrationStats(integrations) {
  const total = integrations.length;
  const connected = integrations.filter((row) => row.status === 'connected').length;
  const attention = integrations.filter((row) =>
    row.status === 'missing' || row.status === 'error' || row.status === 'disabled'
  ).length;
  if (intStatTotal) intStatTotal.textContent = String(total);
  if (intStatConnected) intStatConnected.textContent = String(connected);
  if (intStatAttention) intStatAttention.textContent = String(attention);
}

function showListView() {
  currentChannel = null;
  listView.classList.remove('hidden');
  detailView.classList.add('hidden');
  history.replaceState(null, '', '/ops/integrations/');
}

function showDetailView(channel) {
  currentChannel = channel;
  listView.classList.add('hidden');
  detailView.classList.remove('hidden');
  history.replaceState(null, '', `/ops/integrations/?channel=${encodeURIComponent(channel)}`);
}

function renderCards(integrations) {
  integrationCards.innerHTML = '';
  updateIntegrationStats(integrations);
  const pending = [];

  if (!integrations.length) {
    integrationCards.innerHTML = `
      <div class="pf-empty-state ops-int-empty">
        <span class="pf-empty-icon" aria-hidden="true">⎔</span>
        <strong>Kanal bulunamadı</strong>
        <p>Bu şube için tanımlı entegrasyon yok.</p>
      </div>`;
    setupAlerts.classList.add('hidden');
    return;
  }

  for (const row of integrations) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `ops-int-card ops-int-card--${ops.escapeHtml(row.status || 'missing')}`;
    const userMsg = ops.gateUserMessage(row.gate, row.gateNote);
    const logoHtml = renderChannelLogoHtml(row.channel, 'lg');
    card.innerHTML = `
      <div class="ops-int-card-head">
        <span class="ops-int-card-logo">${logoHtml}</span>
        <div class="ops-int-card-title-wrap">
          <h3 class="ops-int-card-title">${ops.escapeHtml(row.label)}</h3>
          <span class="ops-int-pill ${ops.escapeHtml(row.status)}">${ops.escapeHtml(ops.integrationStatusLabel(row.status))}</span>
        </div>
      </div>
      <p class="ops-int-card-msg">${ops.escapeHtml(userMsg)}</p>
      <p class="ops-int-card-meta">${row.lastTestAt ? `Son test: ${ops.formatTime(row.lastTestAt)}` : 'Henüz test edilmedi'}</p>
      <span class="ops-int-card-cta">Ayarları aç →</span>`;
    card.addEventListener('click', () => openChannel(row.channel));
    integrationCards.appendChild(card);

    if (row.status === 'missing' || row.status === 'error') {
      pending.push({ label: row.label, channel: row.channel, msg: userMsg });
    }
  }

  if (pending.length) {
    setupAlerts.classList.remove('hidden');
    setupAlertsList.innerHTML = pending
      .map((item) => `<li><strong>${ops.escapeHtml(item.label)}:</strong> ${ops.escapeHtml(item.msg)}</li>`)
      .join('');
  } else {
    setupAlerts.classList.add('hidden');
  }
}

async function loadList(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    window.PfStatus?.loading?.('Kanallar yükleniyor', 'Bağlantı durumları kontrol ediliyor');
  }
  try {
    const data = await ops.api('/ops/v1/integrations');
    webhooks = data.webhooks?.endpoints || null;
    renderCards(data.integrations || []);
    if (!silent) {
      const count = (data.integrations || []).length;
      window.PfStatus?.success?.('Kanallar hazır', `${count} kanal listelendi`);
    }
  } catch (error) {
    if (!silent) {
      window.PfStatus?.error?.('Kanallar yüklenemedi', error.message);
    }
    throw error;
  }
}

function applyShadowLocks() {
  const shadow = ops.isShadowMode();
  autoAcceptOrders.disabled = shadow;
  if (shadow) {
    autoAcceptOrders.checked = false;
    autoAcceptWrap.title = 'Eğitim modunda otomatik kabul kapalı';
  }
}

function checklistStatusLabel(status) {
  if (status === 'done') return 'Tamam';
  if (status === 'warn') return 'Eksik';
  return 'Bekliyor';
}

function renderSetupChecklist(checklist) {
  if (!setupChecklist || !checklist?.items?.length) {
    setupChecklist?.classList.add('hidden');
    return;
  }
  setupChecklist.classList.remove('hidden');
  setupChecklistTitle.textContent = checklist.title || 'Kurulum kontrol listesi';
  setupChecklistProgress.textContent = checklist.progress || '';

  setupChecklistItems.innerHTML = checklist.items.map((item) => {
    const copyBtns = [];
    if (item.copyValue) {
      copyBtns.push(`<button type="button" class="ops-btn ops-btn-secondary ops-btn-sm" data-copy="${ops.escapeHtml(item.copyValue)}">${ops.escapeHtml(item.copyLabel || 'Kopyala')}</button>`);
    }
    if (item.copyValue2) {
      copyBtns.push(`<button type="button" class="ops-btn ops-btn-secondary ops-btn-sm" data-copy="${ops.escapeHtml(item.copyValue2)}">${ops.escapeHtml(item.copyLabel2 || 'URL kopyala')}</button>`);
    }
    const link = item.href
      ? ` <a href="${ops.escapeHtml(item.href)}" class="ops-inline-link">Aç →</a>`
      : '';
    return `<li class="ops-checklist-item ops-checklist-item--${ops.escapeHtml(item.status || 'pending')}">
      <span class="ops-checklist-status">${ops.escapeHtml(checklistStatusLabel(item.status))}</span>
      <div class="ops-checklist-body">
        <strong>${ops.escapeHtml(item.label)}</strong>
        <p class="ops-meta">${ops.escapeHtml(item.hint || '')}${link}</p>
        ${copyBtns.length ? `<div class="ops-checklist-actions">${copyBtns.join('')}</div>` : ''}
      </div>
    </li>`;
  }).join('');
  ops.bindCopyButtons(setupChecklistItems);
}

function renderDetailForm(detail) {
  const { meta, config, guide, enabled, status } = detail;
  if (detailLogo) {
    detailLogo.innerHTML = renderChannelLogoHtml(detail.channel, 'lg');
  }
  detailTitle.textContent = meta.label;
  detailSummary.textContent = ops.gateUserMessage(meta.gate, meta.gateNote);
  detailStatus.textContent = ops.integrationStatusLabel(status || 'missing');
  detailStatus.className = `ops-int-pill ${status || 'missing'}`;

  detailGate.textContent = meta.gate ? `Teknik kapı: ${meta.gate}` : '';
  detailLastTest.textContent = detail.lastTestMessage
    ? `Son test: ${detail.lastTestMessage}`
    : detail.lastTestAt
      ? `Son test zamanı: ${ops.formatTime(detail.lastTestAt)}`
      : '';

  detailOpsNote.textContent =
    status === 'connected'
      ? 'Kanal bağlı ve sipariş alımına hazır.'
      : status === 'ready'
        ? 'Bağlantı bilgileri tamam — test ederek doğrulayın.'
        : 'Kurulum adımlarını tamamlayın.';

  if (guide.prerequisite) {
    prerequisiteBox.textContent = guide.prerequisite;
    prerequisiteBox.classList.remove('hidden');
  } else {
    prerequisiteBox.classList.add('hidden');
  }

  renderSetupChecklist(detail.setupChecklist);

  guideSteps.innerHTML = (guide.steps || [])
    .map((step) => `<li>${ops.escapeHtml(ops.humanizeGuideStep(step))}</li>`)
    .join('');
  portalLink.href = guide.portalUrl || '#';

  formFields.innerHTML = (guide.fields || [])
    .map((field) => {
      const isSecret = field.type === 'password';
      const value = isSecret ? '' : config[field.key] || '';
      const placeholder = isSecret && config[field.key] ? 'Kayıtlı — değiştirmek için yazın' : field.placeholder || '';
      return `
        <div class="ops-field">
          <label class="ops-field-label" for="field-${field.key}">${ops.escapeHtml(field.label)}</label>
          <input id="field-${field.key}" name="${ops.escapeHtml(field.key)}" type="${isSecret ? 'password' : 'text'}"
            value="${ops.escapeHtml(value)}" placeholder="${ops.escapeHtml(placeholder)}" autocomplete="off">
        </div>`;
    })
    .join('');

  autoAcceptOrders.checked = config.autoAcceptOrders !== false && !ops.isShadowMode();
  enabledToggle.checked = enabled !== false;
  applyShadowLocks();

  if (detail.channel === 'yemeksepeti' && webhooks) {
    webhookSetup.classList.remove('hidden');
    const portalItem = (detail.setupChecklist?.items || []).find((i) => i.id === 'webhook_portal');
    const portalSecret = portalItem?.copyValue || '';
    webhookFields.innerHTML =
      ops.renderCopyField('Sipariş Webhook URL', webhooks.yemeksepetiOrders) +
      ops.renderCopyField('Portal Secret (Basic)', portalSecret, { secret: true }) +
      ops.renderCopyField('Sunucu Webhook Secret', config.webhookSecret || '', { secret: true });
    ops.bindCopyButtons(webhookFields);
  } else if (detail.channel === 'getir' && webhooks) {
    webhookSetup.classList.remove('hidden');
    webhookFields.innerHTML =
      ops.renderCopyField('Yeni Sipariş Webhook URL', webhooks.getirOrdersNew) +
      ops.renderCopyField('İptal Webhook URL', webhooks.getirOrdersCancelled) +
      ops.renderCopyField('x-api-key (form + sunucu)', config.webhookSecret || '', { secret: true });
    ops.bindCopyButtons(webhookFields);
  } else {
    webhookSetup.classList.add('hidden');
  }

  testResult.textContent = '';
  testResult.className = 'ops-feedback';
  renderCapabilities(detail.channel);
}

async function openChannel(channel) {
  showDetailView(channel);
  try {
    const [detail, listData] = await Promise.all([
      ops.api(`/ops/v1/integrations/${encodeURIComponent(channel)}`),
      ops.api('/ops/v1/integrations')
    ]);
    if (detail.webhooks?.endpoints) {
      webhooks = detail.webhooks.endpoints;
    }
    const row = (listData.integrations || []).find((item) => item.channel === channel);
    renderDetailForm({
      ...detail,
      status: row?.status || 'missing',
      lastTestAt: row?.lastTestAt,
      lastTestMessage: row?.lastTestMessage
    });
  } catch (error) {
    ops.showToast(error.message);
  }
}

function collectFormConfig() {
  const config = {};
  formFields.querySelectorAll('input[name]').forEach((input) => {
    const value = input.value.trim();
    if (value) {
      config[input.name] = value;
    }
  });
  return config;
}

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentChannel) return;

  const channelLabel = detailTitle?.textContent || 'Bu mağaza';
  const enabled = enabledToggle.checked;
  const ok = await ops.confirmAction({
    title: `${channelLabel} ayarlarını kaydet?`,
    body: enabled
      ? 'Kaydettiğinizde mağaza etkinleştirilir ve bağlantı bilgileri uygulanır.'
      : 'Mağaza kapalı olarak kaydedilecek; yeni sipariş alınmaz.',
    confirmLabel: 'Kaydet'
  });
  if (!ok) return;

  try {
    const payload = {
      config: collectFormConfig(),
      autoAcceptOrders: ops.isShadowMode() ? false : autoAcceptOrders.checked,
      enabled: enabledToggle.checked
    };
    await ops.api(`/ops/v1/integrations/${encodeURIComponent(currentChannel)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    ops.showToast('Ayarlar kaydedildi');
    window.PfStatus?.success?.('Kanal ayarları kaydedildi');
    await openChannel(currentChannel);
    await loadList({ silent: true });
  } catch (error) {
    ops.showToast(error.message);
  }
});

testBtn.addEventListener('click', async () => {
  if (!currentChannel) return;
  testResult.textContent = 'Test ediliyor...';
  testResult.className = 'ops-feedback';
  window.PfStatus?.loading?.('Bağlantı test ediliyor');

  try {
    const data = await ops.api(`/ops/v1/integrations/${encodeURIComponent(currentChannel)}/test`, {
      method: 'POST',
      body: JSON.stringify({ config: collectFormConfig() })
    });
    testResult.textContent = data.message || (data.ok ? 'Bağlantı başarılı' : 'Test başarısız');
    testResult.className = data.ok ? 'ops-feedback ok' : 'ops-feedback err';
    detailStatus.textContent = ops.integrationStatusLabel(data.ok ? 'connected' : 'error');
    detailStatus.className = `ops-int-pill ${data.ok ? 'connected' : 'error'}`;
    if (data.ok) {
      window.PfStatus?.success?.('Bağlantı başarılı', data.message || 'Kanal erişilebilir');
    } else {
      window.PfStatus?.error?.('Bağlantı testi başarısız', data.message || 'Ayarları kontrol edin');
    }
    await loadList({ silent: true });
  } catch (error) {
    testResult.textContent = error.message;
    testResult.className = 'ops-feedback err';
    window.PfStatus?.error?.('Bağlantı testi başarısız', error.message);
  }
});

backBtn.addEventListener('click', () => {
  showListView();
  loadList();
  loadControlBoard();
});

saveWorkerSettingsBtn?.addEventListener('click', () => saveWorkerSettings());
runPollBtn?.addEventListener('click', () => runWorkerAction('ops-poll'));
runMatchingBtn?.addEventListener('click', () => runWorkerAction('matching-sync'));
runDailyBtn?.addEventListener('click', () => runWorkerAction('daily-sync'));

async function init() {
  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({
    authRequired: bootstrap.authRequired,
    onRefresh: () => (currentChannel ? openChannel(currentChannel) : loadList())
  });
  await ops.loadOpsConfig();
  await loadControlBoard();

  const initialChannel = new URLSearchParams(window.location.search).get('channel');
  if (initialChannel) {
    await openChannel(initialChannel);
  } else {
    showListView();
    await loadList();
  }

  window.onPanelRefresh = async () => {
    await loadControlBoard();
    if (currentChannel) {
      await openChannel(currentChannel);
    } else {
      await loadList({ silent: true });
    }
  };
}

init().catch((error) => ops.showToast(error.message));

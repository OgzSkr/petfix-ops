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

let currentChannel = null;
let webhooks = null;

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
  const pending = [];

  for (const row of integrations) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ops-int-card';
    const userMsg = ops.gateUserMessage(row.gate, row.gateNote);
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px">
        <h3 style="margin:0;font-size:1.05rem">${ops.escapeHtml(row.label)}</h3>
        <span class="ops-int-pill ${ops.escapeHtml(row.status)}">${ops.escapeHtml(ops.integrationStatusLabel(row.status))}</span>
      </div>
      <p class="ops-meta">${ops.escapeHtml(userMsg)}</p>
      <p class="ops-meta">${row.lastTestAt ? `Son test: ${ops.formatTime(row.lastTestAt)}` : 'Henüz test edilmedi'}</p>`;
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

async function loadList() {
  const data = await ops.api('/ops/v1/integrations');
  webhooks = data.webhooks?.endpoints || null;
  renderCards(data.integrations || []);
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
    webhookFields.innerHTML = ops.renderCopyField('Getir Webhook URL', webhooks.getirOrders);
    ops.bindCopyButtons(webhookFields);
  } else {
    webhookSetup.classList.add('hidden');
  }

  testResult.textContent = '';
  testResult.className = 'ops-feedback';
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
    await openChannel(currentChannel);
    await loadList();
  } catch (error) {
    ops.showToast(error.message);
  }
});

testBtn.addEventListener('click', async () => {
  if (!currentChannel) return;
  testResult.textContent = 'Test ediliyor...';
  testResult.className = 'ops-feedback';

  try {
    const data = await ops.api(`/ops/v1/integrations/${encodeURIComponent(currentChannel)}/test`, {
      method: 'POST',
      body: JSON.stringify({ config: collectFormConfig() })
    });
    testResult.textContent = data.message || (data.ok ? 'Bağlantı başarılı' : 'Test başarısız');
    testResult.className = data.ok ? 'ops-feedback ok' : 'ops-feedback err';
    detailStatus.textContent = ops.integrationStatusLabel(data.ok ? 'connected' : 'error');
    detailStatus.className = `ops-int-pill ${data.ok ? 'connected' : 'error'}`;
    await loadList();
  } catch (error) {
    testResult.textContent = error.message;
    testResult.className = 'ops-feedback err';
  }
});

backBtn.addEventListener('click', () => {
  showListView();
  loadList();
});

async function init() {
  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({
    authRequired: bootstrap.authRequired,
    onRefresh: () => (currentChannel ? openChannel(currentChannel) : loadList())
  });
  await ops.loadOpsConfig();

  const initialChannel = new URLSearchParams(window.location.search).get('channel');
  if (initialChannel) {
    await openChannel(initialChannel);
  } else {
    showListView();
    await loadList();
  }
}

init().catch((error) => ops.showToast(error.message));

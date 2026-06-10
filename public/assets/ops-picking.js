'use strict';

const bootstrap = window.__OPS_PICKING__ || { authRequired: true };
const ops = window.OpsCommon;

const listView = document.getElementById('listView');
const pickView = document.getElementById('pickView');
const queueList = document.getElementById('queueList');
const queueEmpty = document.getElementById('queueEmpty');
const channelFilters = document.getElementById('channelFilters');
const backBtn = document.getElementById('backBtn');
const orderTitle = document.getElementById('orderTitle');
const orderMeta = document.getElementById('orderMeta');
const orderStatus = document.getElementById('orderStatus');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const scanForm = document.getElementById('scanForm');
const barcodeInput = document.getElementById('barcodeInput');
const scanFeedback = document.getElementById('scanFeedback');
const linesList = document.getElementById('linesList');
const startPickBtn = document.getElementById('startPickBtn');
const completePickBtn = document.getElementById('completePickBtn');
const channelActions = document.getElementById('channelActions');
const channelFlagHint = document.getElementById('channelFlagHint');
const channelAcceptBtn = document.getElementById('channelAcceptBtn');
const channelReadyBtn = document.getElementById('channelReadyBtn');
const benimposActions = document.getElementById('benimposActions');
const benimposFlagHint = document.getElementById('benimposFlagHint');
const benimposSalesHint = document.getElementById('benimposSalesHint');
const benimposPreviewBtn = document.getElementById('benimposPreviewBtn');
const benimposSaleBtn = document.getElementById('benimposSaleBtn');
const benimposCancelBtn = document.getElementById('benimposCancelBtn');
const emptyRefreshBtn = document.getElementById('emptyRefreshBtn');
const matchingBanner = document.getElementById('matchingBanner');

let currentOrderId = null;
let activeChannel = '';

function showListView() {
  currentOrderId = null;
  listView.classList.remove('hidden');
  pickView.classList.add('hidden');
  history.replaceState(null, '', '/ops/');
  ops.startAutoRefresh(loadQueue);
}

function showPickView(orderId) {
  currentOrderId = orderId;
  listView.classList.add('hidden');
  pickView.classList.remove('hidden');
  history.replaceState(null, '', `/ops/?order=${encodeURIComponent(orderId)}`);
  ops.stopAutoRefresh();
}

async function loadQueue() {
  queueList.innerHTML = '';
  queueEmpty.classList.add('hidden');

  const query = new URLSearchParams({ queue: 'picking', limit: '100' });
  if (activeChannel) query.set('channel', activeChannel);

  try {
    const data = await ops.api(`/ops/v1/orders?${query}`);
    const orders = data.orders || [];
    if (!orders.length) {
      queueEmpty.classList.remove('hidden');
      return;
    }

    for (const order of orders) {
      const displayId = order.displayId || order.display_id || order.externalId || order.external_id;
      const orderedAt = order.orderedAt || order.ordered_at;
      const sla = ops.computeSla(orderedAt);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ops-order-card';
      if (sla.level === 'warn') card.classList.add('ops-order-card--warn');
      if (sla.level === 'critical') card.classList.add('ops-order-card--critical');

      const slaClass = sla.level === 'critical' ? ' ops-sla-badge--critical' : sla.level === 'warn' ? ' ops-sla-badge' : '';
      card.innerHTML = `
        <div class="ops-order-card-top">
          <span class="ops-order-card-id">#${ops.escapeHtml(displayId)}</span>
          <span class="${ops.channelBadgeClass(order.channel)}">${ops.escapeHtml(ops.channelLabel(order.channel))}</span>
        </div>
        <div class="ops-order-card-meta">
          <span class="ops-status-badge ops-status-badge--${ops.escapeHtml(order.status)}">${ops.escapeHtml(ops.statusLabel(order.status))}</span>
          <span class="ops-sla-badge${slaClass}">⏱ ${ops.escapeHtml(sla.label)}</span>
          <span>${ops.escapeHtml(ops.formatTime(orderedAt))}</span>
        </div>`;
      card.addEventListener('click', () => openOrder(order.id));
      queueList.appendChild(card);
    }
  } catch (error) {
    ops.showToast(error.message);
  }
}

async function openOrder(orderId) {
  showPickView(orderId);
  await refreshOrder();
  barcodeInput.focus();
}

async function refreshOrder() {
  if (!currentOrderId) return;
  try {
    const data = await ops.api(`/ops/v1/orders/${currentOrderId}/picking`);
    renderOrder(data);
  } catch (error) {
    ops.showToast(error.message);
  }
}

function renderOrder(data) {
  const order = data.order;
  const lines = data.lines || [];
  const progress = data.progress || {};
  const shadow = ops.isShadowMode();
  const canChannel = ops.canChannelWrite();
  const canBenimpos = ops.canBenimposWrite();

  orderTitle.textContent = `#${order.displayId}`;
  orderMeta.textContent = `${ops.channelLabel(order.channel)} · ${ops.formatTime(order.orderedAt)}`;
  orderStatus.textContent = ops.statusLabel(order.status);
  orderStatus.className = `ops-status-badge ops-status-badge--${order.status}`;

  const pct = progress.totalQty ? Math.round((progress.pickedQty / progress.totalQty) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${progress.completeLines || 0}/${progress.actionableLines || 0} satır · ${progress.pickedQty || 0}/${progress.totalQty || 0} adet toplandı`;

  linesList.innerHTML = '';
  let hasMatchingIssue = false;
  for (const line of lines) {
    const li = document.createElement('li');
    const done = line.pickedQty >= line.quantity;
    const matchClass = line.matchingStatus === 'blocked' ? ' blocked' : line.matchingStatus === 'unmapped' ? ' unmapped' : '';
    if (line.matchingStatus === 'blocked' || line.matchingStatus === 'unmapped') {
      hasMatchingIssue = true;
    }
    li.className = `ops-line${done ? ' done' : ''}${matchClass}`;
    li.innerHTML = `
      <div class="ops-line-title">${ops.escapeHtml(line.title || line.channelProductId)}</div>
      <div class="ops-line-meta">${ops.escapeHtml(line.barcode || 'Barkod yok')} · ${ops.escapeHtml(ops.matchingLabel(line.matchingStatus))}</div>
      <div class="ops-line-qty">${line.pickedQty} / ${line.quantity}</div>`;
    linesList.appendChild(li);
  }

  matchingBanner?.classList.toggle('hidden', !hasMatchingIssue);

  startPickBtn.disabled = order.status !== 'received';
  completePickBtn.disabled = !progress.isComplete || order.status === 'picked';
  completePickBtn.textContent = shadow ? 'Toplamayı bitir (eğitim)' : 'Toplamayı bitir';

  scanFeedback.textContent = '';
  scanFeedback.className = 'ops-feedback';

  const showChannel = ['picking', 'picked', 'ready'].includes(order.status);
  channelActions.classList.toggle('hidden', !showChannel);
  if (showChannel) {
    channelFlagHint.textContent = shadow
      ? 'Eğitim modunda kanal bildirimi kapalı.'
      : canChannel
        ? 'Canlı modda kanal bildirimi kullanılabilir.'
        : 'Kanal bildirimi yönetici tarafından henüz açılmadı.';
    const channelLocked = shadow || !canChannel;
    channelAcceptBtn.disabled = channelLocked || !['received', 'picking'].includes(order.status);
    channelReadyBtn.disabled = channelLocked || !['picked', 'picking'].includes(order.status);
  }

  const showBenimpos = ['picked', 'ready', 'completed'].includes(order.status);
  benimposActions.classList.toggle('hidden', !showBenimpos);
  if (showBenimpos) {
    benimposFlagHint.textContent = shadow
      ? 'Eğitim modunda kasa satışı kapalı.'
      : canBenimpos
        ? 'Canlı modda kasa satışı kullanılabilir.'
        : 'Kasa satışı yönetici tarafından henüz açılmadı.';
    const salesCode = order.benimposSalesCode;
    benimposSalesHint.textContent = salesCode ? `Kayıtlı satış: ${salesCode}` : 'Henüz kasa satışı oluşturulmadı.';
    const benimposLocked = shadow || !canBenimpos;
    benimposSaleBtn.disabled = benimposLocked || Boolean(salesCode) || order.status === 'received' || order.status === 'picking';
    benimposCancelBtn.disabled = benimposLocked || !salesCode;
    benimposPreviewBtn.disabled = order.status === 'received' || order.status === 'picking';
  }
}

scanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const barcode = barcodeInput.value.trim();
  if (!barcode || !currentOrderId) return;

  scanFeedback.textContent = 'Okunuyor...';
  scanFeedback.className = 'ops-feedback';

  try {
    const data = await ops.api(`/ops/v1/orders/${currentOrderId}/picking/scan`, {
      method: 'POST',
      body: JSON.stringify({ barcode })
    });
    renderOrder(data);
    scanFeedback.textContent = 'Ürün eklendi';
    scanFeedback.className = 'ops-feedback ok';
    ops.feedbackScanSuccess();
    barcodeInput.value = '';
    barcodeInput.focus();
  } catch (error) {
    scanFeedback.textContent = error.message;
    scanFeedback.className = 'ops-feedback err';
  }
});

startPickBtn.addEventListener('click', async () => {
  if (!currentOrderId) return;
  try {
    const data = await ops.api(`/ops/v1/orders/${currentOrderId}/picking/start`, { method: 'POST', body: '{}' });
    renderOrder(data);
    ops.showToast('Toplama başladı');
    barcodeInput.focus();
  } catch (error) {
    ops.showToast(error.message);
  }
});

completePickBtn.addEventListener('click', async () => {
  if (!currentOrderId) return;
  try {
    const data = await ops.api(`/ops/v1/orders/${currentOrderId}/picking/complete`, { method: 'POST', body: '{}' });
    renderOrder(data);
    ops.showToast(ops.isShadowMode() ? 'Toplama tamamlandı (eğitim)' : 'Toplama tamamlandı');
  } catch (error) {
    ops.showToast(error.message);
  }
});

backBtn.addEventListener('click', () => {
  showListView();
  loadQueue();
});

channelFilters?.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-channel]');
  if (!chip) return;
  activeChannel = chip.getAttribute('data-channel') || '';
  channelFilters.querySelectorAll('.ops-chip').forEach((el) => el.classList.remove('is-active'));
  chip.classList.add('is-active');
  loadQueue();
});

emptyRefreshBtn?.addEventListener('click', loadQueue);

async function guardedLiveAction({ title, body, action }) {
  if (ops.isShadowMode()) {
    ops.showToast('Eğitim modunda bu işlem kapalı');
    return;
  }
  const ok = await ops.confirmAction({ title, body, confirmLabel: 'Evet, devam et' });
  if (!ok) return;
  await action();
}

channelAcceptBtn.addEventListener('click', () =>
  guardedLiveAction({
    title: 'Kanala kabul bildir',
    body: 'Sipariş kanala kabul edilmiş olarak işaretlenecek. Devam edilsin mi?',
    action: async () => {
      const data = await ops.api(`/ops/v1/orders/${currentOrderId}/channel/accept`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      ops.showToast(data.dryRun ? 'Kabul simüle edildi' : 'Kanala kabul bildirildi');
      await refreshOrder();
    }
  })
);

channelReadyBtn.addEventListener('click', () =>
  guardedLiveAction({
    title: 'Hazır bildir',
    body: 'Sipariş kanala hazır olarak bildirilecek. Devam edilsin mi?',
    action: async () => {
      const data = await ops.api(`/ops/v1/orders/${currentOrderId}/channel/ready`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      ops.showToast(data.dryRun ? 'Hazır simüle edildi' : 'Kanala hazır bildirildi');
      await refreshOrder();
    }
  })
);

benimposPreviewBtn.addEventListener('click', async () => {
  if (!currentOrderId) return;
  try {
    const data = await ops.api(`/ops/v1/orders/${currentOrderId}/benimpos/preview`);
    const lineCount = data.saleLines?.length || 0;
    const skipped = data.skippedLines?.length || 0;
    ops.showToast(`Önizleme: ${lineCount} satır, ${skipped} atlandı`);
  } catch (error) {
    ops.showToast(error.message);
  }
});

benimposSaleBtn.addEventListener('click', () =>
  guardedLiveAction({
    title: 'Kasa satışı oluştur',
    body: 'BenimPOS üzerinde gerçek satış kaydı oluşturulacak. Devam edilsin mi?',
    action: async () => {
      const data = await ops.api(`/ops/v1/orders/${currentOrderId}/benimpos/sale`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      ops.showToast(
        data.duplicate
          ? `Satış zaten var: ${data.salesCode}`
          : data.dryRun
            ? 'Satış simüle edildi'
            : `Satış oluşturuldu: ${data.salesCode || ''}`
      );
      await refreshOrder();
    }
  })
);

benimposCancelBtn.addEventListener('click', () =>
  guardedLiveAction({
    title: 'Satış iptal',
    body: 'BenimPOS satış kaydı iptal edilecek. Devam edilsin mi?',
    action: async () => {
      const data = await ops.api(`/ops/v1/orders/${currentOrderId}/benimpos/cancel`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      ops.showToast(data.dryRun ? 'İptal simüle edildi' : 'Satış iptal edildi');
      await refreshOrder();
    }
  })
);

async function init() {
  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({
    authRequired: bootstrap.authRequired,
    onRefresh: () => (currentOrderId ? refreshOrder() : loadQueue())
  });
  await ops.loadOpsConfig();

  const initialOrder = new URLSearchParams(window.location.search).get('order');
  if (initialOrder) {
    await openOrder(initialOrder);
  } else {
    showListView();
    await loadQueue();
  }
}

init().catch((error) => ops.showToast(error.message));

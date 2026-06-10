'use strict';

const bootstrap = window.__OPS_DASHBOARD__ || { authRequired: true };
const ops = window.OpsCommon;

const kpiPending = document.getElementById('kpiPending');
const kpiPicking = document.getElementById('kpiPicking');
const kpiChannels = document.getElementById('kpiChannels');
const kpiAlerts = document.getElementById('kpiAlerts');
const urgentOrders = document.getElementById('urgentOrders');
const urgentEmpty = document.getElementById('urgentEmpty');
const channelSummary = document.getElementById('channelSummary');
const shadowOrderCount = document.getElementById('shadowOrderCount');
const shadowDayCount = document.getElementById('shadowDayCount');
const shadowIssueCount = document.getElementById('shadowIssueCount');
const shadowReadyLabel = document.getElementById('shadowReadyLabel');
const shadowOrderProgress = document.getElementById('shadowOrderProgress');
const shadowReadinessNote = document.getElementById('shadowReadinessNote');
const shadowIssueList = document.getElementById('shadowIssueList');

async function loadShadowReadiness(allOrders, shadowReport) {
  const total = shadowReport?.orders?.total ?? allOrders.length;
  const issues = shadowReport?.events?.issues ?? 0;
  const days = ops.computeShadowDays(allOrders);
  const ordersOk = total >= ops.SHADOW_MIN_ORDERS;
  const daysOk = days >= ops.SHADOW_MIN_DAYS;
  const issuesOk = issues === 0;
  const ready = ordersOk && daysOk && issuesOk;

  shadowOrderCount.textContent = String(total);
  shadowDayCount.textContent = String(days);
  shadowIssueCount.textContent = String(issues);
  shadowReadyLabel.textContent = ready ? 'Hazır' : 'Devam';
  shadowReadyLabel.style.color = ready ? 'var(--ops-status-ok)' : 'var(--ops-status-warn)';

  const pct = Math.min(100, Math.round((total / ops.SHADOW_MIN_ORDERS) * 100));
  shadowOrderProgress.style.width = `${pct}%`;

  const notes = [];
  if (!ordersOk) notes.push(`${ops.SHADOW_MIN_ORDERS - total} sipariş daha shadow deneyimi önerilir.`);
  if (!daysOk) notes.push(`${ops.SHADOW_MIN_DAYS - days} gün daha izleme önerilir.`);
  if (!issuesOk) notes.push('Eşleştirme uyarıları giderilmeli.');
  if (ready) notes.push('Kriterler karşılandı — yönetici canlı flag’leri açabilir.');
  shadowReadinessNote.textContent = notes.join(' ');

  const recent = shadowReport?.recentIssues || [];
  shadowIssueList.innerHTML = recent.length
    ? recent
        .slice(0, 5)
        .map(
          (item) =>
            `<li>${ops.escapeHtml(ops.shadowIssueLabel(item.payload))} — sipariş ${ops.escapeHtml(String(item.orderId || '').slice(0, 8))}…</li>`
        )
        .join('')
    : '<li class="ops-meta">Açık shadow uyarısı yok.</li>';
}

async function loadDashboard() {
  try {
    const [ordersRes, integrationsRes, allOrdersRes, shadowRes] = await Promise.all([
      ops.api('/ops/v1/orders?queue=picking&limit=100'),
      ops.api('/ops/v1/integrations'),
      ops.api('/ops/v1/orders?limit=200'),
      ops.api('/ops/v1/shadow/report').catch(() => ({ report: null }))
    ]);

    const orders = ordersRes.orders || [];
    const allOrders = allOrdersRes.orders || [];
    const integrations = integrationsRes.integrations || [];
    const shadowReport = shadowRes.report;

    const received = orders.filter((o) => o.status === 'received').length;
    const picking = orders.filter((o) => o.status === 'picking').length;
    const connected = integrations.filter((i) => i.status === 'connected').length;
    const alerts = integrations.filter((i) => i.status === 'error' || i.status === 'missing').length;

    kpiPending.textContent = String(received + picking);
    kpiPicking.textContent = String(picking);
    kpiChannels.textContent = String(connected);
    kpiAlerts.textContent = String(alerts);

    await loadShadowReadiness(allOrders, shadowReport);

    const urgent = orders
      .map((order) => ({
        order,
        sla: ops.computeSla(order.orderedAt || order.ordered_at)
      }))
      .filter((row) => row.sla.level !== 'normal')
      .sort((a, b) => b.sla.minutes - a.sla.minutes)
      .slice(0, 5);

    urgentOrders.innerHTML = '';
    if (!urgent.length) {
      urgentEmpty.classList.remove('hidden');
    } else {
      urgentEmpty.classList.add('hidden');
      for (const { order, sla } of urgent) {
        const displayId = order.displayId || order.display_id;
        const card = document.createElement('a');
        card.href = `/ops/?order=${encodeURIComponent(order.id)}`;
        card.className = `ops-order-card ops-order-card--${sla.level === 'critical' ? 'critical' : 'warn'}`;
        card.style.textDecoration = 'none';
        card.style.color = 'inherit';
        card.innerHTML = `
          <div class="ops-order-card-top">
            <span class="ops-order-card-id">#${ops.escapeHtml(displayId)}</span>
            <span class="${ops.channelBadgeClass(order.channel)}">${ops.escapeHtml(ops.channelLabel(order.channel))}</span>
          </div>
          <div class="ops-order-card-meta">
            <span class="ops-sla-badge${sla.level === 'critical' ? ' ops-sla-badge--critical' : ''}">⏱ ${ops.escapeHtml(sla.label)}</span>
          </div>`;
        urgentOrders.appendChild(card);
      }
    }

    channelSummary.innerHTML = integrations
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
      .join('');
  } catch (error) {
    ops.showToast(error.message);
  }
}

async function init() {
  ops.ensureAuth(bootstrap.authRequired);
  ops.bindShellControls({ authRequired: bootstrap.authRequired, onRefresh: loadDashboard });
  await ops.loadOpsConfig();
  await loadDashboard();
  ops.startAutoRefresh(loadDashboard, 45000);
}

init().catch((error) => ops.showToast(error.message));

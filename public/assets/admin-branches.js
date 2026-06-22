'use strict';

const bootstrap = window.__ADMIN_BRANCHES__ || { authRequired: true };
const common = window.BuyBoxCommon;

const branchList = document.getElementById('branchList');
const grantList = document.getElementById('grantList');
const branchFormResult = document.getElementById('branchFormResult');
const createBranchBtn = document.getElementById('createBranchBtn');
const branchStatTotal = document.getElementById('branchStatTotal');
const branchStatActive = document.getElementById('branchStatActive');
const branchStatGrants = document.getElementById('branchStatGrants');

let activeBranchId = null;
let grantCount = 0;

async function api(path, options = {}) {
  const response = await common.authFetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `İstek başarısız (${response.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderRoleBadge(role) {
  const cls = role === 'admin' ? 'staff-role-badge--supervisor' : role === 'operator' ? 'staff-role-badge--courier' : '';
  return `<span class="staff-role-badge ${cls}">${escapeHtml(role)}</span>`;
}

function updateBranchStats(branches) {
  if (branchStatTotal) branchStatTotal.textContent = String(branches.length);
  if (branchStatActive) {
    const active = branches.find((row) => row.id === activeBranchId);
    branchStatActive.textContent = active ? '1' : '0';
  }
  if (branchStatGrants) branchStatGrants.textContent = String(grantCount);
}

function renderBranchTable(branches) {
  if (!branches.length) {
    return `
      <div class="pf-empty-state">
        <span class="pf-empty-icon" aria-hidden="true">⌂</span>
        <strong>Henüz şube yok</strong>
        <p>Aşağıdaki formdan yeni depo veya mağaza şubesi ekleyin.</p>
      </div>`;
  }

  return `
    <div class="pf-table-wrap ops-admin-table-wrap">
      <table class="pf-table ops-admin-table">
        <thead>
          <tr>
            <th>Şube</th>
            <th>Slug</th>
            <th>ID</th>
            <th>Rol</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          ${branches.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.name)}</strong></td>
              <td><code class="staff-user-code">${escapeHtml(row.slug)}</code></td>
              <td><code class="staff-user-code" title="branchId">${escapeHtml(row.id)}</code></td>
              <td>${renderRoleBadge(row.role)}</td>
              <td>${activeBranchId === row.id
    ? '<span class="pf-status-pill pf-status-pill--ok">Aktif</span>'
    : '<span class="pf-status-pill pf-status-pill--muted">—</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderGrantTable(grants) {
  if (!grants.length) {
    return '<p class="ops-meta ops-admin-list-empty">Kayıtlı grant yok.</p>';
  }

  return `
    <div class="pf-table-wrap ops-admin-table-wrap">
      <table class="pf-table ops-admin-table">
        <thead>
          <tr>
            <th>Şube</th>
            <th>Subject key</th>
            <th>Rol</th>
          </tr>
        </thead>
        <tbody>
          ${grants.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.branchName)}</strong></td>
              <td><code class="staff-user-code">${escapeHtml(row.subjectKey)}</code></td>
              <td>${renderRoleBadge(row.role)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadBranches() {
  const data = await api('/api/ops/branches');
  activeBranchId = data.activeBranchId || null;
  const branches = data.branches || [];
  if (!branchList) return;
  branchList.innerHTML = renderBranchTable(branches);
  updateBranchStats(branches);

  const grantBranchInput = document.getElementById('grantBranchId');
  const first = branches[0];
  if (grantBranchInput && first && !grantBranchInput.value) {
    grantBranchInput.value = first.id;
  }
}

async function loadGrants() {
  if (!grantList) return;
  try {
    const data = await api('/api/ops/rbac/grants');
    const grants = data.grants || [];
    grantCount = grants.length;
    grantList.innerHTML = renderGrantTable(grants);
    if (branchStatGrants) branchStatGrants.textContent = String(grantCount);
  } catch (error) {
    grantList.innerHTML = `<div class="ops-alert ops-alert--warn">${escapeHtml(error.message)}</div>`;
  }
}

createBranchBtn?.addEventListener('click', async () => {
  if (!branchFormResult) return;
  branchFormResult.textContent = 'Kaydediliyor…';
  branchFormResult.className = 'ops-feedback';
  try {
    const slug = document.getElementById('branchSlug')?.value.trim();
    const name = document.getElementById('branchName')?.value.trim();
    await api('/api/ops/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name })
    });
    branchFormResult.textContent = 'Şube oluşturuldu';
    branchFormResult.className = 'ops-feedback ok';
    document.getElementById('branchSlug').value = '';
    document.getElementById('branchName').value = '';
    await loadBranches();
    await loadGrants();
  } catch (error) {
    branchFormResult.textContent = error.message;
    branchFormResult.className = 'ops-feedback err';
  }
});

document.getElementById('saveGrantBtn')?.addEventListener('click', async () => {
  const grantFormResult = document.getElementById('grantFormResult');
  if (!grantFormResult) return;
  grantFormResult.textContent = 'Kaydediliyor…';
  grantFormResult.className = 'ops-feedback';
  try {
    await api('/api/ops/rbac/grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branchId: document.getElementById('grantBranchId')?.value.trim(),
        subjectKey: document.getElementById('grantSubjectKey')?.value.trim(),
        role: document.getElementById('grantRole')?.value
      })
    });
    grantFormResult.textContent = 'Grant kaydedildi';
    grantFormResult.className = 'ops-feedback ok';
    await loadGrants();
  } catch (error) {
    grantFormResult.textContent = error.message;
    grantFormResult.className = 'ops-feedback err';
  }
});

async function init() {
  if (bootstrap.authRequired && !common.getStoredToken()) {
    common.redirectToLogin();
    return;
  }
  await loadBranches();
  await loadGrants();
}

init().catch((error) => {
  if (branchList) {
    branchList.innerHTML = `<div class="ops-alert ops-alert--warn">${escapeHtml(error.message)}</div>`;
  }
});

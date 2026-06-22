'use strict';

const bootstrap = window.__ADMIN_USERS__ || { authRequired: true };
const common = window.BuyBoxCommon;

const staffList = document.getElementById('staffList');
const staffFormResult = document.getElementById('staffFormResult');
const staffAcceptWarning = document.getElementById('staffAcceptWarning');
const staffAcceptWarningText = document.getElementById('staffAcceptWarningText');
const staffResetDialog = document.getElementById('staffResetDialog');
const staffResetForm = document.getElementById('staffResetForm');
const staffResetTarget = document.getElementById('staffResetTarget');
const staffResetPassword = document.getElementById('staffResetPassword');
const staffResetResult = document.getElementById('staffResetResult');
const staffStatTotal = document.getElementById('staffStatTotal');
const staffStatActive = document.getElementById('staffStatActive');
const staffStatSessions = document.getElementById('staffStatSessions');

const ROLE_OPTIONS = [
  { value: 'picker', label: 'Toplayıcı', cls: 'staff-role-badge--picker' },
  { value: 'courier', label: 'Kurye', cls: 'staff-role-badge--courier' },
  { value: 'supervisor', label: 'Süpervizör', cls: 'staff-role-badge--supervisor' }
];

let resetUserId = null;

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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function roleBadgeClass(role) {
  return ROLE_OPTIONS.find((row) => row.value === role)?.cls || '';
}

function renderStatus(user) {
  if (user.isLocked) {
    return `<span class="pf-status-pill pf-status-pill--warn">Kilitli</span>`;
  }
  return user.active
    ? '<span class="pf-status-pill pf-status-pill--ok">Aktif</span>'
    : '<span class="pf-status-pill pf-status-pill--muted">Pasif</span>';
}

function renderSessions(sessions) {
  if (!sessions?.length) return '<span class="ops-meta">Oturum yok</span>';
  return `<ul class="ops-steps">${sessions.map((session) =>
    `<li><strong>${escapeHtml(session.deviceName)}</strong> · ${formatDate(session.lastSeenAt)}</li>`
  ).join('')}</ul>`;
}

function renderDevices(devices) {
  if (!devices?.length) return '<span class="ops-meta">—</span>';
  return `<ul class="ops-steps">${devices.map((device) =>
    `<li><strong>${escapeHtml(device.deviceName)}</strong>${device.hasPushToken ? ' · push ✓' : ''} · ${formatDate(device.lastSeenAt)}</li>`
  ).join('')}</ul>`;
}

function renderRoleSelect(user) {
  const options = ROLE_OPTIONS.map((option) =>
    `<option value="${option.value}"${option.value === user.role ? ' selected' : ''}>${option.label}</option>`
  ).join('');
  return `<select class="staff-role-select ops-field-select" data-user-id="${escapeHtml(user.id)}" aria-label="Rol">${options}</select>`;
}

function updateStats(users, branch) {
  const sessions = users.reduce((sum, user) => sum + (user.sessions?.length || 0), 0);
  const active = users.filter((user) => user.active && !user.isLocked).length;
  if (staffStatTotal) staffStatTotal.textContent = String(users.length);
  if (staffStatActive) staffStatActive.textContent = String(active);
  if (staffStatSessions) staffStatSessions.textContent = String(sessions);

  const panelHead = document.querySelector('.ops-staff-panel .ops-panel-sub');
  if (panelHead && branch?.name) {
    panelHead.textContent = `${branch.name} · oturumlar, roller ve hesap durumu`;
  }
}

function renderStaffTable(users) {
  if (!users.length) {
    return `
      <div class="pf-empty-state">
        <span class="pf-empty-icon" aria-hidden="true">👤</span>
        <strong>Henüz personel yok</strong>
        <p>Aşağıdaki formdan depo veya kurye hesabı ekleyin.</p>
      </div>`;
  }

  return `
    <div class="pf-table-wrap ops-admin-table-wrap">
      <table class="pf-table ops-admin-table">
        <thead>
          <tr>
            <th>Durum</th>
            <th>Kullanıcı</th>
            <th>Rol</th>
            <th>Son giriş</th>
            <th>Oturumlar</th>
            <th>Cihazlar</th>
            <th>İşlemler</th>
          </tr>
        </thead>
        <tbody>
          ${users.map((user) => `
            <tr data-user-id="${escapeHtml(user.id)}">
              <td>${renderStatus(user)}${user.isLocked ? `<br><span class="ops-meta">${user.failedLoginCount || 0} hatalı deneme</span>` : ''}</td>
              <td>
                <strong>${escapeHtml(user.displayName)}</strong><br>
                <code class="staff-user-code">${escapeHtml(user.username)}</code>
              </td>
              <td>${renderRoleSelect(user)}</td>
              <td>${formatDate(user.lastLoginAt)}</td>
              <td>${renderSessions(user.sessions)}</td>
              <td>${renderDevices(user.devices)}</td>
              <td class="staff-actions">
                <button type="button" class="ops-btn ops-btn-ghost-sm staff-reset-btn" data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">Şifre</button>
                <button type="button" class="ops-btn ops-btn-ghost-sm staff-unlock-btn" data-user-id="${escapeHtml(user.id)}" ${user.isLocked ? '' : 'disabled'}>Kilidi aç</button>
                <button type="button" class="ops-btn ops-btn-ghost-sm staff-revoke-btn" data-user-id="${escapeHtml(user.id)}" ${user.sessions?.length ? '' : 'disabled'}>Oturumu kapat</button>
                <button type="button" class="ops-btn ops-btn-ghost-sm staff-toggle-btn" data-user-id="${escapeHtml(user.id)}" data-active="${user.active ? '1' : '0'}">${user.active ? 'Pasifleştir' : 'Aktifleştir'}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadAcceptWarning() {
  if (!staffAcceptWarning || !staffAcceptWarningText) return;
  try {
    const data = await api('/api/ops/staff-users/accept-warning');
    if (!data.hasConflict) {
      staffAcceptWarning.classList.add('hidden');
      return;
    }
    const channels = (data.enabledChannels || []).map((row) => row.label).join(', ');
    staffAcceptWarningText.textContent = `${data.message} Etkilenen kanallar: ${channels}.`;
    staffAcceptWarning.classList.remove('hidden');
  } catch {
    staffAcceptWarning.classList.add('hidden');
  }
}

async function loadStaff() {
  const data = await api('/api/ops/staff-users');
  const users = data.users || [];
  updateStats(users, data.branch);
  if (!staffList) return;
  staffList.innerHTML = renderStaffTable(users);
  bindStaffActions();
}

function bindStaffActions() {
  staffList?.querySelectorAll('.staff-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const userId = select.dataset.userId;
      select.disabled = true;
      try {
        await api(`/api/ops/staff-users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: select.value })
        });
        await loadStaff();
      } catch (error) {
        alert(error.message);
        select.disabled = false;
      }
    });
  });

  staffList?.querySelectorAll('.staff-reset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      resetUserId = button.dataset.userId;
      staffResetTarget.textContent = `Kullanıcı: ${button.dataset.username}`;
      staffResetPassword.value = '';
      staffResetResult.textContent = '';
      staffResetDialog?.showModal();
    });
  });

  staffList?.querySelectorAll('.staff-unlock-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.userId;
      button.disabled = true;
      try {
        await api(`/api/ops/staff-users/${encodeURIComponent(userId)}/unlock`, { method: 'POST' });
        await loadStaff();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });

  staffList?.querySelectorAll('.staff-toggle-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.userId;
      const active = button.dataset.active !== '1';
      button.disabled = true;
      try {
        await api(`/api/ops/staff-users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active })
        });
        await loadStaff();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });

  staffList?.querySelectorAll('.staff-revoke-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.userId;
      if (!confirm('Bu personelin tüm aktif oturumları kapatılsın mı?')) return;
      button.disabled = true;
      try {
        await api(`/api/ops/staff-users/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST' });
        await loadStaff();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });
}

document.getElementById('createStaffBtn')?.addEventListener('click', async () => {
  if (!staffFormResult) return;
  staffFormResult.textContent = 'Kaydediliyor…';
  staffFormResult.className = 'ops-feedback';
  try {
    await api('/api/ops/staff-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('staffUsername')?.value.trim(),
        displayName: document.getElementById('staffDisplayName')?.value.trim(),
        role: document.getElementById('staffRole')?.value,
        password: document.getElementById('staffPassword')?.value
      })
    });
    staffFormResult.textContent = 'Personel eklendi';
    staffFormResult.className = 'ops-feedback ok';
    document.getElementById('staffUsername').value = '';
    document.getElementById('staffDisplayName').value = '';
    document.getElementById('staffPassword').value = '';
    await loadStaff();
  } catch (error) {
    staffFormResult.textContent = error.message;
    staffFormResult.className = 'ops-feedback err';
  }
});

staffResetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!resetUserId || !staffResetResult) return;
  staffResetResult.textContent = 'Kaydediliyor…';
  staffResetResult.className = 'ops-feedback';
  try {
    await api(`/api/ops/staff-users/${encodeURIComponent(resetUserId)}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: staffResetPassword.value })
    });
    staffResetResult.textContent = 'Şifre güncellendi, oturumlar kapatıldı';
    staffResetResult.className = 'ops-feedback ok';
    await loadStaff();
    setTimeout(() => staffResetDialog?.close(), 700);
  } catch (error) {
    staffResetResult.textContent = error.message;
    staffResetResult.className = 'ops-feedback err';
  }
});

document.getElementById('staffResetCancel')?.addEventListener('click', () => {
  staffResetDialog?.close();
});

async function init() {
  if (bootstrap.authRequired && !common.getStoredToken()) {
    common.redirectToLogin();
    return;
  }
  await Promise.all([loadAcceptWarning(), loadStaff()]);
}

init().catch((error) => {
  if (staffList) {
    staffList.innerHTML = `<div class="ops-alert ops-alert--warn">${escapeHtml(error.message)}</div>`;
  }
});

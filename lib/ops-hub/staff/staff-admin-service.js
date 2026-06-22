import { OPS_CHANNELS } from '../constants.js';
import { getBranchById } from '../branches/branch-repository.js';
import { resolveBranchChannelConfig } from '../integrations/branch-config-resolver.js';
import { listMobileDevicesForBranch } from '../notifications/mobile-device-repository.js';
import { hashStaffPassword } from './staff-auth-service.js';
import {
  getStaffUserById,
  getStaffUserByUsername,
  insertStaffUser,
  listActiveStaffSessions,
  listStaffUsers,
  mapStaffUserRow,
  revokeStaffSessionsForUser,
  setStaffUserActive,
  unlockStaffUser,
  updateStaffPassword,
  updateStaffUserProfile
} from './staff-user-repository.js';

const STAFF_ROLES = Object.freeze(['picker', 'courier', 'supervisor']);

const CHANNEL_LABELS = {
  trendyol_go: 'Uber / TGO',
  yemeksepeti: 'Yemeksepeti',
  getir: 'Getir'
};

const ROLE_LABELS = {
  picker: 'Toplayıcı',
  courier: 'Kurye',
  supervisor: 'Süpervizör'
};

function assertBranchStaffUser(user, branchId) {
  if (!user || user.branch_id !== branchId) {
    const error = new Error('Personel bulunamadı.');
    error.statusCode = 404;
    throw error;
  }
}

function validateUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized || normalized.length < 2) {
    const error = new Error('Kullanıcı adı en az 2 karakter olmalı.');
    error.statusCode = 400;
    throw error;
  }
  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    const error = new Error('Kullanıcı adı yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 4) {
    const error = new Error('Şifre en az 4 karakter olmalı.');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function validateRole(role) {
  const normalized = String(role || '').trim();
  if (!STAFF_ROLES.includes(normalized)) {
    const error = new Error('Rol picker, courier veya supervisor olmalı.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function enrichStaffUser(user, { sessions = [], devices = [] } = {}) {
  return {
    ...user,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    sessions,
    devices
  };
}

function matchDevicesForUser(user, devices) {
  const username = String(user.username || '').trim().toLowerCase();
  const displayName = String(user.displayName || '').trim().toLowerCase();
  return devices.filter((device) => {
    if (device.staffUserId && device.staffUserId === user.id) return true;
    const staffName = String(device.staffName || '').trim().toLowerCase();
    return staffName === username || staffName === displayName;
  });
}

export async function listStaffUsersForPanel(pool, branchId) {
  const branch = await getBranchById(pool, branchId);
  const users = await listStaffUsers(pool, { branchId });
  const sessions = await listActiveStaffSessions(pool, { branchId });
  const devices = await listMobileDevicesForBranch(pool, branchId);

  const sessionsByUser = new Map();
  for (const session of sessions) {
    const list = sessionsByUser.get(session.userId) || [];
    list.push(session);
    sessionsByUser.set(session.userId, list);
  }

  return {
    branch: branch
      ? { id: branch.id, slug: branch.slug, name: branch.name }
      : { id: branchId, slug: null, name: null },
    users: users.map((user) => enrichStaffUser(user, {
      sessions: sessionsByUser.get(user.id) || [],
      devices: matchDevicesForUser(user, devices)
    }))
  };
}

export async function createStaffUserForPanel(pool, branchId, payload) {
  const username = validateUsername(payload.username);
  const password = validatePassword(payload.password);
  const role = validateRole(payload.role || 'picker');
  const displayName = String(payload.displayName || payload.name || username).trim();
  if (!displayName) {
    const error = new Error('Görünen ad gerekli.');
    error.statusCode = 400;
    throw error;
  }

  const existing = await getStaffUserByUsername(pool, { branchId, username });
  if (existing) {
    const error = new Error(`Kullanıcı zaten var: ${username}`);
    error.statusCode = 409;
    throw error;
  }

  const user = await insertStaffUser(pool, {
    branchId,
    username,
    passwordHash: await hashStaffPassword(password),
    displayName,
    role
  });
  return {
    user: enrichStaffUser(mapStaffUserRow(user), { sessions: [], devices: [] })
  };
}

export async function resetStaffUserPasswordForPanel(pool, branchId, userId, password) {
  const user = await getStaffUserById(pool, userId);
  assertBranchStaffUser(user, branchId);
  await updateStaffPassword(pool, userId, await hashStaffPassword(validatePassword(password)));
  await revokeStaffSessionsForUser(pool, userId);
  return { ok: true };
}

export async function setStaffUserActiveForPanel(pool, branchId, userId, active) {
  const user = await getStaffUserById(pool, userId);
  assertBranchStaffUser(user, branchId);
  await setStaffUserActive(pool, userId, active === true);
  if (active !== true) {
    await revokeStaffSessionsForUser(pool, userId);
  }
  return { ok: true, active: active === true };
}

export async function updateStaffUserForPanel(pool, branchId, userId, payload) {
  const user = await getStaffUserById(pool, userId);
  assertBranchStaffUser(user, branchId);

  const displayName = payload.displayName != null
    ? String(payload.displayName).trim()
    : undefined;
  const role = payload.role != null ? validateRole(payload.role) : undefined;

  if (displayName != null && !displayName) {
    const error = new Error('Görünen ad boş olamaz.');
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateStaffUserProfile(pool, userId, { displayName, role });
  return {
    user: enrichStaffUser(mapStaffUserRow(updated))
  };
}

export async function unlockStaffUserForPanel(pool, branchId, userId) {
  const user = await getStaffUserById(pool, userId);
  assertBranchStaffUser(user, branchId);
  const updated = await unlockStaffUser(pool, userId);
  return {
    user: enrichStaffUser(mapStaffUserRow(updated))
  };
}

export async function revokeStaffUserSessionsForPanel(pool, branchId, userId) {
  const user = await getStaffUserById(pool, userId);
  assertBranchStaffUser(user, branchId);
  const count = await revokeStaffSessionsForUser(pool, userId);
  return { ok: true, revokedCount: count };
}

export async function getStaffMobileAcceptWarning(pool, branchId, options = {}) {
  const enabledChannels = [];
  for (const channel of OPS_CHANNELS) {
    const config = await resolveBranchChannelConfig(pool, channel, {
      branchId,
      platformEnv: options.platformEnv
    });
    if (config.enabled !== false && config.autoAcceptOrders === true) {
      enabledChannels.push({
        channel,
        label: CHANNEL_LABELS[channel] || channel
      });
    }
  }

  return {
    hasConflict: enabledChannels.length > 0,
    enabledChannels,
    message: enabledChannels.length
      ? 'Bazı kanallarda otomatik kabul açık. Mobil uygulamada "Kabul Et" akışı bu siparişlerde devreye girmeyebilir.'
      : null
  };
}

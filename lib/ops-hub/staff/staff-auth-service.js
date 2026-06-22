import { createHash, randomBytes } from 'node:crypto';
import { getOpsHubState } from '../bootstrap.js';
import { hashStaffPassword, verifyStaffPassword } from './password.js';
import {
  findStaffSessionByTokenHash,
  getStaffUserByUsername,
  insertStaffSession,
  mapStaffUserRow,
  recordStaffLoginFailure,
  recordStaffLoginSuccess,
  revokeStaffSession,
  touchStaffSession
} from './staff-user-repository.js';

const SESSION_HOURS = 12;

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

function sessionExpiryDate() {
  return new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
}

function isUserLocked(user) {
  if (!user?.locked_until) return false;
  return new Date(user.locked_until).getTime() > Date.now();
}

export function mapStaffSessionUser(row) {
  if (!row) return null;
  return {
    id: row.user_id || row.id,
    branchId: row.branch_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active === true,
    deviceName: row.device_name || null
  };
}

export async function staffLogin(pool, { username, password, deviceName, branchId = null }) {
  const branch = branchId || getOpsHubState().branch?.id;
  if (!branch) {
    const error = new Error('Şube yapılandırması bulunamadı.');
    error.statusCode = 503;
    throw error;
  }

  const normalizedDevice = String(deviceName || '').trim();
  if (!normalizedDevice) {
    const error = new Error('Cihaz adı gerekli.');
    error.statusCode = 400;
    throw error;
  }

  const user = await getStaffUserByUsername(pool, { branchId: branch, username });
  if (!user || user.active !== true) {
    const error = new Error('Kullanıcı adı veya şifre hatalı.');
    error.statusCode = 401;
    throw error;
  }

  if (isUserLocked(user)) {
    const error = new Error('Çok fazla hatalı deneme — 15 dakika sonra tekrar deneyin.');
    error.statusCode = 429;
    throw error;
  }

  const ok = await verifyStaffPassword(password, user.password_hash);
  if (!ok) {
    await recordStaffLoginFailure(pool, user.id);
    const error = new Error('Kullanıcı adı veya şifre hatalı.');
    error.statusCode = 401;
    throw error;
  }

  await recordStaffLoginSuccess(pool, user.id);

  const sessionToken = createSessionToken();
  const tokenHash = hashSessionToken(sessionToken);
  const expiresAt = sessionExpiryDate();
  await insertStaffSession(pool, {
    userId: user.id,
    tokenHash,
    deviceName: normalizedDevice,
    expiresAt
  });

  return {
    sessionToken,
    expiresAt: expiresAt.toISOString(),
    user: mapStaffUserRow(user)
  };
}

export async function staffLogout(pool, sessionToken) {
  const tokenHash = hashSessionToken(sessionToken);
  await revokeStaffSession(pool, tokenHash);
}

export async function resolveStaffSession(pool, sessionToken) {
  const trimmed = String(sessionToken || '').trim();
  if (!trimmed) return null;
  const row = await findStaffSessionByTokenHash(pool, hashSessionToken(trimmed));
  if (!row || row.active !== true) return null;
  await touchStaffSession(pool, row.token_hash);
  return mapStaffSessionUser(row);
}

export { hashStaffPassword, verifyStaffPassword };

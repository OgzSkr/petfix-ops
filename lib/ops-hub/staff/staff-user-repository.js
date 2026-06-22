import { randomUUID } from 'node:crypto';

export function mapStaffUserRow(row) {
  if (!row) return null;
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  const isLocked = lockedUntil ? lockedUntil.getTime() > Date.now() : false;
  return {
    id: row.id,
    branchId: row.branch_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active === true,
    lastLoginAt: row.last_login_at,
    failedLoginCount: row.failed_login_count ?? 0,
    lockedUntil: row.locked_until,
    isLocked,
    createdAt: row.created_at
  };
}

export async function getStaffUserByUsername(pool, { branchId, username }) {
  const result = await pool.query(
    `SELECT * FROM ops_staff_users
     WHERE branch_id = $1 AND lower(username) = lower($2)
     LIMIT 1`,
    [branchId, String(username || '').trim()]
  );
  return result.rows[0] || null;
}

export async function getStaffUserById(pool, userId) {
  const result = await pool.query(
    `SELECT * FROM ops_staff_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function listStaffUsers(pool, { branchId } = {}) {
  const params = [];
  let where = '1=1';
  if (branchId) {
    params.push(branchId);
    where = `branch_id = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT id, branch_id, username, display_name, role, active,
            last_login_at, failed_login_count, locked_until, created_at
     FROM ops_staff_users
     WHERE ${where}
     ORDER BY username ASC`,
    params
  );
  return result.rows.map(mapStaffUserRow);
}

export async function insertStaffUser(pool, {
  branchId,
  username,
  passwordHash,
  displayName,
  role
}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO ops_staff_users
      (id, branch_id, username, password_hash, display_name, role, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
    [id, branchId, String(username).trim().toLowerCase(), passwordHash, displayName, role]
  );
  return getStaffUserById(pool, id);
}

export async function updateStaffPassword(pool, userId, passwordHash) {
  await pool.query(
    `UPDATE ops_staff_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash]
  );
}

export async function setStaffUserActive(pool, userId, active) {
  await pool.query(
    `UPDATE ops_staff_users SET active = $2, updated_at = NOW() WHERE id = $1`,
    [userId, active === true]
  );
}

export async function recordStaffLoginSuccess(pool, userId) {
  await pool.query(
    `UPDATE ops_staff_users
     SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
}

export async function recordStaffLoginFailure(pool, userId) {
  await pool.query(
    `UPDATE ops_staff_users
     SET failed_login_count = failed_login_count + 1,
         locked_until = CASE
           WHEN failed_login_count + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
           ELSE locked_until
         END,
         updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
}

export async function insertStaffSession(pool, {
  userId,
  tokenHash,
  deviceName,
  expiresAt
}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO ops_staff_sessions
      (id, user_id, token_hash, device_name, expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [id, userId, tokenHash, deviceName, expiresAt]
  );
  return id;
}

export async function findStaffSessionByTokenHash(pool, tokenHash) {
  const result = await pool.query(
    `SELECT s.*, u.branch_id, u.username, u.display_name, u.role, u.active
     FROM ops_staff_sessions s
     JOIN ops_staff_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function revokeStaffSession(pool, tokenHash) {
  await pool.query(
    `UPDATE ops_staff_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

export async function touchStaffSession(pool, tokenHash) {
  await pool.query(
    `UPDATE ops_staff_sessions SET last_seen_at = NOW() WHERE token_hash = $1`,
    [tokenHash]
  );
}

export function mapStaffSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    deviceName: row.device_name,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at
  };
}

export async function listActiveStaffSessions(pool, { branchId, userId } = {}) {
  const params = [];
  const filters = ['s.revoked_at IS NULL', 's.expires_at > NOW()'];
  if (branchId) {
    params.push(branchId);
    filters.push(`u.branch_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    filters.push(`s.user_id = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT s.id, s.user_id, s.device_name, s.expires_at, s.last_seen_at, s.created_at
     FROM ops_staff_sessions s
     JOIN ops_staff_users u ON u.id = s.user_id
     WHERE ${filters.join(' AND ')}
     ORDER BY s.last_seen_at DESC`,
    params
  );
  return result.rows.map(mapStaffSessionRow);
}

export async function revokeStaffSessionsForUser(pool, userId) {
  const result = await pool.query(
    `UPDATE ops_staff_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [userId]
  );
  return result.rowCount;
}

export async function updateStaffUserProfile(pool, userId, { displayName, role }) {
  const fields = [];
  const params = [userId];
  if (displayName != null) {
    params.push(String(displayName).trim());
    fields.push(`display_name = $${params.length}`);
  }
  if (role != null) {
    params.push(role);
    fields.push(`role = $${params.length}`);
  }
  if (!fields.length) return getStaffUserById(pool, userId);
  await pool.query(
    `UPDATE ops_staff_users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $1`,
    params
  );
  return getStaffUserById(pool, userId);
}

export async function unlockStaffUser(pool, userId) {
  await pool.query(
    `UPDATE ops_staff_users
     SET failed_login_count = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
  return getStaffUserById(pool, userId);
}

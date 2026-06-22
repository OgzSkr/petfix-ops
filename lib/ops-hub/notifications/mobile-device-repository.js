import { randomUUID } from 'node:crypto';

async function clearConflictingFcmToken(pool, fcmToken, branchId, deviceName, staffName) {
  if (!fcmToken) return;
  await pool.query(
    `UPDATE ops_mobile_devices
     SET fcm_token = NULL, updated_at = NOW()
     WHERE fcm_token = $1
       AND NOT (branch_id = $2 AND device_name = $3 AND staff_name = $4)`,
    [fcmToken, branchId, deviceName.trim(), staffName.trim()]
  );
}

export function mapMobileDeviceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    branchId: row.branch_id,
    staffUserId: row.staff_user_id,
    staffName: row.staff_name,
    deviceName: row.device_name,
    platform: row.platform,
    hasPushToken: Boolean(row.fcm_token),
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at
  };
}

export async function upsertMobileDevice(pool, {
  branchId,
  staffName,
  deviceName,
  platform = 'android',
  fcmToken = null,
  staffUserId = null
}) {
  await clearConflictingFcmToken(pool, fcmToken, branchId, deviceName, staffName);
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO ops_mobile_devices
       (id, branch_id, staff_name, device_name, platform, fcm_token, staff_user_id, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (branch_id, device_name, staff_name)
     DO UPDATE SET
       platform = EXCLUDED.platform,
       fcm_token = COALESCE(EXCLUDED.fcm_token, ops_mobile_devices.fcm_token),
       staff_user_id = COALESCE(EXCLUDED.staff_user_id, ops_mobile_devices.staff_user_id),
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [id, branchId, staffName.trim(), deviceName.trim(), platform, fcmToken, staffUserId]
  );
  return result.rows[0];
}

export async function updateMobileDeviceToken(pool, {
  branchId,
  staffName,
  deviceName,
  fcmToken,
  staffUserId = null
}) {
  await clearConflictingFcmToken(pool, fcmToken, branchId, deviceName, staffName);
  const result = await pool.query(
    `UPDATE ops_mobile_devices
     SET fcm_token = $4,
         staff_user_id = COALESCE($5, staff_user_id),
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE branch_id = $1
       AND staff_name = $2
       AND device_name = $3
     RETURNING *`,
    [branchId, staffName.trim(), deviceName.trim(), fcmToken, staffUserId]
  );
  return result.rows[0] || null;
}

export async function listMobileDevicesForBranch(pool, branchId) {
  const result = await pool.query(
    `SELECT id, branch_id, staff_user_id, staff_name, device_name, platform,
            fcm_token, last_seen_at, updated_at
     FROM ops_mobile_devices
     WHERE branch_id = $1
     ORDER BY updated_at DESC`,
    [branchId]
  );
  return result.rows.map(mapMobileDeviceRow);
}

export async function listMobileDeviceTokens(pool, branchId) {
  const result = await pool.query(
    `SELECT fcm_token
     FROM ops_mobile_devices
     WHERE branch_id = $1
       AND fcm_token IS NOT NULL
       AND fcm_token <> ''
     ORDER BY updated_at DESC
     LIMIT 50`,
    [branchId]
  );
  return result.rows.map((row) => row.fcm_token).filter(Boolean);
}

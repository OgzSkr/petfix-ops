export function readMobileAuditHeaders(request, staffUser = null) {
  const staffName = String(
    request.headers['x-staff-name'] ||
    staffUser?.displayName ||
    ''
  ).trim();
  const deviceName = String(
    request.headers['x-device-name'] ||
    staffUser?.deviceName ||
    ''
  ).trim();
  return {
    staffName: staffName || null,
    deviceName: deviceName || null,
    staffUserId: staffUser?.id || null,
    staffRole: staffUser?.role || null,
    hasIdentity: Boolean(staffName && deviceName)
  };
}

export function assertMobileAuditHeaders(request, staffUser = null) {
  const audit = readMobileAuditHeaders(request, staffUser);
  if (!audit.hasIdentity) {
    const error = new Error('X-Staff-Name ve X-Device-Name header zorunlu.');
    error.statusCode = 400;
    throw error;
  }
  return audit;
}

export async function logMobileAuditEvent(pool, { branchId, orderId, eventType, audit, payload = {} }) {
  const { insertShadowEvent } = await import('../db/repository.js');
  await insertShadowEvent(pool, {
    branchId,
    orderId: orderId || null,
    eventType,
    payload: {
      staffName: audit.staffName,
      deviceName: audit.deviceName,
      staffUserId: audit.staffUserId,
      staffRole: audit.staffRole,
      ...payload
    }
  });
}

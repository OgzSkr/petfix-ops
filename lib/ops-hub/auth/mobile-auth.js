import { readBearerToken, safeTokenEqual } from '../../auth/index.js';
import { resolveOpsHubConfig } from '../config.js';
import { resolveStaffSession } from '../staff/staff-auth-service.js';

export const STAFF_ROLES = new Set(['picker', 'courier', 'supervisor']);
export const MOBILE_OPS_ROLES = ['picker', 'courier', 'supervisor'];

/** Platform token ile erişilebilen yollar (FF_STAFF_AUTH açıkken). */
export const STAFF_AUTH_PLATFORM_BYPASS_PATHS = new Set([
  '/ops/v1/orders/ingest/mock',
  '/ops/v1/orders/ingest',
  '/ops/v1/mock/fixtures'
]);

export function isStaffAuthRequired(platformEnv) {
  return resolveOpsHubConfig(platformEnv).flags.FF_STAFF_AUTH === true;
}

export function isStaffAuthPlatformBypassPath(pathname) {
  return STAFF_AUTH_PLATFORM_BYPASS_PATHS.has(String(pathname || '').trim());
}

export async function authenticateOpsRequest(ctx, pool, options = {}) {
  const { request, auth } = ctx;
  const pathname = options.pathname || new URL(request.url, 'http://localhost').pathname;
  const platformEnv = options.platformEnv || null;
  const bearer = readBearerToken(request);

  if (!bearer) {
    const error = new Error('Yetkisiz istek — giriş yapın.');
    error.statusCode = 401;
    throw error;
  }

  if (auth?.isEnabled?.() && auth.token && safeTokenEqual(bearer, auth.token)) {
    return { mode: 'platform', staffUser: null };
  }

  const staffUser = await resolveStaffSession(pool, bearer);
  if (staffUser) {
    return { mode: 'staff', staffUser };
  }

  const error = new Error('Yetkisiz istek — oturum geçersiz veya süresi dolmuş.');
  error.statusCode = 401;
  throw error;
}

export function assertStaffRouteRole(ctx, allowedRoles) {
  const staffUser = ctx.staffUser;
  if (!staffUser) {
    if (isStaffAuthRequired(ctx.platformEnv)) {
      const error = new Error('Personel oturumu gerekli — mobil uygulamadan giriş yapın.');
      error.statusCode = 403;
      throw error;
    }
    return;
  }
  if (!allowedRoles.includes(staffUser.role)) {
    const error = new Error('Bu işlem için yetkiniz yok.');
    error.statusCode = 403;
    throw error;
  }
}

export function assertMobileOpsRole(ctx) {
  assertStaffRouteRole(ctx, MOBILE_OPS_ROLES);
}

export function assertMobilePickingRole(ctx) {
  assertStaffRouteRole(ctx, ['picker', 'supervisor']);
}

export function assertMobileCourierRole(ctx) {
  assertStaffRouteRole(ctx, ['courier', 'supervisor']);
}

/** Mağaza kuryesi teslimi — depo personeli de teslim edebilir. */
export function assertMobileDeliverRole(ctx) {
  assertStaffRouteRole(ctx, ['picker', 'courier', 'supervisor']);
}

export function staffCanRead(_staffUser) {
  return true;
}

export function staffCanWrite(staffUser) {
  return STAFF_ROLES.has(staffUser?.role);
}

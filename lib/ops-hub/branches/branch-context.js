import { parseCookieHeader } from '../../auth/session-cookie.js';
import { envValue, readEnvFile } from '../../env.js';
import { paths } from '../../config.js';
import { getOpsHubState } from '../bootstrap.js';
import { getBranchById, getBranchGrant, roleAllows } from './branch-repository.js';

export const BRANCH_COOKIE = 'pf_ops_branch_id';
export const BRANCH_HEADER = 'x-ops-branch-id';

export function isBranchIdRequired(platformEnv = null) {
  const raw = envValue(process.env, platformEnv, 'OPS_BRANCH_ID_REQUIRED', 'false');
  return raw === true || raw === 'true' || raw === '1';
}

export function resolveRbacSubjectKey() {
  return envValue(process.env, {}, 'OPS_RBAC_SUBJECT_KEY', 'platform');
}

export function readBranchIdFromRequest(request, url) {
  const header = String(
    request.headers[BRANCH_HEADER] ||
    request.headers['X-Ops-Branch-Id'] ||
    ''
  ).trim();
  if (header) return header;

  const query = url.searchParams?.get('branch') || url.searchParams?.get('branchId');
  if (query) return String(query).trim();

  const cookies = parseCookieHeader(request.headers.cookie);
  if (cookies[BRANCH_COOKIE]) {
    return String(cookies[BRANCH_COOKIE]).trim();
  }

  return '';
}

export function buildBranchCookie(branchId, { secure = true } = {}) {
  const parts = [
    `${BRANCH_COOKIE}=${encodeURIComponent(branchId)}`,
    'Path=/',
    'SameSite=Strict',
    'Max-Age=31536000'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export async function resolveBranchContext(ctx, {
  pool,
  permission = 'read',
  requireBranch = false,
  platformEnv = null
} = {}) {
  const { request, url, auth, staffUser } = ctx;
  const env = platformEnv || (await readEnvFile(paths.platformEnv));

  if (staffUser?.branchId) {
    const branch = await getBranchById(pool, staffUser.branchId);
    if (!branch) {
      throw Object.assign(new Error('Şube bulunamadı'), { statusCode: 404 });
    }
    if (permission === 'write' && staffUser.role === 'courier') {
      // courier write allowed only on courier routes — checked separately
    }
    return {
      branchId: branch.id,
      branch,
      tenantId: branch.tenant_id,
      role: staffUser.role,
      subjectKey: `staff:${staffUser.id}`
    };
  }

  const requestedId = readBranchIdFromRequest(request, url);
  const fallbackBranch = getOpsHubState().branch;
  const branchId = requestedId || fallbackBranch?.id || null;

  if (!branchId && (requireBranch || isBranchIdRequired(env))) {
    throw Object.assign(
      new Error('branchId zorunlu — şube seçin veya ?branch= parametresi gönderin'),
      { statusCode: 400 }
    );
  }

  if (!branchId) {
    return {
      branchId: null,
      branch: null,
      tenantId: null,
      role: null,
      subjectKey: resolveRbacSubjectKey()
    };
  }

  const branch = await getBranchById(pool, branchId);
  if (!branch) {
    throw Object.assign(new Error('Şube bulunamadı'), { statusCode: 404 });
  }

  const subjectKey = resolveRbacSubjectKey();
  const authRequired = auth?.mustAuthenticate?.() ?? auth?.authRequired ?? true;

  if (authRequired) {
    const grant = await getBranchGrant(pool, { branchId, subjectKey });
    if (!grant || !roleAllows(grant.role, permission)) {
      throw Object.assign(new Error('Bu şube için yetkiniz yok'), { statusCode: 403 });
    }
    return {
      branchId: branch.id,
      branch,
      tenantId: branch.tenant_id,
      role: grant.role,
      subjectKey
    };
  }

  return {
    branchId: branch.id,
    branch,
    tenantId: branch.tenant_id,
    role: 'admin',
    subjectKey
  };
}

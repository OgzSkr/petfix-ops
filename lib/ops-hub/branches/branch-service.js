import { ensureDefaultBranch } from '../db/repository.js';
import {
  ensureDefaultTenant,
  listAccessibleBranches,
  createBranch,
  ensureBranchGrant,
  listBranchGrants,
  getBranchBySlug,
  getBranchById
} from './branch-repository.js';
import { resolveRbacSubjectKey } from './branch-context.js';
import { roleAllows } from './branch-repository.js';
import { envValue } from '../../env.js';

export async function bootstrapTenantAndGrants(pool, platformEnv = {}) {
  const tenantSlug = envValue(process.env, platformEnv, 'OPS_DEFAULT_TENANT_SLUG', 'main');
  const tenantName = envValue(process.env, platformEnv, 'OPS_DEFAULT_TENANT_NAME', 'PetFix');
  const tenant = await ensureDefaultTenant(pool, { slug: tenantSlug, name: tenantName });

  let branch = await getBranchBySlug(pool, 'main');
  if (!branch) {
    branch = await ensureDefaultBranch(pool, { slug: 'main', name: 'Ana Şube' });
  }

  if (!branch.tenant_id) {
    await pool.query(
      'UPDATE ops_branches SET tenant_id = $1, updated_at = NOW() WHERE id = $2',
      [tenant.id, branch.id]
    );
    branch = { ...branch, tenant_id: tenant.id };
  }

  const subjectKey = resolveRbacSubjectKey();
  await ensureBranchGrant(pool, {
    tenantId: tenant.id,
    branchId: branch.id,
    subjectKey,
    role: 'admin'
  });

  return { tenant, branch };
}

export async function listBranchesForSubject(pool, platformEnv = {}) {
  const tenantSlug = envValue(process.env, platformEnv, 'OPS_DEFAULT_TENANT_SLUG', 'main');
  const subjectKey = resolveRbacSubjectKey();
  const branches = await listAccessibleBranches(pool, subjectKey, { tenantSlug });
  return {
    ok: true,
    tenantSlug,
    subjectKey,
    branches: branches.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      tenantId: row.tenant_id,
      role: row.role,
      benimposBranchId: row.benimpos_branch_id || null
    }))
  };
}

export async function createBranchForTenant(pool, payload = {}, { role = 'viewer' } = {}) {
  if (!roleAllows(role, 'admin')) {
    throw Object.assign(new Error('Şube oluşturmak için admin yetkisi gerekli'), { statusCode: 403 });
  }

  const slug = String(payload.slug || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  if (!slug || !name) {
    throw Object.assign(new Error('slug ve name zorunlu'), { statusCode: 400 });
  }

  const tenantSlug = envValue(process.env, {}, 'OPS_DEFAULT_TENANT_SLUG', 'main');
  const tenant = await ensureDefaultTenant(pool, { slug: tenantSlug, name: 'PetFix' });

  const existing = await getBranchBySlug(pool, slug);
  if (existing) {
    throw Object.assign(new Error('Bu slug ile şube zaten var'), { statusCode: 409 });
  }

  const branch = await createBranch(pool, {
    tenantId: tenant.id,
    slug,
    name,
    benimposBranchId: payload.benimposBranchId || null
  });

  const subjectKey = resolveRbacSubjectKey();
  await ensureBranchGrant(pool, {
    tenantId: tenant.id,
    branchId: branch.id,
    subjectKey,
    role: 'admin'
  });

  return { ok: true, branch };
}

export async function upsertRbacGrant(pool, payload = {}, { role: actorRole = 'viewer' } = {}) {
  if (!roleAllows(actorRole, 'admin')) {
    throw Object.assign(new Error('Grant yönetimi için admin yetkisi gerekli'), { statusCode: 403 });
  }

  const branchId = String(payload.branchId || '').trim();
  const subjectKey = String(payload.subjectKey || resolveRbacSubjectKey()).trim();
  const grantRole = String(payload.role || 'viewer').trim();
  if (!branchId || !subjectKey) {
    throw Object.assign(new Error('branchId ve subjectKey zorunlu'), { statusCode: 400 });
  }
  if (!['admin', 'operator', 'viewer'].includes(grantRole)) {
    throw Object.assign(new Error('Geçersiz role'), { statusCode: 400 });
  }

  const branch = await getBranchById(pool, branchId);
  if (!branch?.tenant_id) {
    throw Object.assign(new Error('Şube bulunamadı'), { statusCode: 404 });
  }

  const grant = await ensureBranchGrant(pool, {
    tenantId: branch.tenant_id,
    branchId,
    subjectKey,
    role: grantRole
  });

  return { ok: true, grant };
}

export async function listRbacGrants(pool, { branchId = null } = {}) {
  const grants = await listBranchGrants(pool, { branchId });
  return {
    ok: true,
    grants: grants.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      branchSlug: row.branch_slug,
      branchName: row.branch_name,
      subjectType: row.subject_type,
      subjectKey: row.subject_key,
      role: row.role
    }))
  };
}

import { randomUUID } from 'node:crypto';

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

export function roleAllows(role, permission) {
  const need = permission === 'admin' ? 3 : permission === 'write' ? 2 : 1;
  return (ROLE_RANK[role] || 0) >= need;
}

export async function ensureDefaultTenant(pool, { slug = 'main', name = 'PetFix' } = {}) {
  const existing = await pool.query(
    'SELECT id, slug, name, active FROM ops_tenants WHERE slug = $1 LIMIT 1',
    [slug]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }
  const id = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO ops_tenants (id, slug, name)
     VALUES ($1, $2, $3)
     RETURNING id, slug, name, active`,
    [id, slug, name]
  );
  return inserted.rows[0];
}

export async function getBranchById(pool, branchId) {
  const result = await pool.query(
    `SELECT id, slug, name, tenant_id, benimpos_branch_id, active, created_at, updated_at
     FROM ops_branches WHERE id = $1 LIMIT 1`,
    [branchId]
  );
  return result.rows[0] || null;
}

export async function getBranchBySlug(pool, slug) {
  const result = await pool.query(
    `SELECT id, slug, name, tenant_id, benimpos_branch_id, active, created_at, updated_at
     FROM ops_branches WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return result.rows[0] || null;
}

export async function listBranchesForTenant(pool, tenantId) {
  const result = await pool.query(
    `SELECT id, slug, name, tenant_id, benimpos_branch_id, active, created_at, updated_at
     FROM ops_branches
     WHERE tenant_id = $1 AND active = TRUE
     ORDER BY name ASC, slug ASC`,
    [tenantId]
  );
  return result.rows;
}

export async function listAccessibleBranches(pool, subjectKey, { tenantSlug = 'main' } = {}) {
  const result = await pool.query(
    `SELECT b.id, b.slug, b.name, b.tenant_id, b.benimpos_branch_id, b.active,
            g.role
     FROM ops_branch_grants g
     JOIN ops_branches b ON b.id = g.branch_id
     JOIN ops_tenants t ON t.id = b.tenant_id
     WHERE g.subject_type = 'platform_token'
       AND g.subject_key = $1
       AND t.slug = $2
       AND b.active = TRUE
       AND t.active = TRUE
     ORDER BY b.name ASC, b.slug ASC`,
    [subjectKey, tenantSlug]
  );
  return result.rows;
}

export async function getBranchGrant(pool, { branchId, subjectKey }) {
  const result = await pool.query(
    `SELECT id, tenant_id, branch_id, subject_type, subject_key, role
     FROM ops_branch_grants
     WHERE branch_id = $1
       AND subject_type = 'platform_token'
       AND subject_key = $2
     LIMIT 1`,
    [branchId, subjectKey]
  );
  return result.rows[0] || null;
}

export async function ensureBranchGrant(pool, { tenantId, branchId, subjectKey, role = 'admin' }) {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO ops_branch_grants (id, tenant_id, branch_id, subject_type, subject_key, role)
     VALUES ($1, $2, $3, 'platform_token', $4, $5)
     ON CONFLICT (branch_id, subject_type, subject_key) DO UPDATE SET
       role = EXCLUDED.role
     RETURNING id, tenant_id, branch_id, subject_type, subject_key, role`,
    [id, tenantId, branchId, subjectKey, role]
  );
  return result.rows[0];
}

export async function createBranch(pool, { tenantId, slug, name, benimposBranchId = null }) {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO ops_branches (id, slug, name, tenant_id, benimpos_branch_id, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING id, slug, name, tenant_id, benimpos_branch_id, active`,
    [id, slug, name, tenantId, benimposBranchId]
  );
  return result.rows[0];
}

export async function listBranchGrants(pool, { branchId = null, tenantId = null } = {}) {
  const clauses = [];
  const params = [];
  if (branchId) {
    params.push(branchId);
    clauses.push(`g.branch_id = $${params.length}`);
  }
  if (tenantId) {
    params.push(tenantId);
    clauses.push(`g.tenant_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT g.id, g.tenant_id, g.branch_id, g.subject_type, g.subject_key, g.role,
            b.slug AS branch_slug, b.name AS branch_name
     FROM ops_branch_grants g
     JOIN ops_branches b ON b.id = g.branch_id
     ${where}
     ORDER BY b.slug, g.subject_key`,
    params
  );
  return result.rows;
}

export { ROLE_RANK };

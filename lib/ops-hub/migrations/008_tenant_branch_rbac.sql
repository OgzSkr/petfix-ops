-- Faz 4b: tenant + şube RBAC

CREATE TABLE IF NOT EXISTS ops_tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ops_branches
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES ops_tenants(id);

INSERT INTO ops_tenants (id, slug, name)
SELECT gen_random_uuid(), 'main', 'PetFix'
WHERE NOT EXISTS (SELECT 1 FROM ops_tenants WHERE slug = 'main');

UPDATE ops_branches b
SET tenant_id = t.id
FROM ops_tenants t
WHERE t.slug = 'main' AND b.tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS ops_branch_grants (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES ops_tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES ops_branches(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL DEFAULT 'platform_token'
    CHECK (subject_type IN ('platform_token', 'user')),
  subject_key TEXT NOT NULL DEFAULT 'platform',
  role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, subject_type, subject_key)
);

CREATE INDEX IF NOT EXISTS idx_ops_branch_grants_subject
  ON ops_branch_grants (subject_type, subject_key);

INSERT INTO ops_branch_grants (id, tenant_id, branch_id, subject_type, subject_key, role)
SELECT gen_random_uuid(), b.tenant_id, b.id, 'platform_token', 'platform', 'admin'
FROM ops_branches b
WHERE b.tenant_id IS NOT NULL
ON CONFLICT (branch_id, subject_type, subject_key) DO NOTHING;

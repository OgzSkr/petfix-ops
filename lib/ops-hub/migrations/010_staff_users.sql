-- Personel hesapları (mağaza / kurye) + oturum

CREATE TABLE IF NOT EXISTS ops_staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES ops_branches(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'picker'
    CHECK (role IN ('picker', 'courier', 'supervisor')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, username)
);

CREATE INDEX IF NOT EXISTS idx_ops_staff_users_branch_active
  ON ops_staff_users (branch_id, active, username);

CREATE TABLE IF NOT EXISTS ops_staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ops_staff_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  device_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_ops_staff_sessions_user
  ON ops_staff_sessions (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_staff_sessions_active
  ON ops_staff_sessions (token_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE ops_mobile_devices
  ADD COLUMN IF NOT EXISTS staff_user_id UUID REFERENCES ops_staff_users(id) ON DELETE SET NULL;

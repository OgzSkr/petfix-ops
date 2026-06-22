-- Mobile push token registry (FCM)
CREATE TABLE IF NOT EXISTS ops_mobile_devices (
  id UUID PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES ops_branches(id) ON DELETE CASCADE,
  staff_name TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  fcm_token TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, device_name, staff_name)
);

CREATE INDEX IF NOT EXISTS idx_ops_mobile_devices_branch
  ON ops_mobile_devices (branch_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_mobile_devices_fcm_token
  ON ops_mobile_devices (fcm_token)
  WHERE fcm_token IS NOT NULL;

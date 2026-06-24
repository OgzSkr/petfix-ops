-- Getir unapproved poll snapshot — onay bekleyen kuyruktan kaybolan siparişleri yakalamak için.

CREATE TABLE IF NOT EXISTS ops_getir_unapproved_seen (
  branch_id UUID NOT NULL REFERENCES ops_branches(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  confirmation_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (branch_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_getir_unapproved_seen_last
  ON ops_getir_unapproved_seen (branch_id, last_seen_at DESC);

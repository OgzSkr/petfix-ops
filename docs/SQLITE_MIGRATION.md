# SQLite Migration Plan

Goal: move from `data/db.json` to SQLite without breaking production or profit formulas.

## Principles

1. **Dual-write first** — JSON remains source of truth until parity verified.
2. **Profit logic unchanged** — `lib/order-profitability.js` stays the calculation engine.
3. **Channel-ready schema** — every order/product row has `channel_id`.

## Target schema (v1)

```sql
-- products (channel-scoped)
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'trendyol',
  barcode TEXT NOT NULL,
  sku TEXT,
  title TEXT,
  brand TEXT,
  commission_rate REAL,
  payload_json TEXT,
  updated_at TEXT,
  UNIQUE(channel, barcode)
);

-- costs (local overrides)
CREATE TABLE product_costs (
  barcode TEXT PRIMARY KEY,
  product_cost REAL,
  desi REAL,
  commission_rate REAL,
  cost_vat_rate REAL DEFAULT 20,
  extra_expense REAL DEFAULT 0,
  updated_at TEXT
);

-- buybox snapshots (current trim logic → SQL + history table)
CREATE TABLE buybox_snapshots (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'trendyol',
  barcode TEXT NOT NULL,
  buybox_price REAL,
  buybox_order TEXT,
  seller_id TEXT,
  seller_name TEXT,
  snapshot_key TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL
);

-- append-only history (mirrors buybox-history.jsonl)
CREATE TABLE buybox_history (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  barcode TEXT NOT NULL,
  buybox_price REAL,
  buybox_order TEXT,
  seller_id TEXT,
  seller_name TEXT,
  source TEXT,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_buybox_history_barcode ON buybox_history(barcode, recorded_at DESC);

-- settings & alerts (loss email, etc.)
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT
);
```

## Migration phases

| Phase | Work | Risk |
|-------|------|------|
| **0 (now)** | JSONL buybox history + modular platform | Low |
| **1** | Add `lib/db/sqlite-store.js` with better-sqlite3 (optional dep) | Low |
| **2** | Import script: `node scripts/migrate-json-to-sqlite.js` | Medium |
| **3** | Dual-read: SQLite primary, JSON fallback | Medium |
| **4** | Dual-write on mutations | Medium |
| **5** | Remove JSON writes after 1 week parity logs | High |

## Parity checks

- Row counts: products, costs, snapshots
- Sample 20 barcodes: latest buybox price match
- Order profit totals for last 7 days (Trendyol) — must match within ±0.01 ₺

## Rollback

Keep `data/db.json` backup before each phase. Feature flag: `DB_BACKEND=json|sqlite|dual`.

## Why not jump directly?

- `db.json` is ~21k lines — one-shot migration is risky during live trading.
- SQLite enables indexes for history queries and multi-channel without loading full file.

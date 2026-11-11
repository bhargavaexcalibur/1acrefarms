-- 1acrefarms checkout: D1 (SQLite) schema.
-- Apply once:  npx wrangler d1 execute 1acrefarms-checkout --remote --file=./schema.sql
-- Times are epoch milliseconds (UTC). Money is integer paise.

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,             -- ours: 1AF-T-YYMMDD-XXXXXX (test) / 1AF-W-... (live)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  -- new -> created -> (verified) -> paid ; or failed / expired / gateway_error / amount_mismatch
  status          TEXT NOT NULL,
  gateway         TEXT CHECK (gateway IS NULL OR gateway IN ('razorpay', 'cashfree', 'phonepe')),  -- who took it
  gw_order_id     TEXT,                         -- Razorpay order_xxx, or our id at Cashfree / PhonePe (merchantOrderId)
  gw_failover     TEXT,                         -- gateways that failed first, e.g. razorpay:server_error:503,cashfree:timeout:0
  payment_id      TEXT,
  items_json      TEXT NOT NULL,                -- priced lines, from the server price table
  packs           INTEGER NOT NULL,
  subtotal_paise  INTEGER NOT NULL,
  delivery_paise  INTEGER NOT NULL,
  total_paise     INTEGER NOT NULL,
  customer_json   TEXT NOT NULL,                -- name, phone, email, address, city, state, pin
  paid_at         INTEGER,
  paid_source     TEXT,                         -- verify | webhook | reconcile
  ship_status     TEXT,                         -- NULL | skipped | pending | pushing | retry | pushed | failed
  ship_attempts   INTEGER NOT NULL DEFAULT 0,
  ship_next_at    INTEGER,
  ship_error      TEXT,
  sr_order_id     TEXT,
  sr_shipment_id  TEXT,
  reconcile_at    INTEGER,
  UNIQUE (gateway, gw_order_id)
);
CREATE INDEX IF NOT EXISTS orders_status_created ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS orders_ship_due ON orders (ship_status, ship_next_at);

-- Webhook dedupe: one row per delivered event (Razorpay x-razorpay-event-id; Cashfree type + payment id;
-- PhonePe event + merchantOrderId).
CREATE TABLE IF NOT EXISTS webhook_events (
  event_key   TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

-- Small key/value cache (Shiprocket token, PhonePe token, alert throttles).
CREATE TABLE IF NOT EXISTS kv (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  expires_at INTEGER
);

-- Optional stock list. A code with no row is not tracked (allowed); qty 0 blocks it.
CREATE TABLE IF NOT EXISTS stock (
  code       TEXT PRIMARY KEY,
  qty        INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

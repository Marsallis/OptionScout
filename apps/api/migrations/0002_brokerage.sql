ALTER TABLE settings ADD COLUMN portfolio_view TEXT NOT NULL DEFAULT 'demo';

CREATE TABLE owner_credentials (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempted_at TEXT NOT NULL,
  succeeded INTEGER NOT NULL
);

CREATE TABLE broker_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_type TEXT NOT NULL,
  authority TEXT NOT NULL,
  masked_label TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  transaction_history_status TEXT NOT NULL,
  history_coverage_start TEXT,
  history_coverage_end TEXT,
  discovered_at TEXT NOT NULL,
  UNIQUE (provider, account_number)
);

CREATE TABLE broker_positions (
  id TEXT PRIMARY KEY NOT NULL,
  broker_account_id TEXT NOT NULL REFERENCES broker_accounts(id),
  provider_symbol TEXT NOT NULL,
  underlying_symbol TEXT NOT NULL,
  option_symbol TEXT,
  instrument_type TEXT NOT NULL,
  quantity TEXT NOT NULL,
  direction TEXT NOT NULL,
  strike TEXT,
  expiration TEXT,
  average_open_price TEXT,
  multiplier TEXT NOT NULL,
  reported_mark TEXT,
  status TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  UNIQUE (broker_account_id, provider_symbol)
);

CREATE TABLE broker_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  broker_account_id TEXT NOT NULL REFERENCES broker_accounts(id),
  provider_transaction_id TEXT NOT NULL,
  symbol TEXT,
  instrument_type TEXT,
  action TEXT,
  quantity TEXT,
  price TEXT,
  executed_at TEXT,
  gross_value TEXT,
  value_effect TEXT,
  commission TEXT,
  fees_json TEXT NOT NULL,
  transaction_type TEXT,
  transaction_subtype TEXT,
  classification TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  UNIQUE (broker_account_id, provider_transaction_id)
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  broker_account_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT,
  actor_type TEXT NOT NULL
);

CREATE TABLE quote_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  bid TEXT,
  ask TEXT,
  mid TEXT,
  mark TEXT,
  last_price TEXT,
  quote_as_of TEXT,
  fetched_at TEXT NOT NULL,
  freshness TEXT NOT NULL,
  entitlement TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX broker_positions_account ON broker_positions (broker_account_id);
CREATE INDEX broker_transactions_account ON broker_transactions (broker_account_id);
CREATE INDEX sync_runs_kind ON sync_runs (kind, finished_at);

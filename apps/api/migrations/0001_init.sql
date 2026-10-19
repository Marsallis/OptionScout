CREATE TABLE app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT,
  display_name TEXT NOT NULL,
  is_demo INTEGER NOT NULL,
  connection_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE positions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  underlying TEXT NOT NULL,
  strategy TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_on TEXT NOT NULL,
  closed_on TEXT,
  thesis TEXT NOT NULL,
  is_demo INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE option_legs (
  id TEXT PRIMARY KEY NOT NULL,
  position_id TEXT NOT NULL REFERENCES positions(id),
  side TEXT NOT NULL,
  option_type TEXT NOT NULL,
  strike REAL NOT NULL,
  expiration TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  open_premium REAL NOT NULL,
  status TEXT NOT NULL,
  instrument_key TEXT NOT NULL,
  tasty_symbol TEXT NOT NULL,
  opened_on TEXT NOT NULL,
  closed_on TEXT,
  is_demo INTEGER NOT NULL
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  position_id TEXT NOT NULL REFERENCES positions(id),
  leg_id TEXT NOT NULL REFERENCES option_legs(id),
  action TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  premium REAL NOT NULL,
  cash_flow REAL NOT NULL,
  occurred_on TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);

CREATE TABLE marks (
  id TEXT PRIMARY KEY NOT NULL,
  instrument_key TEXT NOT NULL UNIQUE,
  mark REAL NOT NULL,
  delta REAL,
  gamma REAL,
  theta REAL,
  vega REAL,
  iv REAL,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  position_id TEXT REFERENCES positions(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);

CREATE TABLE research_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  underlying TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  expiration TEXT NOT NULL,
  strike REAL NOT NULL,
  option_type TEXT NOT NULL,
  illustrative_premium REAL NOT NULL,
  criteria_note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY NOT NULL,
  position_id TEXT REFERENCES positions(id),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL
);

CREATE TABLE watchlist_items (
  id TEXT PRIMARY KEY NOT NULL,
  underlying TEXT NOT NULL,
  note TEXT NOT NULL,
  demo_last REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  is_demo INTEGER NOT NULL
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  density TEXT NOT NULL,
  show_greeks INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX option_legs_position_id ON option_legs (position_id);
CREATE INDEX transactions_position_id ON transactions (position_id);
CREATE INDEX transactions_leg_id ON transactions (leg_id);

INSERT INTO settings (id, density, show_greeks, updated_at)
VALUES (1, 'comfortable', 1, '2026-10-15T20:00:00.000Z');

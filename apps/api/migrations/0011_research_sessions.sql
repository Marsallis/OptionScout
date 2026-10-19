-- Phase 1D.2a.5 — Persistent research sessions + versioned universe holdings.
-- Normalized company/candidate/OCC/batch rows; JSON reserved for small metadata and UI prefs.
-- Does not store credentials, tokens, or raw brokerage envelopes.

CREATE TABLE IF NOT EXISTS discovery_universe_versions (
  id TEXT PRIMARY KEY NOT NULL,
  universe_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  universe_type TEXT NOT NULL,
  fund_ticker TEXT,
  provider TEXT NOT NULL,
  source_label TEXT NOT NULL,
  holdings_effective_date TEXT,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  supported_equity_count INTEGER NOT NULL,
  unsupported_json TEXT NOT NULL DEFAULT '[]',
  tickers_json TEXT NOT NULL,
  company_names_json TEXT NOT NULL DEFAULT '{}',
  holdings_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (universe_id, version)
);

CREATE INDEX IF NOT EXISTS idx_universe_versions_universe
  ON discovery_universe_versions (universe_id, version DESC);

-- Extend discovery_universes with optional version pointer (nullable for legacy rows).
-- SQLite: ADD COLUMN is idempotent only if migration runs once via schema_migrations.
ALTER TABLE discovery_universes ADD COLUMN current_version_id TEXT;
ALTER TABLE discovery_universes ADD COLUMN fund_ticker TEXT;
ALTER TABLE discovery_universes ADD COLUMN universe_type TEXT NOT NULL DEFAULT 'custom';

CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_scope TEXT NOT NULL DEFAULT 'local-owner',
  scan_type TEXT NOT NULL,
  status TEXT NOT NULL,
  universe_id TEXT,
  universe_version_id TEXT,
  universe_label TEXT NOT NULL,
  ordered_ticker_queue_json TEXT NOT NULL,
  company_cursor INTEGER NOT NULL DEFAULT 0,
  profile_id TEXT NOT NULL,
  profile_revision INTEGER NOT NULL,
  strategy_snapshot_json TEXT NOT NULL,
  scan_priority TEXT NOT NULL,
  tolerances_json TEXT NOT NULL DEFAULT '{}',
  ui_prefs_json TEXT NOT NULL DEFAULT '{}',
  progress_json TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  active_lock_until TEXT,
  active_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_sessions_type_updated
  ON research_sessions (scan_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_sessions_status
  ON research_sessions (status);

CREATE TABLE IF NOT EXISTS research_session_companies (
  session_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  queue_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  company_name TEXT,
  underlying_price TEXT,
  underlying_quote_at TEXT,
  eligible_contracts INTEGER NOT NULL DEFAULT 0,
  evaluated_contracts INTEGER NOT NULL DEFAULT 0,
  incomplete_contracts INTEGER NOT NULL DEFAULT 0,
  exact_matches INTEGER NOT NULL DEFAULT 0,
  near_matches INTEGER NOT NULL DEFAULT 0,
  remaining_occ_json TEXT NOT NULL DEFAULT '[]',
  chain_as_of TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_research_session_companies_status
  ON research_session_companies (session_id, status);

CREATE TABLE IF NOT EXISTS research_session_candidates (
  session_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  occ_symbol TEXT NOT NULL,
  underlying TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, candidate_id),
  UNIQUE (session_id, occ_symbol)
);

CREATE INDEX IF NOT EXISTS idx_research_session_candidates_underlying
  ON research_session_candidates (session_id, underlying);

CREATE TABLE IF NOT EXISTS research_session_evaluated_occ (
  session_id TEXT NOT NULL,
  occ_symbol TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, occ_symbol)
);

CREATE TABLE IF NOT EXISTS research_session_batches (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  batch_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  ticker_batch_json TEXT NOT NULL DEFAULT '[]',
  evaluation_budget INTEGER,
  evaluation_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_session_batches_session
  ON research_session_batches (session_id, started_at DESC);

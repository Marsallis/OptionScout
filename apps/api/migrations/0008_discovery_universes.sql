-- Owner-managed discovery ticker lists for Smart Scan (Phase 1D.2a).
-- Curated starters ship in application code and are not stored here.
CREATE TABLE IF NOT EXISTS discovery_universes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_label TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  tickers_json TEXT NOT NULL,
  company_names_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

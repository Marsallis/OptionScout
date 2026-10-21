-- Hypothetical research only. These rows are not brokerage holdings.

CREATE TABLE saved_pmcc_ideas (
  id TEXT PRIMARY KEY,
  underlying TEXT NOT NULL,
  long_occ TEXT NOT NULL,
  short_occ TEXT,
  profile_id TEXT,
  profile_revision INTEGER,
  session_id TEXT,
  quote_as_of TEXT,
  notes TEXT NOT NULL DEFAULT '',
  long_snapshot_json TEXT NOT NULL,
  short_snapshot_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

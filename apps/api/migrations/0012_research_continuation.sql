-- Phase 1D.2a.5c — restart-safe continuation and versioned universes.
-- Additive only. Restoring a pre-0012 backup is the supported rollback path.

ALTER TABLE research_session_companies ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_session_companies ADD COLUMN last_batch_id TEXT;

ALTER TABLE research_session_candidates ADD COLUMN batch_id TEXT;
ALTER TABLE research_session_evaluated_occ ADD COLUMN batch_id TEXT;

ALTER TABLE research_session_batches ADD COLUMN seq INTEGER;
ALTER TABLE research_session_batches ADD COLUMN planned_occ_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_session_batches ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_session_batches_seq
  ON research_session_batches (session_id, seq);

CREATE INDEX IF NOT EXISTS idx_research_sessions_owner_type_updated
  ON research_sessions (owner_scope, scan_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_session_evaluated_occ_batch
  ON research_session_evaluated_occ (session_id, batch_id);

-- Pre-0012 code wrote a "running" row and a differently named "completed" row for the same batch.
UPDATE research_session_batches
SET status = 'superseded',
    finished_at = COALESCE(finished_at, started_at),
    error = COALESCE(error, 'Legacy running record from before stable batch identity; see the matching completed batch.')
WHERE status = 'running';

UPDATE research_sessions SET active_batch_id = NULL, active_lock_until = NULL WHERE status <> 'running';

-- Saved lists created before versioning get an immutable v1 snapshot of their current membership.
INSERT INTO discovery_universe_versions (
  id, universe_id, version, name, universe_type, fund_ticker, provider, source_label,
  holdings_effective_date, imported_at, row_count, supported_equity_count, unsupported_json,
  tickers_json, company_names_json, holdings_hash, created_at
)
SELECT
  id || '@v1', id, 1, name, COALESCE(universe_type, 'custom'), fund_ticker, 'Owner list', source_label,
  NULL, created_at, json_array_length(tickers_json), json_array_length(tickers_json), '[]',
  tickers_json, company_names_json, NULL, created_at
FROM discovery_universes
WHERE current_version_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM discovery_universe_versions v WHERE v.universe_id = discovery_universes.id);

UPDATE discovery_universes
SET current_version_id = (
  SELECT v.id FROM discovery_universe_versions v
  WHERE v.universe_id = discovery_universes.id
  ORDER BY v.version DESC LIMIT 1
)
WHERE current_version_id IS NULL;

-- Durable last-known market observations for Finder / Smart Scan (Phase 1D.2a.1).
-- Distinct from portfolio quote_snapshots. Field-level merge; never fabricates values.
CREATE TABLE IF NOT EXISTS market_data_observations (
  id TEXT PRIMARY KEY NOT NULL,
  instrument_kind TEXT NOT NULL,
  underlying TEXT NOT NULL,
  occ_symbol TEXT,
  streamer_symbol TEXT NOT NULL,
  bid TEXT,
  ask TEXT,
  mark TEXT,
  last_price TEXT,
  delta TEXT,
  theta TEXT,
  gamma TEXT,
  vega TEXT,
  implied_volatility TEXT,
  volume INTEGER,
  open_interest INTEGER,
  quote_provider_event_at TEXT,
  greek_provider_event_at TEXT,
  underlying_provider_event_at TEXT,
  quote_received_at TEXT,
  greek_received_at TEXT,
  source TEXT NOT NULL,
  session_at_quote TEXT,
  entitlement TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdo_streamer ON market_data_observations (streamer_symbol);
CREATE INDEX IF NOT EXISTS idx_mdo_occ ON market_data_observations (occ_symbol);
CREATE INDEX IF NOT EXISTS idx_mdo_updated ON market_data_observations (updated_at);

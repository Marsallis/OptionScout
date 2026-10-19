CREATE TABLE instrument_symbols (
  requested_symbol TEXT PRIMARY KEY,
  returned_symbol TEXT NOT NULL,
  streamer_symbol TEXT NOT NULL,
  underlying_symbol TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);

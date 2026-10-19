CREATE TABLE finder_bookmarks (
  id TEXT PRIMARY KEY,
  underlying TEXT NOT NULL,
  occ_symbol TEXT NOT NULL,
  streamer_symbol TEXT,
  saved_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

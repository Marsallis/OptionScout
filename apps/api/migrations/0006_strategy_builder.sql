-- Editable strategy profiles with immutable revision history.
-- Prior scan/bookmark snapshots keep their embedded profile revision JSON.

CREATE TABLE strategy_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('builtin-template', 'custom')),
  is_default INTEGER NOT NULL DEFAULT 0,
  current_revision INTEGER NOT NULL,
  origin_template_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE strategy_profile_revisions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (profile_id, revision)
);

CREATE TABLE finder_owner_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_profile_id TEXT,
  last_ticker TEXT,
  last_scan_priority TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE finder_bookmarks ADD COLUMN profile_id TEXT;
ALTER TABLE finder_bookmarks ADD COLUMN profile_revision INTEGER;
ALTER TABLE finder_bookmarks ADD COLUMN scan_id TEXT;
ALTER TABLE finder_bookmarks ADD COLUMN quote_as_of TEXT;

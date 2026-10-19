-- Owner-controlled on-demand LEAPS Finder searches (read-only market data).
-- Effective live search still requires FINDER_LIVE_SCAN=true at process start.
ALTER TABLE settings ADD COLUMN finder_on_demand_search INTEGER NOT NULL DEFAULT 0;

-- Optional composition from an owner-imported holdings file.
-- Missing on older versions means the file did not store sector or weight.
-- Existing version rows are not rewritten.

ALTER TABLE discovery_universe_versions ADD COLUMN sectors_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discovery_universe_versions ADD COLUMN weights_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discovery_universes ADD COLUMN sectors_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discovery_universes ADD COLUMN weights_json TEXT NOT NULL DEFAULT '{}';

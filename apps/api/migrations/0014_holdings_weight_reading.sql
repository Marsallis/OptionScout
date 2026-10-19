-- How a holdings weight column was read. Existing versions stay "unspecified"
-- and their weights_json text is not rewritten.

ALTER TABLE discovery_universe_versions ADD COLUMN weight_reading TEXT NOT NULL DEFAULT 'unspecified';
ALTER TABLE discovery_universe_versions ADD COLUMN weight_percents_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discovery_universes ADD COLUMN weight_reading TEXT NOT NULL DEFAULT 'unspecified';
ALTER TABLE discovery_universes ADD COLUMN weight_percents_json TEXT NOT NULL DEFAULT '{}';

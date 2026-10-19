-- Owner-selectable Smart Scan mode (diagnostic allowlist vs normal multi-ticker).
-- Live Smart Scan still requires SMART_SCAN_LIVE=true at process start.
-- Default 'normal' for this install (Phase 1D.2a.3).
ALTER TABLE settings ADD COLUMN smart_scan_mode TEXT NOT NULL DEFAULT 'normal';

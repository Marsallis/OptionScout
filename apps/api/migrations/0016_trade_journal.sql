-- Local research notes. Not brokerage fills and not orders.

CREATE TABLE trade_journal (
  id TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  strategy TEXT NOT NULL,
  entry_premium TEXT NOT NULL,
  exit_premium TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

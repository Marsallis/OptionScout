CREATE TABLE strategy_groups (
  id TEXT PRIMARY KEY NOT NULL,
  broker_account_id TEXT NOT NULL REFERENCES broker_accounts(id),
  underlying_symbol TEXT NOT NULL,
  long_symbol TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE strategy_members (
  id TEXT PRIMARY KEY NOT NULL,
  strategy_group_id TEXT NOT NULL REFERENCES strategy_groups(id) ON DELETE CASCADE,
  provider_symbol TEXT NOT NULL,
  opening_transaction_id TEXT NOT NULL,
  UNIQUE (strategy_group_id, opening_transaction_id)
);

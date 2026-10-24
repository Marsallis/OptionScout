import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  externalId: text('external_id'),
  displayName: text('display_name').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
  connectionStatus: text('connection_status').notNull(),
  createdAt: text('created_at').notNull(),
});

export const positions = sqliteTable('positions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  underlying: text('underlying').notNull(),
  strategy: text('strategy').notNull(),
  status: text('status').notNull(),
  openedOn: text('opened_on').notNull(),
  closedOn: text('closed_on'),
  thesis: text('thesis').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const optionLegs = sqliteTable('option_legs', {
  id: text('id').primaryKey(),
  positionId: text('position_id').notNull(),
  side: text('side').notNull(),
  optionType: text('option_type').notNull(),
  strike: real('strike').notNull(),
  expiration: text('expiration').notNull(),
  quantity: integer('quantity').notNull(),
  openPremium: real('open_premium').notNull(),
  status: text('status').notNull(),
  instrumentKey: text('instrument_key').notNull(),
  tastySymbol: text('tasty_symbol').notNull(),
  openedOn: text('opened_on').notNull(),
  closedOn: text('closed_on'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  positionId: text('position_id').notNull(),
  legId: text('leg_id').notNull(),
  action: text('action').notNull(),
  quantity: integer('quantity').notNull(),
  premium: real('premium').notNull(),
  cashFlow: real('cash_flow').notNull(),
  occurredOn: text('occurred_on').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const marks = sqliteTable('marks', {
  id: text('id').primaryKey(),
  instrumentKey: text('instrument_key').notNull().unique(),
  mark: real('mark').notNull(),
  delta: real('delta'),
  gamma: real('gamma'),
  theta: real('theta'),
  vega: real('vega'),
  iv: real('iv'),
  asOf: text('as_of').notNull(),
  source: text('source').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const journalEntries = sqliteTable('journal_entries', {
  id: text('id').primaryKey(),
  positionId: text('position_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const researchCandidates = sqliteTable('research_candidates', {
  id: text('id').primaryKey(),
  underlying: text('underlying').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  expiration: text('expiration').notNull(),
  strike: real('strike').notNull(),
  optionType: text('option_type').notNull(),
  illustrativePremium: real('illustrative_premium').notNull(),
  criteriaNote: text('criteria_note').notNull(),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  positionId: text('position_id'),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  createdAt: text('created_at').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const watchlistItems = sqliteTable('watchlist_items', {
  id: text('id').primaryKey(),
  underlying: text('underlying').notNull(),
  note: text('note').notNull(),
  demoLast: real('demo_last').notNull(),
  sortOrder: integer('sort_order').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull(),
});

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  density: text('density').notNull(),
  showGreeks: integer('show_greeks', { mode: 'boolean' }).notNull(),
  portfolioView: text('portfolio_view').notNull(),
  /** Owner toggle. Live searches also require FINDER_LIVE_SCAN=true at process start. */
  finderOnDemandSearch: integer('finder_on_demand_search', { mode: 'boolean' }).notNull().default(false),
  /** Owner preference. Live Smart Scan also requires SMART_SCAN_LIVE=true at process start. */
  smartScanMode: text('smart_scan_mode').notNull().default('normal'),
  updatedAt: text('updated_at').notNull(),
});

export const ownerCredentials = sqliteTable('owner_credentials', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  csrfHash: text('csrf_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const loginAttempts = sqliteTable('login_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attemptedAt: text('attempted_at').notNull(),
  succeeded: integer('succeeded', { mode: 'boolean' }).notNull(),
});

export const brokerAccounts = sqliteTable('broker_accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  accountNumber: text('account_number').notNull(),
  accountType: text('account_type').notNull(),
  authority: text('authority').notNull(),
  maskedLabel: text('masked_label').notNull(),
  selected: integer('selected', { mode: 'boolean' }).notNull(),
  transactionHistoryStatus: text('transaction_history_status').notNull(),
  historyCoverageStart: text('history_coverage_start'),
  historyCoverageEnd: text('history_coverage_end'),
  discoveredAt: text('discovered_at').notNull(),
});

export const brokerPositions = sqliteTable('broker_positions', {
  id: text('id').primaryKey(),
  brokerAccountId: text('broker_account_id').notNull(),
  providerSymbol: text('provider_symbol').notNull(),
  underlyingSymbol: text('underlying_symbol').notNull(),
  optionSymbol: text('option_symbol'),
  instrumentType: text('instrument_type').notNull(),
  quantity: text('quantity').notNull(),
  direction: text('direction').notNull(),
  strike: text('strike'),
  expiration: text('expiration'),
  averageOpenPrice: text('average_open_price'),
  multiplier: text('multiplier').notNull(),
  reportedMark: text('reported_mark'),
  status: text('status').notNull(),
  syncedAt: text('synced_at').notNull(),
  rawJson: text('raw_json').notNull(),
});

export const brokerTransactions = sqliteTable('broker_transactions', {
  id: text('id').primaryKey(),
  brokerAccountId: text('broker_account_id').notNull(),
  providerTransactionId: text('provider_transaction_id').notNull(),
  symbol: text('symbol'),
  instrumentType: text('instrument_type'),
  action: text('action'),
  quantity: text('quantity'),
  price: text('price'),
  executedAt: text('executed_at'),
  grossValue: text('gross_value'),
  valueEffect: text('value_effect'),
  commission: text('commission'),
  feesJson: text('fees_json').notNull(),
  transactionType: text('transaction_type'),
  transactionSubtype: text('transaction_subtype'),
  classification: text('classification').notNull(),
  rawJson: text('raw_json').notNull(),
});

export const syncRuns = sqliteTable('sync_runs', {
  id: text('id').primaryKey(),
  brokerAccountId: text('broker_account_id'),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  errorMessage: text('error_message'),
  actorType: text('actor_type').notNull(),
});

export const strategyGroups = sqliteTable('strategy_groups', {
  id: text('id').primaryKey(),
  brokerAccountId: text('broker_account_id').notNull(),
  underlyingSymbol: text('underlying_symbol').notNull(),
  longSymbol: text('long_symbol').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tradeJournal = sqliteTable('trade_journal', {
  id: text('id').primaryKey(),
  entryDate: text('entry_date').notNull(),
  ticker: text('ticker').notNull(),
  strategy: text('strategy').notNull(),
  entryPremium: text('entry_premium').notNull(),
  exitPremium: text('exit_premium'),
  notes: text('notes').notNull(),
  tags: text('tags').notNull(),
  outcome: text('outcome').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const savedPmccIdeas = sqliteTable('saved_pmcc_ideas', {
  id: text('id').primaryKey(),
  underlying: text('underlying').notNull(),
  longOcc: text('long_occ').notNull(),
  shortOcc: text('short_occ'),
  profileId: text('profile_id'),
  profileRevision: integer('profile_revision'),
  sessionId: text('session_id'),
  quoteAsOf: text('quote_as_of'),
  notes: text('notes').notNull(),
  longSnapshotJson: text('long_snapshot_json').notNull(),
  shortSnapshotJson: text('short_snapshot_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const strategyMembers = sqliteTable('strategy_members', {
  id: text('id').primaryKey(),
  strategyGroupId: text('strategy_group_id').notNull(),
  providerSymbol: text('provider_symbol').notNull(),
  openingTransactionId: text('opening_transaction_id').notNull(),
});

export const instrumentSymbols = sqliteTable('instrument_symbols', {
  requestedSymbol: text('requested_symbol').primaryKey(),
  returnedSymbol: text('returned_symbol').notNull(),
  streamerSymbol: text('streamer_symbol').notNull(),
  underlyingSymbol: text('underlying_symbol').notNull(),
  resolvedAt: text('resolved_at').notNull(),
});

export const quoteSnapshots = sqliteTable('quote_snapshots', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  instrumentType: text('instrument_type').notNull(),
  bid: text('bid'),
  ask: text('ask'),
  mid: text('mid'),
  mark: text('mark'),
  lastPrice: text('last_price'),
  quoteAsOf: text('quote_as_of'),
  fetchedAt: text('fetched_at').notNull(),
  freshness: text('freshness').notNull(),
  entitlement: text('entitlement').notNull(),
  source: text('source').notNull(),
  message: text('message').notNull(),
});

/** Finder/Smart Scan last-known provider observations (field-level merge). Not portfolio marks. */
export const marketDataObservations = sqliteTable('market_data_observations', {
  id: text('id').primaryKey(),
  instrumentKind: text('instrument_kind').notNull(),
  underlying: text('underlying').notNull(),
  occSymbol: text('occ_symbol'),
  streamerSymbol: text('streamer_symbol').notNull(),
  bid: text('bid'),
  ask: text('ask'),
  mark: text('mark'),
  lastPrice: text('last_price'),
  delta: text('delta'),
  theta: text('theta'),
  gamma: text('gamma'),
  vega: text('vega'),
  impliedVolatility: text('implied_volatility'),
  volume: integer('volume'),
  openInterest: integer('open_interest'),
  quoteProviderEventAt: text('quote_provider_event_at'),
  greekProviderEventAt: text('greek_provider_event_at'),
  underlyingProviderEventAt: text('underlying_provider_event_at'),
  quoteReceivedAt: text('quote_received_at'),
  greekReceivedAt: text('greek_received_at'),
  source: text('source').notNull(),
  sessionAtQuote: text('session_at_quote'),
  entitlement: text('entitlement'),
  updatedAt: text('updated_at').notNull(),
});

/** Local Finder bookmarks. Not brokerage positions or transactions. */
export const finderBookmarks = sqliteTable('finder_bookmarks', {
  id: text('id').primaryKey(),
  underlying: text('underlying').notNull(),
  occSymbol: text('occ_symbol').notNull(),
  streamerSymbol: text('streamer_symbol'),
  savedAt: text('saved_at').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  profileId: text('profile_id'),
  profileRevision: integer('profile_revision'),
  scanId: text('scan_id'),
  quoteAsOf: text('quote_as_of'),
});

/** Editable Finder strategy profiles (current pointer). Revisions are immutable. */
export const strategyProfiles = sqliteTable('strategy_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull(),
  currentRevision: integer('current_revision').notNull(),
  originTemplateId: text('origin_template_id'),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const strategyProfileRevisions = sqliteTable('strategy_profile_revisions', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull(),
  revision: integer('revision').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const finderOwnerPreferences = sqliteTable('finder_owner_preferences', {
  id: integer('id').primaryKey(),
  defaultProfileId: text('default_profile_id'),
  lastTicker: text('last_ticker'),
  lastScanPriority: text('last_scan_priority'),
  updatedAt: text('updated_at').notNull(),
});

/** Owner-saved Smart Scan ticker lists (custom / CSV). Curated starters live in shared code. */
export const discoveryUniverses = sqliteTable('discovery_universes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceLabel: text('source_label').notNull(),
  retrievedAt: text('retrieved_at').notNull(),
  tickersJson: text('tickers_json').notNull(),
  companyNamesJson: text('company_names_json').notNull().default('{}'),
  sectorsJson: text('sectors_json').notNull().default('{}'),
  weightsJson: text('weights_json').notNull().default('{}'),
  weightReading: text('weight_reading').notNull().default('unspecified'),
  weightPercentsJson: text('weight_percents_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  currentVersionId: text('current_version_id'),
  fundTicker: text('fund_ticker'),
  universeType: text('universe_type').notNull().default('custom'),
});

/** Immutable membership snapshots. Research sessions pin one of these rows. */
export const discoveryUniverseVersions = sqliteTable('discovery_universe_versions', {
  id: text('id').primaryKey(),
  universeId: text('universe_id').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  universeType: text('universe_type').notNull(),
  fundTicker: text('fund_ticker'),
  provider: text('provider').notNull(),
  sourceLabel: text('source_label').notNull(),
  holdingsEffectiveDate: text('holdings_effective_date'),
  importedAt: text('imported_at').notNull(),
  rowCount: integer('row_count').notNull(),
  supportedEquityCount: integer('supported_equity_count').notNull(),
  unsupportedJson: text('unsupported_json').notNull().default('[]'),
  tickersJson: text('tickers_json').notNull(),
  companyNamesJson: text('company_names_json').notNull().default('{}'),
  sectorsJson: text('sectors_json').notNull().default('{}'),
  weightsJson: text('weights_json').notNull().default('{}'),
  weightReading: text('weight_reading').notNull().default('unspecified'),
  weightPercentsJson: text('weight_percents_json').notNull().default('{}'),
  holdingsHash: text('holdings_hash'),
  createdAt: text('created_at').notNull(),
});

export const researchSessions = sqliteTable('research_sessions', {
  id: text('id').primaryKey(),
  ownerScope: text('owner_scope').notNull(),
  scanType: text('scan_type').notNull(),
  status: text('status').notNull(),
  universeId: text('universe_id'),
  universeVersionId: text('universe_version_id'),
  universeLabel: text('universe_label').notNull(),
  orderedTickerQueueJson: text('ordered_ticker_queue_json').notNull(),
  companyCursor: integer('company_cursor').notNull(),
  profileId: text('profile_id').notNull(),
  profileRevision: integer('profile_revision').notNull(),
  strategySnapshotJson: text('strategy_snapshot_json').notNull(),
  scanPriority: text('scan_priority').notNull(),
  tolerancesJson: text('tolerances_json').notNull(),
  uiPrefsJson: text('ui_prefs_json').notNull(),
  progressJson: text('progress_json').notNull(),
  metaJson: text('meta_json').notNull(),
  activeLockUntil: text('active_lock_until'),
  activeBatchId: text('active_batch_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  finishedAt: text('finished_at'),
});

export const researchSessionCompanies = sqliteTable('research_session_companies', {
  sessionId: text('session_id').notNull(),
  ticker: text('ticker').notNull(),
  queueIndex: integer('queue_index').notNull(),
  status: text('status').notNull(),
  message: text('message').notNull(),
  companyName: text('company_name'),
  underlyingPrice: text('underlying_price'),
  underlyingQuoteAt: text('underlying_quote_at'),
  eligibleContracts: integer('eligible_contracts').notNull(),
  evaluatedContracts: integer('evaluated_contracts').notNull(),
  incompleteContracts: integer('incomplete_contracts').notNull(),
  exactMatches: integer('exact_matches').notNull(),
  nearMatches: integer('near_matches').notNull(),
  remainingOccJson: text('remaining_occ_json').notNull(),
  chainAsOf: text('chain_as_of'),
  lastError: text('last_error'),
  attemptCount: integer('attempt_count').notNull(),
  lastBatchId: text('last_batch_id'),
  updatedAt: text('updated_at').notNull(),
});

export const researchSessionCandidates = sqliteTable('research_session_candidates', {
  sessionId: text('session_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  occSymbol: text('occ_symbol').notNull(),
  underlying: text('underlying').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  evaluatedAt: text('evaluated_at').notNull(),
  batchId: text('batch_id'),
});

export const researchSessionEvaluatedOcc = sqliteTable('research_session_evaluated_occ', {
  sessionId: text('session_id').notNull(),
  occSymbol: text('occ_symbol').notNull(),
  evaluatedAt: text('evaluated_at').notNull(),
  batchId: text('batch_id'),
});

export const researchSessionBatches = sqliteTable('research_session_batches', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  seq: integer('seq'),
  batchKind: text('batch_kind').notNull(),
  status: text('status').notNull(),
  tickerBatchJson: text('ticker_batch_json').notNull(),
  plannedOccJson: text('planned_occ_json').notNull(),
  evaluationBudget: integer('evaluation_budget'),
  evaluationCount: integer('evaluation_count').notNull(),
  startedAt: text('started_at').notNull(),
  updatedAt: text('updated_at'),
  finishedAt: text('finished_at'),
  error: text('error'),
});

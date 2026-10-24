export { APP_NAME, DEMO_AS_OF, DEMO_DISCLAIMER, PHASE, UPCOMING_EXPIRATION_DAYS } from './phase.js';
export type {
  AccountSyncResult,
  AccountSyncService,
  BrokerageAccountSummary,
  BrokerageProvider,
  BrokerConnectionStatus,
  InstrumentQuote,
  MarketDataProvider,
  QuoteStreamService,
  QuoteStreamStatus,
  ResearchCandidateRecord,
  ResearchProvider,
} from './providers.js';
export {
  accountSelectionSchema,
  alertViewSchema,
  brokerOverviewSchema,
  brokerageStatusSchema,
  dashboardSchema,
  healthSchema,
  importedPositionSchema,
  importedTransactionSchema,
  journalEntrySchema,
  loginRequestSchema,
  quoteSnapshotSchema,
  sessionViewSchema,
  settingsSchema,
  settingsUpdateSchema,
  syncRequestSchema,
  portfolioSchema,
  strategyConfirmSchema,
} from './schemas.js';
export {
  SAL_PMCC_DEEP_ITM,
  STRATEGY_FIELD_HELP,
  STRATEGY_PROFILE_VERSION,
  classifyLongCall,
  classifyShortCall,
  downsidePrices,
  normalizeStrategyProfile,
  strategyHardRequirementsSchema,
  strategyPreferredTargetsSchema,
  strategyProfileSchema,
} from './strategy-profile.js';
export type { LongCallObservation, ShortCallObservation, StrategyClassification, StrategyProfile } from './strategy-profile.js';
export {
  DISCOVERY_METRICS,
  DISCOVERY_OUTCOME_LABELS,
  SHOW_PROFILE_MISSES,
  compareContracts,
  discoverContracts,
  discoveryToleranceSchema,
  downsideMoneyness,
  evaluateContract,
  filterDiscovery,
  normalizeExploratoryDelta,
  paretoFront,
  pmccCompatibility,
  sortDiscovery,
} from './discovery.js';
export {
  PREFERENCE_GAP_THRESHOLDS,
  formatContractDisplay,
  formatDelta,
  formatPercentMetric,
  bidAskSpreadWarning,
  formatSpreadDisplay,
  WIDE_BID_ASK_SPREAD_PERCENT,
  formatUsd,
  summarizePreferenceGaps,
} from './finder-display.js';
export type { PreferenceGapSeverity, PreferenceGapSummary } from './finder-display.js';
export type {
  DiscoveryContract,
  DiscoveryFilter,
  DiscoveryMetric,
  DiscoveryOutcome,
  DiscoveryReason,
  DiscoveryRow,
  DiscoveryTolerances,
  MarketDataQuality,
  MetricObjective,
} from './discovery.js';
export {
  FINDER_BATCH_SIZE,
  FINDER_DEFAULT_EVALUATION_BUDGET,
  FINDER_MAX_EVALUATION_BUDGET,
  FINDER_METRIC_TOOLTIPS,
  FINDER_SCREENING_FRESHNESS_SECONDS_DEFAULT,
  finderBookmarkCreateSchema,
  finderBookmarkSchema,
  finderBookmarksResponseSchema,
  finderBookmarkWarningSchema,
  finderCandidateSchema,
  finderRetryMissingRequestSchema,
  finderScanMoreRequestSchema,
  finderScanRequestSchema,
  finderScanResultSchema,
  finderValidationCountersSchema,
} from './finder.js';
export type {
  FinderBookmark,
  FinderBookmarksResponse,
  FinderBookmarkWarning,
  FinderCandidate,
  FinderMarketContext,
  FinderPlainProgress,
  FinderScanRequest,
  FinderScanResult,
  FinderValidationCounters,
} from './finder.js';
export {
  EMPTY_DISPLAY_FILTER,
  SCAN_MORE_PRIORITIES,
  SCAN_MORE_PRIORITY_LABELS,
  applyDisplayFilters,
  finderDisplayFilterSchema,
  metricAvailabilityNotes,
} from './finder-filters.js';
export type {
  FilterAvailability,
  FilterAvailabilityNote,
  FinderDisplayFilter,
  ScanMorePriority,
} from './finder-filters.js';
export {
  TRADEOFF_CRITERION_LABELS,
  exploreTradeoffs,
  toTradeoffView,
} from './finder-tradeoffs.js';
export type {
  TradeoffCandidateView,
  TradeoffConflict,
  TradeoffCriterion,
  TradeoffExplorerResult,
  TradeoffFilterDraft,
} from './finder-tradeoffs.js';
export { FINDER_GLOSSARY } from './finder-education.js';
export type { FinderGlossaryKey } from './finder-education.js';
export {
  COMPARISON_PRIORITY_LABELS,
  FINDER_PROGRESS_CHIP_TOOLTIPS,
  buildComparisonSummary,
  buildLeapsPlainSummary,
  buildPremiumBreakdown,
  buildStrategyFitRows,
  comparisonLeaders,
  computePremiumFromQuote,
  expirationPayoffScenarios,
  greekVerificationLabel,
  isUnverifiedOrIncompleteCandidate,
  isVerifiedConfiguredMatch,
  observationFreshnessLabel,
  quoteStatusCopy,
  sortCandidatesByPriority,
} from './finder-analysis.js';
export type {
  ComparisonMetricLeader,
  ComparisonPriority,
  ExpirationPayoffPoint,
  PremiumBreakdown,
  QuoteStatusCopy,
  StrategyFitRow,
  StrategyFitStatus,
} from './finder-analysis.js';
export {
  PLAN_FIT_CHECK_IDS,
  PLAN_FIT_HARD_CHECK_IDS,
  PLAN_FIT_PREF_CHECK_IDS,
  PLAN_FIT_EXTRA_ROW_IDS,
  PLAN_FIT_PRESENTATION_GAP_THRESHOLDS,
  PLAN_FIT_RANKING_SCOPE_NOTE,
  PMCC_EXPLAINER_SECTIONS,
  STRATEGY_MATCH_GROUP_LABELS,
  STRATEGY_MATCH_GROUP_ORDER,
  assignRankingBadges,
  BEGINNER_DISCOVERY_GROUP_LABELS,
  BEGINNER_DISCOVERY_GROUPS,
  beginnerDiscoveryGroup,
  beginnerDiscoveryGroupForCandidate,
  buildBeginnerContractSummary,
  buildPlanFitSummary,
  buildPlanFitSummaryWithPeers,
  explainContractTradeoff,
  focusPreferenceDeviation,
  groupCandidatesForStrategyMatch,
  markParetoEfficientEligible,
  rankCandidatesForBeginner,
  sortCandidatesByFactualMetric,
} from './plan-fit.js';
export type {
  BeginnerContractSummary,
  BeginnerDiscoveryGroup,
  FactualSortMetric,
  PlanFitCheck,
  PlanFitCheckId,
  PlanFitCheckResult,
  PlanFitExtraCheckId,
  PlanFitRankingBadge,
  PlanFitSummary,
  PlanFitTier,
  PreferenceDeviation,
  StrategyEligibility,
  StrategyMatchGroup,
  StrategyMatchGroupId,
} from './plan-fit.js';
export {
  ACCEPTANCE_SAVED_PROFILE,
  PLAN_FIT_ACCEPTANCE_NOTICE,
  buildCvxJan2029AcceptanceCandidate,
  buildWmtJan2029AcceptanceCandidate,
} from './plan-fit-acceptance-fixtures.js';
export {
  EMPTY_DISCOVER_RESULT_FILTERS,
  countActiveDiscoverFilters,
  describeActiveDiscoverFilters,
  filterDiscoverCandidates,
} from './discover-result-filters.js';
export type {
  DiscoverDataFreshnessFilter,
  DiscoverMissingDataFilter,
  DiscoverPrefsFilter,
  DiscoverResultFilters,
} from './discover-result-filters.js';
export {
  assessCandidate,
  buildCandidateAssessmentPlainSummary,
  formatObservationDate,
  isHistoricalNumericalFit,
  isVerifiedCurrentMatch,
  liquidityAssessmentLabel,
  marketDataValidityLabel,
  observationFreshnessAssessmentLabel,
  sortCandidatesClosestToStrategy,
  strategyFitAssessmentLabel,
  underlyingSpotIncompatible,
} from './finder-assessment.js';
export type {
  CandidateAssessment,
  LiquidityAssessmentLabel,
  MarketDataValidityLabel,
  ObservationFreshnessAssessmentLabel,
  StrategyFitAssessmentLabel,
} from './finder-assessment.js';
export {
  WMT_ANALYSIS_FIXTURE_NOTICE,
  WMT_ANALYSIS_REFERENCE,
  buildWmtAnalysisCandidate,
} from './wmt-analysis-fixture.js';
export { buildWmtAnalysisScanResult } from './wmt-analysis-scan.js';
export {
  VALUATION_MODE_LABELS,
  buildMultiModeValuation,
  buildRealizedAudit,
  combineLegUnrealized,
  valueOpenLeg,
} from './portfolio-valuation.js';
export type {
  LegQuoteInputs,
  LegValuation,
  MultiModeValuation,
  RealizedAudit,
  RealizedAuditLine,
  ValuationModeId,
} from './portfolio-valuation.js';
export {
  effectiveLiveScanEnabled,
  isDemoOnlyTicker,
  normalizeFinderTicker,
  resolveFinderSearchState,
} from './finder-search-state.js';
export type { FinderSearchBlocker, FinderSearchInputs, FinderSearchState } from './finder-search-state.js';
export {
  CURATED_STARTER_UNIVERSES,
  SMART_SCAN_DEFAULT_BUDGET,
  SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST,
  SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET,
  SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS,
  SMART_SCAN_MAX_BUDGET,
  BEGINNER_SELECTION_LIMIT,
  SMART_SCAN_MAX_TICKERS,
  SMART_SCAN_SESSION_NOTICE,
  buildCandidateValidationCounters,
  buildSmartScanInsights,
  buildSmartScanPlainSummary,
  buildSmartScanPolicy,
  discoveryUniverseCreateSchema,
  discoveryUniverseSchema,
  listCuratedStarterUniverses,
  normalizeSmartTicker,
  normalizeTickerList,
  parseTickerCsv,
  SMART_SCAN_RETRYABLE_TICKER_STATUSES,
  isRetryableTickerStatus,
  smartScanModeSchema,
  smartScanMoreRequestSchema,
  smartScanNextCompaniesRequestSchema,
  smartScanPolicySchema,
  smartScanRequestSchema,
  smartScanResultSchema,
  smartScanRetryCompaniesRequestSchema,
  validateTickerSymbol,
} from './smart-scan.js';
export { INDEX_DIRECTORY_LIST, INDEX_DIRECTORY_UNIVERSES } from './index-directories.js';
export {
  STOCK_COLLECTION_CATALOG,
  collectionDisplayName,
  collectionIsReady,
  installedHoldingsForFund,
  rankCompanyMatches,
  topHoldingsByWeight,
} from './stock-collections.js';
export type { CollectionFundChoice, StockCollectionCatalogEntry } from './stock-collections.js';
export {
  HOLDINGS_IMPORT_MAX_BYTES,
  HOLDINGS_IMPORT_MAX_REQUEST_BYTES,
  HOLDINGS_IMPORT_MAX_ROWS,
  HOLDINGS_PREVIEW_ROW_LIMIT,
  HoldingsPreviewError,
  holdingsCommitRequestSchema,
  holdingsPreviewRequestSchema,
  previewHoldingsCsv,
} from './holdings-csv.js';
export type {
  HoldingsColumnRole,
  HoldingsCommitRequest,
  HoldingsMappableRole,
  HoldingsPreview,
  HoldingsPreviewRow,
  HoldingsRowStatus,
} from './holdings-csv.js';
export {
  RESEARCH_HISTORICAL_NOTICE,
  RESEARCH_INTERRUPTED_NOTICE,
  RESEARCH_REDISCOVERY_NOTICE,
  RESEARCH_SESSION_RETENTION_MAX,
  discoverResearchRestoreSchema,
  finderResearchRestoreSchema,
  researchRestoreSchema,
  researchScanTypeSchema,
  researchSessionListSchema,
  researchSessionStatusSchema,
  researchSessionSummarySchema,
  researchUiPrefsPatchSchema,
  researchUiPrefsSchema,
  sessionPersistenceSchema,
} from './research-session.js';
export type {
  DiscoverResearchRestore,
  FinderResearchRestore,
  ResearchRestore,
  ResearchScanType,
  ResearchSessionList,
  ResearchSessionStatus,
  ResearchSessionSummary,
  ResearchUiPrefs,
  SessionPersistence,
} from './research-session.js';
export type {
  DiscoveryUniverse,
  DiscoveryUniverseSourceKind,
  DiscoveryUniverseVersionInfo,
  SmartScanMode,
  SmartScanMoreRequest,
  SmartScanNextCompaniesRequest,
  SmartScanPolicy,
  SmartScanProgress,
  SmartScanRequest,
  SmartScanResult,
  SmartScanRetryCompaniesRequest,
  SmartScanTickerProgress,
  SmartScanTickerStatus,
  TickerValidation,
} from './smart-scan.js';
export {
  MARKET_DATA_VALIDATION_CODES,
  assessUnderlyingOptionPairing,
  countValidationRejectsByCode,
  hasRejectValidationIssue,
  isUnderlyingNbboWide,
} from './market-data-validation.js';
export type {
  MarketDataValidationCode,
  ValidationIssue,
  ValidationIssueSeverity,
} from './market-data-validation.js';

export {
  bidAskSpreadDollars,
  bidAskSpreadPercent,
  daysToExpiration,
  deltaCapitalExposure,
  downsideMoneynessPercent,
  downsidePrice,
  estimatedPurchaseCost,
  expirationBreakEven,
  extrinsicValue,
  IMPOSSIBLE_CALL_INTRINSIC_PERCENT_CEILING,
  IMPOSSIBLE_CALL_INTRINSIC_TOLERANCE,
  intrinsicPercent,
  intrinsicValue,
  isCrossedMarket,
  isImpossibleStandardCallIntrinsic,
  isInvalidPrice,
  midpoint,
  selectEquitySpotPrice,
  strikeDistance,
} from './finder-math.js';
export { analyzePmcc, evaluatePmccRules } from './pmcc-math.js';
export type { PmccAnalysis, PmccLegInput, PmccRuleCheck } from './pmcc-math.js';
export { callMark, legMark, netEntryDebit, netGreeks, pnlSeries, scenarioPnl, spotGrid } from './risk-lab.js';
export type { RiskGreeks, RiskLeg } from './risk-lab.js';
export {
  estimatedJournalPnl,
  summarizeJournal,
  tradeJournalEntrySchema,
  tradeJournalListSchema,
  tradeJournalOutcomeSchema,
  tradeJournalSummarySchema,
  tradeJournalWriteSchema,
} from './trade-journal.js';
export type { TradeJournalEntry, TradeJournalSummary, TradeJournalWrite } from './trade-journal.js';
export { demoChainContractSchema, demoChainSchema } from './demo-chain.js';
export type { DemoChain, DemoChainContract } from './demo-chain.js';
export type {
  AlertView,
  BrokerOverview,
  Dashboard,
  HealthResponse,
  ImportedPosition,
  ImportedTransaction,
  JournalEntryView,
  LegView,
  PositionView,
  QuoteSnapshotView,
  ResearchCandidateView,
  SessionView,
  SettingsUpdate,
  SettingsView,
  SyncRequest,
  TransactionView,
  WatchlistItemView,
  Portfolio,
  PortfolioPosition,
  StrategyConfirm,
} from './schemas.js';

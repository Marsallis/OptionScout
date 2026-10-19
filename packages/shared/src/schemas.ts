import { z } from 'zod';

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const legViewSchema = z
  .object({
    id: z.string().min(1),
    side: z.enum(['long', 'short']),
    optionType: z.enum(['call', 'put']),
    strike: z.number().positive(),
    expiration: isoDateSchema,
    quantity: z.number().int().positive(),
    openPremium: z.number().nonnegative(),
    status: z.enum(['open', 'closed']),
    instrumentKey: z.string().min(1),
    tastySymbol: z.string().min(1),
    mark: z.number().nonnegative().nullable(),
    delta: z.number().nullable(),
    theta: z.number().nullable(),
    daysToExpiration: z.number().int(),
    unrealizedPnl: z.number().nullable(),
    isDemo: z.literal(true),
  })
  .strict();

export const positionViewSchema = z
  .object({
    id: z.string().min(1),
    underlying: z.string().min(1),
    strategy: z.enum(['leaps', 'pmcc']),
    status: z.enum(['open', 'closed']),
    openedOn: isoDateSchema,
    thesis: z.string().min(1),
    structure: z.string().min(1),
    closedShortSummary: z.string().nullable(),
    isDemo: z.literal(true),
    legs: z.array(legViewSchema).min(1),
    leapsCapital: z.number().nonnegative(),
    shortCallCredits: z.number().nonnegative(),
    realizedPnl: z.number(),
    estimatedUnrealizedPnl: z.number(),
    netDelta: z.number().nullable(),
  })
  .strict();

export const transactionViewSchema = z
  .object({
    id: z.string().min(1),
    positionId: z.string().min(1),
    underlying: z.string().min(1),
    action: z.enum(['buy_to_open', 'sell_to_open', 'buy_to_close', 'sell_to_close', 'expire']),
    occurredOn: isoDateSchema,
    premium: z.number().nonnegative(),
    quantity: z.number().int().positive(),
    cashFlow: z.number(),
    optionSummary: z.string().min(1),
    isDemo: z.literal(true),
  })
  .strict();

export const expirationViewSchema = z
  .object({
    legId: z.string().min(1),
    underlying: z.string().min(1),
    side: z.enum(['long', 'short']),
    optionType: z.enum(['call', 'put']),
    strike: z.number().positive(),
    expiration: isoDateSchema,
    daysToExpiration: z.number().int(),
    isDemo: z.literal(true),
  })
  .strict();

export const watchlistItemSchema = z
  .object({
    id: z.string().min(1),
    underlying: z.string().min(1),
    note: z.string().min(1),
    demoLast: z.number().positive(),
    isDemo: z.literal(true),
  })
  .strict();

export const researchCandidateSchema = z
  .object({
    id: z.string().min(1),
    underlying: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    expiration: isoDateSchema,
    strike: z.number().positive(),
    optionType: z.enum(['call', 'put']),
    illustrativePremium: z.number().nonnegative(),
    criteriaNote: z.string().min(1),
    isDemo: z.literal(true),
  })
  .strict();

export const alertViewSchema = z
  .object({
    id: z.string().min(1),
    positionId: z.string().nullable(),
    severity: z.enum(['info', 'attention', 'warning']),
    title: z.string().min(1),
    message: z.string().min(1),
    isDemo: z.literal(true),
  })
  .strict();

export const journalEntrySchema = z
  .object({
    id: z.string().min(1),
    positionId: z.string().nullable(),
    title: z.string().min(1),
    body: z.string().min(1),
    createdAt: isoDateSchema,
    isDemo: z.literal(true),
  })
  .strict();

export const brokerageStatusSchema = z
  .object({
    providerId: z.literal('demo'),
    connectionStatus: z.literal('demo-only'),
    accountName: z.string().min(1),
    liveCredentialsRequired: z.literal(false),
    oauthImplemented: z.literal(false),
    streamingImplemented: z.literal(false),
    ordersEnabled: z.literal(false),
    label: z.string().min(1),
  })
  .strict();

export const summarySchema = z
  .object({
    openPositions: z.number().int().nonnegative(),
    leapsCapital: z.number().nonnegative(),
    shortCallCreditsReceived: z.number().nonnegative(),
    realizedPnl: z.number(),
    estimatedUnrealizedPnl: z.number(),
    upcomingExpirationCount: z.number().int().nonnegative(),
  })
  .strict();

export const dashboardSchema = z
  .object({
    demo: z.literal(true),
    dataSource: z.literal('demo-fixture'),
    disclaimer: z.string().min(20),
    asOf: z.string().datetime(),
    phase: z.literal('1C'),
    brokerage: brokerageStatusSchema,
    summary: summarySchema,
    positions: z.array(positionViewSchema),
    transactions: z.array(transactionViewSchema),
    upcomingExpirations: z.array(expirationViewSchema),
    watchlist: z.array(watchlistItemSchema),
    research: z.array(researchCandidateSchema),
    alerts: z.array(alertViewSchema),
    journal: z.array(journalEntrySchema),
  })
  .strict();

export const providerStatusSchema = z
  .object({
    role: z.enum([
      'BrokerageProvider',
      'MarketDataProvider',
      'AccountSyncService',
      'QuoteStreamService',
      'ResearchProvider',
    ]),
    implementation: z.string().min(1),
    status: z.enum(['active', 'idle']),
    detail: z.string().min(1),
  })
  .strict();

export const connectionStateSchema = z.enum([
  'not_configured',
  'disabled',
  'disconnected',
  'connected',
  'error',
]);

export const quoteFreshnessSchema = z.enum([
  'not_requested',
  'unavailable',
  'missing',
  'fresh',
  'closed_session',
  'stale',
]);

export const historyStatusSchema = z.enum(['not_imported', 'partial', 'incomplete', 'complete']);

export const transactionImportSchema = z
  .object({
    pagesFetched: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    inserted: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    skipReasons: z.array(
      z
        .object({
          reason: z.string().min(1),
          count: z.number().int().positive(),
        })
        .strict(),
    ),
    earliest: z.string().nullable(),
    latest: z.string().nullable(),
    openingsMissing: z.number().int().nonnegative(),
  })
  .strict();

export const quoteSymbolSchema = z
  .object({
    symbol: z.string().min(1),
    freshness: quoteFreshnessSchema,
    asOf: z.string().datetime().nullable(),
    fetchedAt: z.string().datetime(),
    entitlement: z.enum(['unknown', 'entitled', 'denied']),
  })
  .strict();

export const maskedAccountSchema = z
  .object({
    id: z.string().min(1),
    maskedAccount: z.string().min(5),
    accountType: z.string().min(1),
    authority: z.string().min(1),
    selected: z.boolean(),
  })
  .strict();

export const brokerOverviewSchema = z
  .object({
    phase: z.literal('1C'),
    portfolioView: z.enum(['demo', 'brokerage']),
    authenticated: z.boolean(),
    ownerConfigured: z.boolean(),
    disclaimer: z.string().min(1),
    connection: z
      .object({
        state: connectionStateSchema,
        environment: z.enum(['unset', 'sandbox', 'production']),
        readOnly: z.literal(true),
        liveEnabled: z.boolean(),
        secretFilePresent: z.boolean(),
        lastSuccessAt: z.string().datetime().nullable(),
        message: z.string().min(1),
      })
      .strict(),
    quotes: z
      .object({
        state: quoteFreshnessSchema,
        entitlement: z.enum(['unknown', 'entitled', 'denied']),
        asOf: z.string().datetime().nullable(),
        fetchedAt: z.string().datetime().nullable(),
        message: z.string().min(1),
        symbols: z.array(quoteSymbolSchema),
      })
      .strict(),
    history: z
      .object({
        status: historyStatusSchema,
        coverageStart: isoDateSchema.nullable(),
        coverageEnd: isoDateSchema.nullable(),
        message: z.string().min(1),
        lastImport: transactionImportSchema.nullable(),
      })
      .strict(),
    sync: z
      .object({
        positionsAt: z.string().datetime().nullable(),
        transactionsAt: z.string().datetime().nullable(),
        scheduledSyncEnabled: z.literal(false),
      })
      .strict(),
    accounts: z.array(maskedAccountSchema),
    stream: z
      .object({
        state: z.literal('not-connected'),
        transport: z.literal('dxlink'),
        implemented: z.literal(true),
        liveEnabled: z.literal(false),
        detail: z.string().min(1),
      })
      .strict(),
    safety: z
      .object({
        ordersEnabled: z.literal(false),
        telemetryEnabled: z.literal(false),
        networkAccessRequired: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const sessionViewSchema = z
  .object({
    authenticated: z.boolean(),
    ownerConfigured: z.boolean(),
    expiresAt: z.string().datetime().nullable(),
    csrfToken: z.string().nullable(),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    passphrase: z.string().min(1).max(200),
  })
  .strict();

export const accountSelectionSchema = z
  .object({
    accountId: z.string().min(1),
  })
  .strict();

export const syncRequestSchema = z
  .object({
    transactions: z
      .object({
        mode: z.enum(['recent', 'backfill']),
        startDate: isoDateSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const importedPositionSchema = z
  .object({
    id: z.string().min(1),
    providerSymbol: z.string().min(1),
    underlyingSymbol: z.string().min(1),
    optionSymbol: z.string().nullable(),
    instrumentType: z.string().min(1),
    quantity: z.string().min(1),
    direction: z.enum(['long', 'short', 'zero']),
    strike: z.string().nullable(),
    expiration: isoDateSchema.nullable(),
    averageOpenPrice: z.string().nullable(),
    multiplier: z.string().min(1),
    reportedMark: z.string().nullable(),
    status: z.enum(['open', 'unreconciled', 'closed']),
    syncedAt: z.string().datetime(),
    source: z.literal('tastytrade'),
    isDemo: z.literal(false),
  })
  .strict();

export const importedTransactionSchema = z
  .object({
    id: z.string().min(1),
    providerTransactionId: z.string().min(1),
    symbol: z.string().nullable(),
    instrumentType: z.string().nullable(),
    action: z.string().nullable(),
    quantity: z.string().nullable(),
    price: z.string().nullable(),
    executedAt: z.string().nullable(),
    grossValue: z.string().nullable(),
    valueEffect: z.string().nullable(),
    commission: z.string().nullable(),
    feesJson: z.string().min(1),
    transactionType: z.string().nullable(),
    transactionSubtype: z.string().nullable(),
    classification: z.enum(['trade', 'expiration', 'assignment', 'exercise', 'transfer', 'unsupported']),
    source: z.literal('tastytrade'),
    isDemo: z.literal(false),
  })
  .strict();

export const quoteSnapshotSchema = z
  .object({
    symbol: z.string().min(1),
    instrumentType: z.string().min(1),
    bid: z.string().nullable(),
    ask: z.string().nullable(),
    mid: z.string().nullable(),
    mark: z.string().nullable(),
    lastPrice: z.string().nullable(),
    asOf: z.string().datetime().nullable(),
    fetchedAt: z.string().datetime(),
    freshness: quoteFreshnessSchema,
    entitlement: z.enum(['unknown', 'entitled', 'denied']),
    source: z.literal('tastytrade'),
    message: z.string().min(1),
  })
  .strict();

export const settingsSchema = z
  .object({
    demo: z.literal(true),
    density: z.enum(['comfortable', 'compact']),
    showGreeks: z.boolean(),
    dataMode: z.literal('demo'),
    authMode: z.literal('local-owner'),
    portfolioView: z.enum(['demo', 'brokerage']),
    /** Process env FINDER_LIVE_SCAN — installation-level permission; not toggled in-app. */
    finderLiveScanInstallAllowed: z.boolean(),
    /** Owner SQLite preference. Effective live search requires installAllowed AND this flag. */
    finderOnDemandSearchEnabled: z.boolean(),
    /** Owner preference: diagnostic allowlist vs normal multi-ticker Smart Scan. */
    smartScanMode: z.enum(['diagnostic', 'normal']),
    /** Process env SMART_SCAN_LIVE — installation-level permission; not toggled in-app. */
    smartScanLiveInstallAllowed: z.boolean(),
    ordersEnabled: z.literal(false),
    telemetryEnabled: z.literal(false),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const settingsUpdateSchema = z
  .object({
    density: z.enum(['comfortable', 'compact']).optional(),
    showGreeks: z.boolean().optional(),
    portfolioView: z.enum(['demo', 'brokerage']).optional(),
    finderOnDemandSearchEnabled: z.boolean().optional(),
    smartScanMode: z.enum(['diagnostic', 'normal']).optional(),
  })
  .strict();

export const healthSchema = z
  .object({
    status: z.literal('ok'),
    service: z.literal('optionscout'),
    phase: z.literal('1C'),
    dataMode: z.literal('demo'),
    demo: z.literal(true),
    database: z.literal('ok'),
    bootCount: z.number().int().positive(),
    ordersEnabled: z.literal(false),
    telemetryEnabled: z.literal(false),
    liveEnabled: z.boolean(),
    scheduledSyncEnabled: z.literal(false),
    ownerConfigured: z.boolean(),
  })
  .strict();

const moneyText = z.string().regex(/^-?\d+\.\d{2}$/);

export const portfolioCycleSchema = z
  .object({
    openingTransactionId: z.string().min(1),
    symbol: z.string().min(1),
    side: z.enum(['long', 'short']),
    openedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
    originalQuantity: z.string().min(1),
    openQuantity: z.string().min(1),
    openingCash: moneyText,
    closingCash: moneyText,
    openingFees: moneyText,
    fees: moneyText,
    feesComplete: z.boolean(),
    realized: moneyText.nullable(),
    status: z.enum(['open', 'closed', 'unreconciled']),
    notes: z.array(z.string()),
  })
  .strict();

export const portfolioPositionSchema = z
  .object({
    id: z.string().min(1),
    symbol: z.string().min(1),
    underlying: z.string().min(1),
    optionRight: z.enum(['call', 'put']).nullable(),
    strike: z.string().nullable(),
    expiration: z.string().nullable(),
    daysRemaining: z.number().int().nullable(),
    multiplier: z.string().nullable(),
    direction: z.enum(['long', 'short', 'flat']),
    openQuantity: z.string().min(1),
    openedAt: z.string().datetime().nullable(),
    originalPremium: moneyText.nullable(),
    entryCost: moneyText.nullable(),
    remainingBasis: moneyText.nullable(),
    marketValue: moneyText.nullable(),
    realized: moneyText.nullable(),
    unrealized: moneyText.nullable(),
    bid: z.string().nullable(),
    ask: z.string().nullable(),
    mid: z.string().nullable(),
    mark: z.string().nullable(),
    quoteAsOf: z.string().datetime().nullable(),
    quoteFetchedAt: z.string().datetime().nullable(),
    quoteFreshness: quoteFreshnessSchema,
    entitlement: z.enum(['unknown', 'entitled', 'denied']),
    feesComplete: z.boolean(),
    status: z.enum(['complete', 'partial', 'unreconciled', 'missing-opening']),
    issues: z.array(z.string()),
    brokerAverageOpenPrice: z.string().nullable(),
    calculatedAverageOpenPrice: z.string().nullable(),
    averagePriceDifference: moneyText.nullable(),
    methodology: z.string().min(1),
    cycles: z.array(portfolioCycleSchema),
  })
  .strict();

export const valuationModeIdSchema = z.enum(['broker-mark', 'midpoint', 'conservative-liquidation']);

export const strategyValuationModeSchema = z
  .object({
    mode: valuationModeIdSchema,
    label: z.string().min(1),
    combinedUnrealized: moneyText.nullable(),
    available: z.boolean(),
  })
  .strict();

export const strategyPerformanceSchema = z
  .object({
    assumptions: z.array(z.string()),
    warnings: z.array(z.string()),
    complete: z.boolean(),
    longOriginalInvestment: moneyText.nullable(),
    longCurrentValue: moneyText.nullable(),
    longRealized: moneyText.nullable(),
    longUnrealized: moneyText.nullable(),
    shortCredits: moneyText.nullable(),
    shortCloseCost: moneyText.nullable(),
    shortFees: moneyText.nullable(),
    shortRealized: moneyText.nullable(),
    shortOpenLiability: moneyText.nullable(),
    initialNetDebit: moneyText.nullable(),
    remainingNetValue: moneyText.nullable(),
    realized: moneyText.nullable(),
    unrealized: moneyText.nullable(),
    combined: moneyText.nullable(),
    capitalAtRisk: moneyText.nullable(),
    capitalExplanation: z.string().min(1),
    valuationModes: z.array(strategyValuationModeSchema).default([]),
    valuationSourceNote: z.string().min(1).default('Open unrealized uses the brokerage REST mark unless another mode is selected.'),
    quoteAsOf: z.string().datetime().nullable().default(null),
    quoteFetchedAt: z.string().datetime().nullable().default(null),
    shortSymbols: z.array(z.string()).default([]),
    shortDaysToExpiration: z.number().int().nullable().default(null),
  })
  .strict();

export const realizedAuditLineSchema = z
  .object({
    id: z.string().min(1),
    underlying: z.string().min(1),
    symbol: z.string().min(1),
    side: z.enum(['long', 'short']),
    status: z.string().min(1),
    openedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
    originalQuantity: z.string().nullable().default(null),
    openQuantity: z.string().nullable().default(null),
    multiplier: z.string().nullable().default(null),
    openingCash: moneyText,
    closingCash: moneyText,
    fees: moneyText,
    realized: moneyText.nullable(),
    feesComplete: z.boolean(),
    includedInTotal: z.boolean(),
    note: z.string().min(1),
  })
  .strict();

export const realizedAuditSchema = z
  .object({
    totalIncluded: moneyText.nullable(),
    label: z.string().min(1),
    howCalculated: z
      .string()
      .min(1)
      .default(
        'Sum of reconstructed FIFO option-cycle realized figures marked included. Open short credits, deposits, withdrawals, balance adjustments, and unresolved assignment/transfer cycles are excluded. Incomplete fees qualify the total as partial accounting.',
      ),
    lines: z.array(realizedAuditLineSchema),
    excludedNotes: z.array(z.string()),
    grossShortOpeningCredits: moneyText.nullable(),
    closedShortRealized: moneyText.nullable(),
    closedLongRealized: moneyText.nullable().default(null),
    unknownFeeCount: z.number().int().nonnegative(),
    includedCycleCount: z.number().int().nonnegative().default(0),
  })
  .strict();

export const portfolioSchema = z
  .object({
    phase: z.literal('1C'),
    demo: z.literal(false),
    asOf: z.string().datetime(),
    disclaimer: z.string().min(1),
    history: z
      .object({
        status: historyStatusSchema,
        coverageStart: isoDateSchema.nullable(),
        coverageEnd: isoDateSchema.nullable(),
        accountingComplete: z.boolean(),
      })
      .strict(),
    health: z
      .object({
        reconstructed: z.number().int().nonnegative(),
        openPositions: z.number().int().nonnegative(),
        missingOpenings: z.number().int().nonnegative(),
        unreconciled: z.number().int().nonnegative(),
        unknownFees: z.number().int().nonnegative(),
        quotesAvailable: z.number().int().nonnegative(),
        quotesUnavailable: z.number().int().nonnegative(),
        lastSyncAt: z.string().datetime().nullable(),
        lastQuoteAt: z.string().datetime().nullable(),
        confirmedGroups: z.number().int().nonnegative(),
        unconfirmedSuggestions: z.number().int().nonnegative(),
        excludedCashEvents: z.number().int().nonnegative(),
      })
      .strict(),
    positions: z.array(portfolioPositionSchema),
    realizedAudit: realizedAuditSchema,
    suggestions: z.array(
      z
        .object({
          underlying: z.string().min(1),
          longSymbol: z.string().min(1),
          shortSymbol: z.string().min(1),
          ambiguous: z.boolean(),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    strategies: z.array(
      z
        .object({
          id: z.string().min(1),
          underlying: z.string().min(1),
          longSymbol: z.string().min(1),
          createdAt: z.string().datetime(),
          performance: strategyPerformanceSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const strategyConfirmSchema = z
  .object({
    underlying: z.string().min(1),
    longSymbol: z.string().min(1),
    shortCycles: z
      .array(
        z
          .object({
            providerSymbol: z.string().min(1),
            openingTransactionId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type LegView = z.infer<typeof legViewSchema>;
export type PositionView = z.infer<typeof positionViewSchema>;
export type TransactionView = z.infer<typeof transactionViewSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type BrokerOverview = z.infer<typeof brokerOverviewSchema>;
export type SettingsView = z.infer<typeof settingsSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type HealthResponse = z.infer<typeof healthSchema>;
export type SessionView = z.infer<typeof sessionViewSchema>;
export type ImportedPosition = z.infer<typeof importedPositionSchema>;
export type ImportedTransaction = z.infer<typeof importedTransactionSchema>;
export type QuoteSnapshotView = z.infer<typeof quoteSnapshotSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type AlertView = z.infer<typeof alertViewSchema>;
export type JournalEntryView = z.infer<typeof journalEntrySchema>;
export type ResearchCandidateView = z.infer<typeof researchCandidateSchema>;
export type WatchlistItemView = z.infer<typeof watchlistItemSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type PortfolioPosition = z.infer<typeof portfolioPositionSchema>;
export type StrategyConfirm = z.infer<typeof strategyConfirmSchema>;

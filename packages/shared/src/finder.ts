import { z } from 'zod';
import { DISCOVERY_METRICS, discoveryToleranceSchema } from './discovery.js';
import { SCAN_MORE_PRIORITIES } from './finder-filters.js';
import { MARKET_DATA_VALIDATION_CODES } from './market-data-validation.js';

const moneyText = z.string().regex(/^-?\d+\.\d{2}$/);
const decimalText = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
const percentText = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

export const FINDER_SCREENING_FRESHNESS_SECONDS_DEFAULT = 60;
export const FINDER_BATCH_SIZE = 8;
export const FINDER_DEFAULT_EVALUATION_BUDGET = 24;
export const FINDER_MAX_EVALUATION_BUDGET = 48;

export const finderScanRequestSchema = z
  .object({
    underlying: z
      .string()
      .trim()
      .min(1)
      .max(12)
      .regex(/^[A-Za-z][A-Za-z.]*$/),
    profileId: z.string().min(1).max(64),
    evaluationBudget: z.number().int().min(1).max(FINDER_MAX_EVALUATION_BUDGET).default(FINDER_DEFAULT_EVALUATION_BUDGET),
    screeningFreshnessSeconds: z.number().int().min(5).max(120).default(FINDER_SCREENING_FRESHNESS_SECONDS_DEFAULT),
    tolerances: discoveryToleranceSchema.optional(),
    scanPriority: z.enum(SCAN_MORE_PRIORITIES).default('closest-to-strategy'),
  })
  .strict();

export type FinderScanRequest = z.infer<typeof finderScanRequestSchema>;

export const finderQuoteFlagsSchema = z
  .object({
    crossedMarket: z.boolean(),
    missingBid: z.boolean(),
    missingAsk: z.boolean(),
    invalidPrice: z.boolean(),
    staleInputs: z.boolean(),
    missingProviderTimestamp: z.boolean(),
    quoteGreekMismatch: z.boolean(),
    missingGreeks: z.boolean(),
    /** Greeks present for research but not aligned with the option quote for classification. Null means a legacy snapshot did not record the flag. */
    unverifiedGreeks: z.boolean().nullable(),
    afterHoursSnapshot: z.boolean(),
    /** Null means a legacy snapshot did not record whether the quote came from cache. */
    fromCache: z.boolean().nullable(),
    actionable: z.boolean(),
  })
  .strict();

export const finderCalculationsSchema = z
  .object({
    intrinsicValue: moneyText.nullable(),
    estimatedPurchaseCost: moneyText.nullable(),
    extrinsicValue: moneyText.nullable(),
    intrinsicPercent: percentText.nullable(),
    bidAskSpreadDollars: moneyText.nullable(),
    bidAskSpreadPercent: percentText.nullable(),
    expirationBreakEven: moneyText.nullable(),
    daysToExpiration: z.number().int().nullable(),
    strikeDistance: moneyText.nullable(),
    downsideMoneyness15: percentText.nullable(),
    downsideMoneyness20: percentText.nullable(),
    downsideMoneyness30: percentText.nullable(),
    deltaCapitalExposure: decimalText.nullable(),
    midpoint: moneyText.nullable(),
    quoteSourceLabel: z.string().min(1),
  })
  .strict();

export const finderCandidateSchema = z
  .object({
    id: z.string().min(1),
    underlying: z.string().min(1),
    occSymbol: z.string().min(1),
    streamerSymbol: z.string().nullable(),
    optionType: z.enum(['call', 'put']),
    strike: moneyText,
    expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    multiplier: z.number().int().positive(),
    chainType: z.string().min(1),
    standardContract: z.boolean(),
    supportStatus: z.enum(['supported', 'unsupported-adjusted', 'missing-streamer']),
    supportNote: z.string().min(1),
    active: z.boolean().nullable(),
    closingOnly: z.boolean().nullable(),
    underlyingPrice: moneyText.nullable(),
    bid: moneyText.nullable(),
    ask: moneyText.nullable(),
    mark: moneyText.nullable(),
    delta: decimalText.nullable(),
    theta: decimalText.nullable(),
    gamma: decimalText.nullable(),
    vega: decimalText.nullable(),
    impliedVolatility: decimalText.nullable(),
    volume: z.number().int().nullable(),
    openInterest: z.number().int().nullable(),
    providerEventAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
    marketSession: z.enum(['regular', 'closed']),
    dataQuality: z.enum(['usable', 'stale', 'missing', 'inconsistent', 'invalid']),
    flags: finderQuoteFlagsSchema,
    calculations: finderCalculationsSchema,
    outcome: z.enum(['exact', 'near', 'outside-profile', 'incomplete']),
    label: z.string().min(1),
    visible: z.literal(true),
    usableForComparison: z.boolean(),
    withinExploration: z.boolean(),
    reasons: z.array(
      z
        .object({
          metric: z.string(),
          kind: z.enum(['hard', 'preference', 'unconfigured', 'exploration', 'data']),
          passed: z.boolean(),
          target: z.string().nullable(),
          actual: z.string().nullable(),
          difference: z.string().nullable(),
          text: z.string(),
        })
        .strict(),
    ),
    metrics: z.record(z.enum(DISCOVERY_METRICS), z.number().nullable()),
    pmccReason: z.string().nullable(),
    /** True when hard/preference numeric rules pass and only unconfigured liquidity blocks Exact Match. */
    meetsConfiguredNumericRequirements: z.boolean(),
    liquidityUnassessed: z.boolean(),
    /** Age class of the quote observation used for this row. */
    observationFreshness: z.enum(['current-session', 'previous-session', 'older', 'unavailable']),
    /** Whether delta may satisfy hard/preferred delta checks. */
    greekVerification: z.enum(['aligned', 'historical-unverified', 'unavailable']),
    greekProviderEventAt: z.string().nullable(),
    /** Machine-readable validation issues (rejects / warnings / info). */
    validationIssues: z
      .array(
        z
          .object({
            code: z.enum(MARKET_DATA_VALIDATION_CODES),
            severity: z.enum(['reject', 'warning', 'info']),
            message: z.string().min(1),
            details: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type FinderCandidate = z.infer<typeof finderCandidateSchema>;

export const finderValidationCountersSchema = z
  .object({
    attempted: z.number().int().nonnegative(),
    withPrices: z.number().int().nonnegative(),
    withGreeks: z.number().int().nonnegative(),
    validatedOk: z.number().int().nonnegative(),
    strategyAssessed: z.number().int().nonnegative(),
    meetHardNumerical: z.number().int().nonnegative(),
    unevaluated: z.number().int().nonnegative(),
    rejectionBreakdown: z.record(z.number().int().nonnegative()),
  })
  .strict();

export type FinderValidationCounters = z.infer<typeof finderValidationCountersSchema>;

export const finderPlainProgressSchema = z
  .object({
    headline: z.string().min(1),
    eligibleMeaning: z.string().min(1),
    batchStatus: z.enum(['batch-finished', 'universe-examined', 'running', 'cancelled', 'failed']),
    eligibleLongDatedCalls: z.number().int().nonnegative(),
    uniqueContractsAttempted: z.number().int().nonnegative(),
    fullyEvaluated: z.number().int().nonnegative(),
    partiallyEvaluated: z.number().int().nonnegative(),
    notYetEvaluated: z.number().int().nonnegative(),
    withinHardBudget: z.number().int().nonnegative(),
    meetsAssessableNumericRequirements: z.number().int().nonnegative(),
    incompleteMissingData: z.number().int().nonnegative(),
    expirationCoverage: z.string().min(1),
    moneynessCoverage: z.string().min(1),
    snapshotSource: z.string().min(1),
    snapshotAt: z.string().nullable(),
    nextStepHint: z.string().min(1),
    validationCounters: finderValidationCountersSchema.optional(),
  })
  .strict();

export type FinderPlainProgress = z.infer<typeof finderPlainProgressSchema>;

export const finderScanProgressSchema = z
  .object({
    discovered: z.number().int().nonnegative(),
    standardCalls: z.number().int().nonnegative(),
    putsDiscovered: z.number().int().nonnegative(),
    unsupportedAdjusted: z.number().int().nonnegative(),
    missingStreamer: z.number().int().nonnegative(),
    eligibleLeaps: z.number().int().nonnegative(),
    evaluationBudget: z.number().int().positive(),
    selectedForEvaluation: z.number().int().nonnegative(),
    evaluated: z.number().int().nonnegative(),
    fullyEvaluated: z.number().int().nonnegative(),
    partiallyEvaluated: z.number().int().nonnegative(),
    notYetEvaluated: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    awaitingData: z.number().int().nonnegative(),
    unavailableData: z.number().int().nonnegative(),
    missingProviderGreeks: z.number().int().nonnegative(),
    missingValidQuotes: z.number().int().nonnegative(),
    withinHardBudget: z.number().int().nonnegative(),
    meetsAssessableNumericRequirements: z.number().int().nonnegative(),
    incompleteMissingData: z.number().int().nonnegative(),
    expirationsEligible: z.number().int().nonnegative(),
    expirationsRepresented: z.number().int().nonnegative(),
    estimatedRequestBudgetUsed: z.number().int().nonnegative(),
    canRetryMissingData: z.boolean(),
    lastScanPriority: z.enum(SCAN_MORE_PRIORITIES).nullable(),
    partial: z.boolean(),
    cancelled: z.boolean(),
    exhausted: z.boolean(),
    canScanMore: z.boolean(),
    batchSize: z.number().int().positive(),
    coverageSummary: z.string().min(1),
    selectionAlgorithm: z.string().min(1),
    plain: finderPlainProgressSchema,
    rejectionBreakdown: z.record(z.number().int().nonnegative()).optional(),
  })
  .strict();

export const finderCoverageNoteSchema = z
  .object({
    code: z.enum([
      'has-in-budget',
      'none-in-budget-among-evaluated',
      'insufficient-evaluation',
      'quotes-unavailable',
      'constraints-restrictive',
      'liquidity-unassessed-only',
      'budget-delta-conflict',
      'missing-greeks-common',
      'adaptive-refinement-applied',
      'retry-missing-data',
      'scan-priority-applied',
    ]),
    text: z.string().min(1),
  })
  .strict();

export const finderMarketContextSchema = z
  .object({
    underlyingPrice: z.string().nullable(),
    underlyingQuoteAt: z.string().nullable(),
    marketSession: z.enum(['regular', 'closed']).nullable(),
    dataSource: z.string().min(1),
    simulated: z.boolean(),
    simulatedNotice: z.string().nullable(),
    quoteSkewWarning: z.string().nullable(),
  })
  .strict();

export type FinderMarketContext = z.infer<typeof finderMarketContextSchema>;

export const finderScanResultSchema = z
  .object({
    scanId: z.string().min(1),
    status: z.enum(['running', 'completed', 'cancelled', 'failed', 'interrupted']),
    mode: z.enum(['demo-fixture', 'live-gated']),
    underlying: z.string().min(1),
    profileId: z.string().min(1),
    profileName: z.string().min(1),
    profileRevision: z.number().int().positive(),
    scanPriority: z.enum(SCAN_MORE_PRIORITIES),
    startedAt: z.string().min(1),
    finishedAt: z.string().nullable(),
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    screeningFreshnessSeconds: z.number().int().positive(),
    sessionPersistence: z.enum(['in-memory', 'sqlite']).optional(),
    message: z.string().min(1),
    progress: finderScanProgressSchema,
    coverageNotes: z.array(finderCoverageNoteSchema),
    marketContext: finderMarketContextSchema,
    tolerances: discoveryToleranceSchema,
    candidates: z.array(finderCandidateSchema),
    error: z.string().nullable(),
  })
  .strict();

export const finderScanMoreRequestSchema = z
  .object({
    count: z.number().int().min(1).max(FINDER_MAX_EVALUATION_BUDGET).default(FINDER_DEFAULT_EVALUATION_BUDGET),
    /** Same priority vocabulary as Start Search. Reorders remaining unevaluated contracts only. */
    priority: z.enum(SCAN_MORE_PRIORITIES).optional(),
  })
  .strict();

export const finderRetryMissingRequestSchema = z
  .object({
    count: z.number().int().min(1).max(FINDER_MAX_EVALUATION_BUDGET).default(FINDER_BATCH_SIZE),
  })
  .strict();

export type FinderScanResult = z.infer<typeof finderScanResultSchema>;

export const finderBookmarkSchema = z
  .object({
    id: z.string().min(1),
    underlying: z.string().min(1),
    occSymbol: z.string().min(1),
    streamerSymbol: z.string().nullable(),
    savedAt: z.string().min(1),
    profileId: z.string().nullable(),
    profileRevision: z.number().int().positive().nullable(),
    scanId: z.string().nullable(),
    quoteAsOf: z.string().nullable(),
    snapshot: finderCandidateSchema,
  })
  .strict();

export type FinderBookmark = z.infer<typeof finderBookmarkSchema>;

/** A saved candidate that loaded, but only after missing metadata was marked unavailable. Or a row left out of the list. */
export const finderBookmarkWarningSchema = z
  .object({
    id: z.string().min(1).nullable(),
    underlying: z.string().nullable(),
    occSymbol: z.string().nullable(),
    savedAt: z.string().nullable(),
    code: z.enum(['legacy-reconstructed', 'unreadable']),
    message: z.string().min(1),
    missingFields: z.array(z.string()),
  })
  .strict();

export type FinderBookmarkWarning = z.infer<typeof finderBookmarkWarningSchema>;

export const finderBookmarksResponseSchema = z
  .object({
    bookmarks: z.array(finderBookmarkSchema),
    warnings: z.array(finderBookmarkWarningSchema),
  })
  .strict();

export type FinderBookmarksResponse = z.infer<typeof finderBookmarksResponseSchema>;

export const finderBookmarkCreateSchema = z
  .object({
    candidate: finderCandidateSchema,
    profileId: z.string().min(1).optional(),
    profileRevision: z.number().int().positive().optional(),
    scanId: z.string().min(1).optional(),
  })
  .strict();

export const FINDER_METRIC_TOOLTIPS: Record<(typeof DISCOVERY_METRICS)[number], string> = {
  purchaseCost: 'Estimated capital to buy one contract at the ask (ask × multiplier). Midpoint fills are not assumed.',
  delta: 'How much the option price tends to move when the stock moves $1. Higher delta tracks the stock more closely but usually costs more.',
  intrinsicPercent: 'Share of the premium that is already real value (stock above strike). The rest is time/volatility premium.',
  extrinsicValue: 'Premium above intrinsic value. This portion can decay even if the stock does not move.',
  bidAskSpread: 'Gap between bid and ask as a percent of midpoint. A tighter spread usually means cheaper to enter and exit.',
  liquidity: 'Open interest with volume as a tie-break when both are available. Unconfigured profile thresholds stay unset.',
  dte: 'Calendar days until expiration. Longer dates cost more time premium but give more room for the thesis.',
  theta: 'Approximate daily time decay of the option premium. Lower magnitude relative to capital is usually preferred for long LEAPS.',
  downsideMoneyness: 'How far the strike sits relative to the stock after a documented decline. Staying ITM does not guarantee a small investment loss.',
  pmccCompatibility: 'Whether a supplied short call shares the underlying, expires sooner, and matches quantity/multiplier. Not a profit estimate.',
};

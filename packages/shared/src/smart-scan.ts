/**
 * Phase 1D.2a Smart Scan (Discover Opportunities) — shared schemas and helpers.
 * Multi-ticker orchestration types only; evaluation math stays in discovery/finder.
 */

import { z } from 'zod';
import { discoveryToleranceSchema, SHOW_PROFILE_MISSES } from './discovery.js';
import { SCAN_MORE_PRIORITIES } from './finder-filters.js';
import { finderCandidateSchema, FINDER_DEFAULT_EVALUATION_BUDGET, FINDER_MAX_EVALUATION_BUDGET } from './finder.js';

export const SMART_SCAN_MAX_TICKERS = 12;
/** Companies a person may check before one Find Matching LEAPS authorization. Each operation still caps at 12. */
export const BEGINNER_SELECTION_LIMIT = 20;
export const SMART_SCAN_DEFAULT_BUDGET = FINDER_DEFAULT_EVALUATION_BUDGET;
export const SMART_SCAN_MAX_BUDGET = FINDER_MAX_EVALUATION_BUDGET;

/** Mirrors server live-diagnostic allowlist (read-only policy for clients). */
export const SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST = ['CVX', 'QCOM', 'WMT'] as const;
export const SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS = 3;
export const SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET = 24;

export const smartScanModeSchema = z.enum(['diagnostic', 'normal']);
export type SmartScanMode = z.infer<typeof smartScanModeSchema>;

export const smartScanPolicySchema = z
  .object({
    /** True when SMART_SCAN_LIVE install gate is on — browser cannot override. */
    enabled: z.boolean(),
    mode: smartScanModeSchema,
    /** Diagnostic allowlist; empty in normal mode. */
    allowlist: z.array(z.string().min(1)).default([]),
    maxBudget: z.number().int().positive(),
    maxTickers: z.number().int().positive(),
    /** Effective live Smart Scan would use brokerage (not simulated fixtures). */
    liveModeActive: z.boolean(),
    /** Total session evaluation cap for Scan More; null in normal (no permanent 24-total hard cap). */
    scanMoreSessionCap: z.number().int().positive().nullable(),
    /** Short label for Discover / Settings UI. */
    statusLabel: z.string().min(1),
  })
  .strict();

export type SmartScanPolicy = z.infer<typeof smartScanPolicySchema>;

/** Build client-facing Smart Scan policy from install gate + owner mode preference. */
export function buildSmartScanPolicy(input: {
  smartScanLive: boolean;
  mode: SmartScanMode;
  liveScanEnabled: boolean;
  portfolioView: 'demo' | 'brokerage';
}): SmartScanPolicy {
  const liveModeActive =
    input.smartScanLive && input.liveScanEnabled && input.portfolioView === 'brokerage';
  if (input.mode === 'diagnostic') {
    return smartScanPolicySchema.parse({
      enabled: input.smartScanLive,
      mode: 'diagnostic',
      allowlist: [...SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST],
      maxBudget: SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET,
      maxTickers: SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS,
      liveModeActive,
      scanMoreSessionCap: SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET,
      statusLabel: 'Diagnostic Mode',
    });
  }
  return smartScanPolicySchema.parse({
    enabled: input.smartScanLive,
    mode: 'normal',
    allowlist: [],
    maxBudget: SMART_SCAN_DEFAULT_BUDGET,
    maxTickers: SMART_SCAN_MAX_TICKERS,
    liveModeActive,
    scanMoreSessionCap: null,
    statusLabel: input.smartScanLive ? 'Smart Scan Ready' : 'Normal Mode (simulated)',
  });
}

export const discoveryUniverseSourceKindSchema = z.enum([
  'curated-starter',
  'custom',
  'csv-import',
  'bookmark-derived',
  'manual-paste',
]);

export type DiscoveryUniverseSourceKind = z.infer<typeof discoveryUniverseSourceKindSchema>;

export const discoveryUniverseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    sourceKind: discoveryUniverseSourceKindSchema,
    sourceLabel: z.string().min(1),
    retrievedAt: z.string().min(1),
    tickers: z.array(z.string().min(1).max(12)).min(1),
    companyNames: z.record(z.string()).default({}),
    /** Sector labels from the imported file, when that column existed. */
    sectors: z.record(z.string()).default({}),
    /** Provider holdings weights as text, exactly as imported. Not a performance score. */
    weights: z.record(z.string()).default({}),
    /** How the weight column was read. Older versions stay unspecified and are not reinterpreted. */
    weightReading: z
      .enum(['percent-sign', 'percentage-points', 'decimal-fraction', 'ambiguous', 'missing', 'unspecified'])
      .default('unspecified'),
    /** Interpreted percent of the fund, such as "7.1" for 7.1%. Empty when the scale was not known. */
    weightPercents: z.record(z.string()).default({}),
    editable: z.boolean(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    currentVersion: z
      .object({
        id: z.string().min(1),
        version: z.number().int().positive(),
        universeType: z.string().min(1),
        provider: z.string().min(1),
        sourceLabel: z.string().min(1),
        fundTicker: z.string().nullable(),
        holdingsEffectiveDate: z.string().nullable(),
        importedAt: z.string().min(1),
        rowCount: z.number().int().nonnegative(),
        supportedEquityCount: z.number().int().nonnegative(),
        unsupportedCount: z.number().int().nonnegative(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type DiscoveryUniverse = z.infer<typeof discoveryUniverseSchema>;
export type DiscoveryUniverseVersionInfo = NonNullable<DiscoveryUniverse['currentVersion']>;

export const discoveryUniverseCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    tickers: z.array(z.string()).min(1),
    sourceKind: z.enum(['custom', 'csv-import', 'manual-paste']).default('custom'),
    sourceLabel: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const smartScanTickerStatusSchema = z.enum([
  'pending',
  'chain-loaded',
  'unsupported',
  'empty',
  'error',
  'rate-limited',
  'evaluated',
  'interrupted',
]);

export type SmartScanTickerStatus = z.infer<typeof smartScanTickerStatusSchema>;

/** Company outcomes that must stay explicitly retryable instead of counting as processed. */
export const SMART_SCAN_RETRYABLE_TICKER_STATUSES: readonly SmartScanTickerStatus[] = ['error', 'rate-limited', 'interrupted'];

export function isRetryableTickerStatus(status: SmartScanTickerStatus): boolean {
  return SMART_SCAN_RETRYABLE_TICKER_STATUSES.includes(status);
}

export const smartScanTickerProgressSchema = z
  .object({
    ticker: z.string().min(1),
    companyName: z.string().nullable(),
    status: smartScanTickerStatusSchema,
    message: z.string().min(1),
    underlyingPrice: z.string().nullable(),
    underlyingQuoteAt: z.string().nullable(),
    eligibleContracts: z.number().int().nonnegative(),
    evaluatedContracts: z.number().int().nonnegative(),
    incompleteContracts: z.number().int().nonnegative(),
    exactMatches: z.number().int().nonnegative(),
    nearMatches: z.number().int().nonnegative(),
    attemptCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export type SmartScanTickerProgress = z.infer<typeof smartScanTickerProgressSchema>;

export const smartScanProgressSchema = z
  .object({
    companiesSelected: z.number().int().nonnegative(),
    companiesChainRetrieved: z.number().int().nonnegative(),
    companiesWithEvaluatedContracts: z.number().int().nonnegative(),
    companiesNotYetScanned: z.number().int().nonnegative(),
    companiesUnsupportedOrEmpty: z.number().int().nonnegative(),
    companiesRateLimitedOrError: z.number().int().nonnegative(),
    eligibleContractsDiscovered: z.number().int().nonnegative(),
    contractsFullyEvaluated: z.number().int().nonnegative(),
    contractsPartiallyEvaluated: z.number().int().nonnegative(),
    contractsNotYetEvaluated: z.number().int().nonnegative(),
    missingQuotesOrGreeks: z.number().int().nonnegative(),
    evaluationBudget: z.number().int().positive(),
    evaluationBudgetUsed: z.number().int().nonnegative(),
    batchSize: z.number().int().positive(),
    canScanMore: z.boolean(),
    cancelled: z.boolean(),
    plainSummary: z.string().min(1),
    coverageNote: z.string().min(1),
    attempted: z.number().int().nonnegative().optional(),
    withPrices: z.number().int().nonnegative().optional(),
    withGreeks: z.number().int().nonnegative().optional(),
    validatedOk: z.number().int().nonnegative().optional(),
    strategyAssessed: z.number().int().nonnegative().optional(),
    meetHardNumerical: z.number().int().nonnegative().optional(),
    rejectionBreakdown: z.record(z.number().int().nonnegative()).optional(),
  })
  .strict();

export type SmartScanProgress = z.infer<typeof smartScanProgressSchema>;

export const smartScanInsightSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const smartScanRequestSchema = z
  .object({
    /**
     * Companies for the first operation (≤12). With a universe, these run first and the rest of the
     * pinned universe version follows in its stored order. Without tickers, the first 12 are used.
     */
    tickers: z.array(z.string().trim().min(1).max(12)).max(SMART_SCAN_MAX_TICKERS).default([]),
    profileId: z.string().min(1).max(64),
    universeId: z.string().min(1).nullable().optional(),
    /** Immutable version to pin. The server resolves membership; browsers never send the full queue. */
    universeVersionId: z.string().min(1).nullable().optional(),
    universeLabel: z.string().min(1).max(240).optional(),
    evaluationBudget: z
      .number()
      .int()
      .min(1)
      .max(SMART_SCAN_MAX_BUDGET)
      .default(SMART_SCAN_DEFAULT_BUDGET),
    scanPriority: z.enum(SCAN_MORE_PRIORITIES).default('closest-to-strategy'),
    tolerances: discoveryToleranceSchema.optional(),
    companyNames: z.record(z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.tickers.length === 0 && !value.universeId && !value.universeVersionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a stock collection or at least one ticker.',
        path: ['tickers'],
      });
    }
  });

export const smartScanRetryCompaniesRequestSchema = z
  .object({
    /** Defaults to every retryable company in the session, capped at 12 per operation. */
    tickers: z.array(z.string().trim().min(1).max(12)).max(SMART_SCAN_MAX_TICKERS).optional(),
    evaluationBudget: z
      .number()
      .int()
      .min(1)
      .max(SMART_SCAN_MAX_BUDGET)
      .default(SMART_SCAN_DEFAULT_BUDGET),
  })
  .strict();

export type SmartScanRetryCompaniesRequest = z.infer<typeof smartScanRetryCompaniesRequestSchema>;

export const smartScanNextCompaniesRequestSchema = z
  .object({
    count: z.number().int().min(1).max(SMART_SCAN_MAX_TICKERS).default(SMART_SCAN_MAX_TICKERS),
    evaluationBudget: z
      .number()
      .int()
      .min(1)
      .max(SMART_SCAN_MAX_BUDGET)
      .default(SMART_SCAN_DEFAULT_BUDGET),
    priority: z.enum(SCAN_MORE_PRIORITIES).optional(),
  })
  .strict();

export type SmartScanNextCompaniesRequest = z.infer<typeof smartScanNextCompaniesRequestSchema>;

export type SmartScanRequest = z.infer<typeof smartScanRequestSchema>;

export const smartScanMoreRequestSchema = z
  .object({
    count: z.number().int().min(1).max(SMART_SCAN_MAX_BUDGET).default(SMART_SCAN_DEFAULT_BUDGET),
    priority: z.enum(SCAN_MORE_PRIORITIES).optional(),
    /** Continue diversified across the universe, or focus remaining queue for one ticker. */
    mode: z.enum(['diversified', 'focus-ticker']).default('diversified'),
    focusTicker: z.string().trim().min(1).max(12).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'focus-ticker' && !value.focusTicker?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'focusTicker is required when mode is focus-ticker.',
        path: ['focusTicker'],
      });
    }
  });

export type SmartScanMoreRequest = z.infer<typeof smartScanMoreRequestSchema>;

export const smartScanResultSchema = z
  .object({
    scanId: z.string().min(1),
    status: z.enum(['running', 'completed', 'cancelled', 'failed', 'interrupted']),
    mode: z.enum(['simulated-fixture', 'live-gated']),
    profileId: z.string().min(1),
    profileName: z.string().min(1),
    profileRevision: z.number().int().positive(),
    scanPriority: z.enum(SCAN_MORE_PRIORITIES),
    universeId: z.string().nullable(),
    universeVersionId: z.string().nullable().optional(),
    universeLabel: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().nullable(),
    updatedAt: z.string().min(1),
    sessionPersistence: z.enum(['in-memory', 'sqlite']),
    sessionNotice: z.string().min(1),
    canScanNextCompanies: z.boolean().optional(),
    companyCursor: z.number().int().nonnegative().optional(),
    companiesInUniverseQueue: z.number().int().nonnegative().optional(),
    /** Companies whose last attempt failed, was rate-limited, or was interrupted. */
    companiesRetryable: z.number().int().nonnegative().optional(),
    activeBatchId: z.string().nullable().optional(),
    /** Set when research progress could not be written to SQLite. */
    persistenceError: z.string().nullable().optional(),
    message: z.string().min(1),
    simulated: z.boolean(),
    simulatedNotice: z.string().nullable(),
    dataSource: z.string().min(1),
    progress: smartScanProgressSchema,
    tickers: z.array(smartScanTickerProgressSchema),
    insights: z.array(smartScanInsightSchema),
    candidates: z.array(finderCandidateSchema),
    tolerances: discoveryToleranceSchema,
    error: z.string().nullable(),
  })
  .strict();

export type SmartScanResult = z.infer<typeof smartScanResultSchema>;

export function normalizeSmartTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

const TICKER_PATTERN = /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/;

export type TickerValidation =
  | { ok: true; ticker: string; normalizedFrom: string | null }
  | { ok: false; ticker: null; reason: string };

/**
 * Validate one equity symbol without rewriting it. The only normalization is the share-class
 * separator (BRK-B, BRK/B, BRK B → BRK.B), which is reported through `normalizedFrom`.
 */
export function validateTickerSymbol(raw: string): TickerValidation {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return { ok: false, ticker: null, reason: 'Missing ticker.' };
  const classMatch = /^([A-Z]{1,6})[-/ ]([A-Z]{1,2})$/.exec(trimmed);
  const candidate = classMatch ? `${classMatch[1]}.${classMatch[2]}` : trimmed;
  if (!TICKER_PATTERN.test(candidate)) {
    return { ok: false, ticker: null, reason: `Invalid ticker format: ${raw.trim()}` };
  }
  return { ok: true, ticker: candidate, normalizedFrom: candidate === trimmed ? null : trimmed };
}

/** Deduplicate and validate ticker shapes for universe / scan selection. Malformed symbols are rejected, not repaired. */
export function normalizeTickerList(tickers: readonly string[]): { tickers: string[]; rejected: string[] } {
  const seen = new Set<string>();
  const out: string[] = [];
  const rejected: string[] = [];
  for (const raw of tickers) {
    const checked = validateTickerSymbol(raw);
    if (!checked.ok) {
      if (raw.trim()) rejected.push(raw.trim());
      continue;
    }
    if (seen.has(checked.ticker)) continue;
    seen.add(checked.ticker);
    out.push(checked.ticker);
  }
  return { tickers: out, rejected };
}

/** Parse a ticker list: one symbol per line, a comma-separated line, or a CSV with a Ticker or Symbol column. */
export function parseTickerCsv(text: string): { tickers: string[]; rejected: string[] } {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (rows.length === 0) return { tickers: [], rejected: [] };
  const headerCells = rows[0]!.split(/[,;\t]/).map((cell) => cell.trim());
  const headerIndex = headerCells.findIndex((cell) => /^(ticker|symbol)$/i.test(cell));
  const raw: string[] = [];
  if (headerIndex >= 0) {
    for (const line of rows.slice(1)) {
      const cell = line.split(/[,;\t]/).map((part) => part.trim())[headerIndex] ?? '';
      if (cell) raw.push(cell);
    }
    return normalizeTickerList(raw);
  }
  for (const line of rows) {
    const cells = line.split(/[,;\t]/).map((part) => part.trim()).filter((part) => part.length > 0);
    const valid = cells.filter((cell) => validateTickerSymbol(cell).ok);
    if (valid.length >= 2) {
      raw.push(...cells);
      continue;
    }
    if (cells[0]) raw.push(cells[0]);
  }
  return normalizeTickerList(raw);
}

export function buildSmartScanInsights(input: {
  tickers: readonly SmartScanTickerProgress[];
  candidates: readonly z.infer<typeof finderCandidateSchema>[];
  progress: SmartScanProgress;
}): Array<{ id: string; text: string }> {
  const insights: Array<{ id: string; text: string }> = [];
  const evaluatedTickers = input.tickers.filter((row) => row.evaluatedContracts > 0);
  if (evaluatedTickers.length === 0) return insights;

  const withBudgetOrDelta = new Set(
    input.candidates
      .filter((row) => row.outcome === 'exact' || row.outcome === 'near')
      .map((row) => row.underlying),
  );
  if (withBudgetOrDelta.size > 0) {
    insights.push({
      id: 'exact-near-companies',
      text: `${withBudgetOrDelta.size} ${withBudgetOrDelta.size === 1 ? 'company has' : 'companies have'} contracts that meet your currently assessable Exact or Near Match rules.`,
    });
  }

  const wideSpread = input.candidates.filter((row) => {
    const spread = row.calculations.bidAskSpreadPercent == null ? null : Number(row.calculations.bidAskSpreadPercent);
    const intrinsic = row.calculations.intrinsicPercent == null ? null : Number(row.calculations.intrinsicPercent);
    return spread != null && spread >= 5 && intrinsic != null && intrinsic >= 80;
  });
  if (wideSpread.length > 0) {
    const companies = new Set(wideSpread.map((row) => row.underlying));
    insights.push({
      id: 'wide-spread-intrinsic',
      text: `${companies.size} ${companies.size === 1 ? 'company has' : 'companies have'} contracts above a high intrinsic percentage but with relatively wide bid/ask spreads.`,
    });
  }

  const incompleteLiquidity = input.candidates.filter(
    (row) => (row.outcome === 'exact' || row.outcome === 'near') && (row.openInterest == null || row.liquidityUnassessed),
  );
  if (incompleteLiquidity.length > 0) {
    insights.push({
      id: 'incomplete-liquidity',
      text: 'Several numerical candidates have incomplete liquidity information (open interest or volume unassessed).',
    });
  }

  if (input.progress.contractsNotYetEvaluated > 0) {
    insights.push({
      id: 'remaining',
      text: `${input.progress.contractsNotYetEvaluated} eligible contracts remain unevaluated in this session. Use Scan More for more coverage — a finished batch is not a complete universe search.`,
    });
  }

  return insights;
}

export function buildSmartScanPlainSummary(progress: SmartScanProgress): string {
  const attempted = progress.attempted ?? progress.contractsFullyEvaluated + progress.contractsPartiallyEvaluated;
  const withPrices = progress.withPrices;
  const withGreeks = progress.withGreeks;
  const validatedOk = progress.validatedOk;
  const strategyAssessed = progress.strategyAssessed;
  const meetHard = progress.meetHardNumerical;
  const breakdown = progress.rejectionBreakdown ?? {};
  const rejectParts = Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => `${code}=${count}`);
  const counterBits = [
    `attempted ${attempted}`,
    withPrices != null ? `with prices ${withPrices}` : null,
    withGreeks != null ? `with Greeks ${withGreeks}` : null,
    validatedOk != null ? `validated OK ${validatedOk}` : null,
    rejectParts.length > 0 ? `rejected (${rejectParts.join(', ')})` : 'rejected 0',
    strategyAssessed != null ? `strategy-assessed ${strategyAssessed}` : null,
    meetHard != null ? `meet hard numerical ${meetHard}` : null,
    `unevaluated ${progress.contractsNotYetEvaluated}`,
  ]
    .filter(Boolean)
    .join('; ');
  return `We checked ${progress.companiesSelected} companies (${progress.evaluationBudgetUsed} of ${progress.evaluationBudget} evaluation slots used this operation). ${progress.companiesWithEvaluatedContracts} companies have at least one evaluated contract. Counts: ${counterBits}. This does not mean the entire market or universe was examined.`;
}

/** Aggregate validation / assessment counters from evaluated Finder candidates. */
export function buildCandidateValidationCounters(
  candidates: readonly {
    ask: string | null;
    delta: string | null;
    dataQuality: string;
    greekVerification: string;
    meetsConfiguredNumericRequirements: boolean;
    outcome: string;
    validationIssues?: readonly { code: string; severity: string }[];
  }[],
  unevaluated: number,
): {
  attempted: number;
  withPrices: number;
  withGreeks: number;
  validatedOk: number;
  strategyAssessed: number;
  meetHardNumerical: number;
  unevaluated: number;
  rejectionBreakdown: Record<string, number>;
} {
  const rejectionBreakdown: Record<string, number> = {};
  let withPrices = 0;
  let withGreeks = 0;
  let validatedOk = 0;
  let strategyAssessed = 0;
  let meetHardNumerical = 0;
  for (const row of candidates) {
    if (row.ask != null) withPrices += 1;
    if (row.delta != null) withGreeks += 1;
    const hasReject = (row.validationIssues ?? []).some((issue) => issue.severity === 'reject');
    if (!hasReject && row.dataQuality !== 'inconsistent' && row.dataQuality !== 'invalid' && row.dataQuality !== 'missing') {
      validatedOk += 1;
    }
    if (!hasReject && row.ask != null && row.dataQuality !== 'inconsistent' && row.dataQuality !== 'invalid') {
      strategyAssessed += 1;
    }
    if (row.meetsConfiguredNumericRequirements) meetHardNumerical += 1;
    for (const issue of row.validationIssues ?? []) {
      if (issue.severity !== 'reject') continue;
      rejectionBreakdown[issue.code] = (rejectionBreakdown[issue.code] ?? 0) + 1;
    }
  }
  return {
    attempted: candidates.length,
    withPrices,
    withGreeks,
    validatedOk,
    strategyAssessed,
    meetHardNumerical,
    unevaluated,
    rejectionBreakdown,
  };
}

export const SMART_SCAN_SESSION_NOTICE =
  'Smart Scan research sessions persist in local SQLite. Restoring a session shows saved observations and coverage — it does not refresh live market prices. Scan Next Companies and Scan More Contracts require an explicit owner action.';

/** Application-curated Explore starters — real tickers, not official index membership. */
export const CURATED_STARTER_UNIVERSES: ReadonlyArray<{
  id: string;
  name: string;
  sourceLabel: string;
  retrievedAt: string;
  tickers: string[];
  companyNames: Record<string, string>;
}> = [
  {
    id: 'curated-explore-liquid-us-2026-10-17',
    name: 'Explore: Liquid US examples',
    sourceLabel:
      'OptionScout application-curated example universe (dated 2026-10-17). Not an official S&P 500 or Nasdaq-100 membership list. Use for discovering companies beyond a personal watchlist; verify chains with provider data when live Smart Scan is approved.',
    retrievedAt: '2026-10-17',
    tickers: [
      'AAPL',
      'MSFT',
      'AMZN',
      'GOOGL',
      'META',
      'NVDA',
      'AVGO',
      'TSLA',
      'COST',
      'NFLX',
      'AMD',
      'QCOM',
      'INTC',
      'CRM',
      'ORCL',
      'ADBE',
      'CSCO',
      'TXN',
      'AMAT',
      'MU',
      'CVX',
      'XOM',
      'WMT',
      'HD',
      'JPM',
      'BAC',
      'V',
      'MA',
      'UNH',
      'JNJ',
    ],
    companyNames: {
      AAPL: 'Apple',
      MSFT: 'Microsoft',
      AMZN: 'Amazon',
      GOOGL: 'Alphabet',
      META: 'Meta Platforms',
      NVDA: 'NVIDIA',
      AVGO: 'Broadcom',
      TSLA: 'Tesla',
      COST: 'Costco',
      NFLX: 'Netflix',
      AMD: 'Advanced Micro Devices',
      QCOM: 'Qualcomm',
      INTC: 'Intel',
      CRM: 'Salesforce',
      ORCL: 'Oracle',
      ADBE: 'Adobe',
      CSCO: 'Cisco',
      TXN: 'Texas Instruments',
      AMAT: 'Applied Materials',
      MU: 'Micron',
      CVX: 'Chevron',
      XOM: 'Exxon Mobil',
      WMT: 'Walmart',
      HD: 'Home Depot',
      JPM: 'JPMorgan Chase',
      BAC: 'Bank of America',
      V: 'Visa',
      MA: 'Mastercard',
      UNH: 'UnitedHealth',
      JNJ: 'Johnson & Johnson',
    },
  },
  {
    id: 'curated-explore-energy-retail-2026-10-17',
    name: 'Explore: Energy & retail examples',
    sourceLabel:
      'OptionScout application-curated example universe (dated 2026-10-17). Not an official index constituent file.',
    retrievedAt: '2026-10-17',
    tickers: ['CVX', 'XOM', 'COP', 'SLB', 'WMT', 'TGT', 'COST', 'HD', 'LOW', 'TJX', 'SBUX', 'MCD'],
    companyNames: {
      CVX: 'Chevron',
      XOM: 'Exxon Mobil',
      COP: 'ConocoPhillips',
      SLB: 'SLB',
      WMT: 'Walmart',
      TGT: 'Target',
      COST: 'Costco',
      HD: 'Home Depot',
      LOW: "Lowe's",
      TJX: 'TJX Companies',
      SBUX: 'Starbucks',
      MCD: "McDonald's",
    },
  },
];

export function listCuratedStarterUniverses(): DiscoveryUniverse[] {
  const now = '2026-10-17T00:00:00.000Z';
  return CURATED_STARTER_UNIVERSES.map((row) =>
    discoveryUniverseSchema.parse({
      id: row.id,
      name: row.name,
      sourceKind: 'curated-starter',
      sourceLabel: row.sourceLabel,
      retrievedAt: row.retrievedAt,
      tickers: row.tickers,
      companyNames: row.companyNames,
      editable: false,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export { SHOW_PROFILE_MISSES };

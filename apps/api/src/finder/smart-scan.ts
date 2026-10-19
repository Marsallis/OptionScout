/**
 * Phase 1D.2a Smart Scan orchestrator — interleaved multi-ticker LEAPS discovery.
 * Reuses chain parse, orderEligibleQueue, buildFinderCandidate. Does not rewrite Finder.
 *
 * Continuation model (1D.2a.5c):
 *  - A session pins one immutable, ordered company queue (the resolved universe version).
 *  - Each provider-backed operation takes a SQLite claim first; a second request is rejected.
 *  - The company cursor advances at claim time, so it counts attempted companies.
 *  - Progress commits after each company's chain load and after each evaluated contract.
 *  - A heartbeat renews the claim while the operation runs; losing it stops the operation.
 *  - Each operation re-observes the stock price before pairing it with new option quotes.
 *  - Failed, rate-limited, and interrupted companies stay explicitly retryable.
 */

import {
  FINDER_BATCH_SIZE,
  RESEARCH_REDISCOVERY_NOTICE,
  SHOW_PROFILE_MISSES,
  SMART_SCAN_DEFAULT_BUDGET,
  SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST,
  SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET as SHARED_DIAGNOSTIC_MAX_BUDGET,
  SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS as SHARED_DIAGNOSTIC_MAX_TICKERS,
  SMART_SCAN_MAX_BUDGET,
  SMART_SCAN_MAX_TICKERS,
  SMART_SCAN_SESSION_NOTICE,
  buildCandidateValidationCounters,
  buildSmartScanInsights,
  buildSmartScanPlainSummary,
  isRetryableTickerStatus,
  normalizeTickerList,
  smartScanMoreRequestSchema,
  smartScanNextCompaniesRequestSchema,
  smartScanRequestSchema,
  smartScanRetryCompaniesRequestSchema,
  type DiscoveryTolerances,
  type FinderCandidate,
  type ScanMorePriority,
  type SmartScanMode,
  type SmartScanProgress,
  type SmartScanResult,
  type SmartScanTickerProgress,
  type StrategyProfile,
  selectEquitySpotPrice,
} from '@optionscout/shared';
import { buildFinderCandidate } from './build-candidate.js';
import { nestedChainPath, parseNestedOptionChain, type NestedChainContract } from './chain.js';
import type { FinderQuoteSource, UnderlyingObservation } from './quotes.js';
import { budgetsFromProfile, observationsFromCandidates, orderEligibleQueue } from './selection.js';
import { SMART_MOCK_SPECIAL, SmartMockQuoteSource, mockSpotForTicker, smartMockNestedChainPayload } from './smart-mock.js';
import { getObservationByStreamer, mergeLiveWithCache, upsertObservationFromSnapshot } from './observations.js';
import type Database from 'better-sqlite3';
import type { AppDatabase } from '../db/client.js';
import type { BrokerageReadClient } from '../brokerage/client.js';
import { TastytradeError } from '../brokerage/errors.js';
import { LiveFinderQuoteSource } from './live-quotes.js';
import { resolveEquityStreamer } from './equities.js';
import {
  ResearchClaimError,
  ResearchPersistenceError,
  abandonResearchBatch,
  claimResearchBatch,
  commitResearchProgress,
  createDiscoverSession,
  discoverSessionColumns,
  loadDiscoverRestore,
  loadRemainingOccByTicker,
  startClaimHeartbeat,
  type ResearchBatchKind,
} from './research-sessions.js';
import type { ResolvedScanUniverse } from './universes.js';

/** Controlled live diagnostic allowlist (Phase 1D.2a.1) — kept in sync with shared policy. */
export const SMART_SCAN_LIVE_DIAGNOSTIC_TICKERS = SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST;
export const SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS = SHARED_DIAGNOSTIC_MAX_TICKERS;
export const SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET = SHARED_DIAGNOSTIC_MAX_BUDGET;

export interface SmartScanDeps {
  readProfile: (profileId?: string) => StrategyProfile;
  /** When false (default for 1D.2a), always use simulated multi-ticker fixtures. */
  smartScanLiveEnabled: boolean;
  liveScanEnabled: boolean;
  portfolioView: 'demo' | 'brokerage';
  /** Owner Settings preference; diagnostic allowlist applies only when live and mode is diagnostic. */
  smartScanMode: SmartScanMode;
  brokerage?: BrokerageReadClient | null;
  now?: () => Date;
  chainPayloadForTicker?: (ticker: string) => unknown;
  quoteSource?: FinderQuoteSource;
  database?: AppDatabase;
  /** When set, research sessions persist to SQLite (survives Docker restart). */
  persistSqlite?: Database.Database;
  /** Test seam: stock observation used when a continuation refreshes the underlying price. */
  underlyingQuote?: (ticker: string) => Promise<UnderlyingObservation | null>;
  /** Claim lease renewal interval (tests shorten it). */
  claimHeartbeatMs?: number;
}

interface QueueSlot {
  ticker: string;
  contract: NestedChainContract;
}

interface TickerState {
  progress: SmartScanTickerProgress;
  queue: NestedChainContract[];
  underlyingPrice: string | null;
  underlyingQuoteAt: string | null;
  underlyingBid: string | null;
  underlyingAsk: string | null;
  /** Why the stock price used for this operation is not a fresh observation, if it is not. */
  underlyingRefreshNote: string | null;
  lastError: string | null;
}

interface MutableSmartScan {
  result: SmartScanResult;
  cancelRequested: boolean;
  running: Promise<void> | null;
  deps: SmartScanDeps;
  profile: StrategyProfile;
  tolerances: DiscoveryTolerances;
  screeningFreshnessSeconds: number;
  globalQueue: QueueSlot[];
  queueOffset: number;
  evaluatedOcc: Set<string>;
  tickers: Map<string, TickerState>;
  quoteSource: FinderQuoteSource | null;
  liveQuoteSource: LiveFinderQuoteSource | null;
  focusFilter: string | null;
  /** Stable universe/session company order for Scan Next Companies. */
  orderedTickerQueue: string[];
  queueIndex: Map<string, number>;
  /** Companies attempted so far (advanced when a companies batch is claimed). */
  companyCursor: number;
  activeBatchId: string | null;
  memoryBatchSeq: number;
  /** Per-operation counters and pending writes for the next incremental commit. */
  opBudget: number;
  opUsed: number;
  opTickers: string[];
  dirty: Set<string>;
  pendingCandidates: FinderCandidate[];
  pendingOcc: string[];
  /** Remaining OCC ids saved in SQLite for tickers whose in-memory chain is not loaded. */
  savedRemaining: Map<string, string[]>;
  /** Tickers whose stock price was observed during the current operation. */
  opUnderlyingFresh: Set<string>;
  stopHeartbeat: (() => void) | null;
}

const sessions = new Map<string, MutableSmartScan>();

function createScanId(now: Date): string {
  return `smart_${now.toISOString().replace(/[:.]/g, '')}_${Math.random().toString(36).slice(2, 8)}`;
}

function asOfDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function nowOf(scan: MutableSmartScan): Date {
  return (scan.deps.now ?? (() => new Date()))();
}

/** Round-robin interleave so one company cannot monopolize early evaluation slots. */
export function interleaveTickerQueues(perTicker: ReadonlyMap<string, readonly NestedChainContract[]>): QueueSlot[] {
  const cursors = [...perTicker.entries()].map(([ticker, contracts]) => ({
    ticker,
    contracts: [...contracts],
    index: 0,
  }));
  const out: QueueSlot[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const cursor of cursors) {
      if (cursor.index < cursor.contracts.length) {
        out.push({ ticker: cursor.ticker, contract: cursor.contracts[cursor.index]! });
        cursor.index += 1;
        progressed = true;
      }
    }
  }
  return out;
}

function emptyTickerProgress(ticker: string, companyName: string | null): SmartScanTickerProgress {
  return {
    ticker,
    companyName,
    status: 'pending',
    message: 'Not examined yet.',
    underlyingPrice: null,
    underlyingQuoteAt: null,
    eligibleContracts: 0,
    evaluatedContracts: 0,
    incompleteContracts: 0,
    exactMatches: 0,
    nearMatches: 0,
    attemptCount: 0,
  };
}

function newTickerState(progress: SmartScanTickerProgress): TickerState {
  return {
    progress,
    queue: [],
    underlyingPrice: progress.underlyingPrice,
    underlyingQuoteAt: progress.underlyingQuoteAt,
    underlyingBid: null,
    underlyingAsk: null,
    underlyingRefreshNote: null,
    lastError: null,
  };
}

function usesSimulatedMode(deps: SmartScanDeps): boolean {
  return !(deps.smartScanLiveEnabled && deps.liveScanEnabled && deps.portfolioView === 'brokerage');
}

function isLiveDiagnostic(deps: SmartScanDeps): boolean {
  return !usesSimulatedMode(deps) && deps.smartScanMode === 'diagnostic';
}

function assertLiveDiagnosticLimits(deps: SmartScanDeps, tickers: string[], budget: number): void {
  if (!isLiveDiagnostic(deps)) return;
  if (tickers.length > SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS) {
    throw new Error(
      `Live Smart Scan diagnostic allows at most ${SMART_SCAN_LIVE_DIAGNOSTIC_MAX_TICKERS} companies (requested ${tickers.length}).`,
    );
  }
  const allowed = new Set<string>(SMART_SCAN_LIVE_DIAGNOSTIC_TICKERS);
  const blocked = tickers.filter((ticker) => !allowed.has(ticker));
  if (blocked.length > 0) {
    throw new Error(
      `Live Smart Scan diagnostic is restricted to ${SMART_SCAN_LIVE_DIAGNOSTIC_TICKERS.join(', ')}. Blocked: ${blocked.join(', ')}.`,
    );
  }
  if (budget > SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET) {
    throw new Error(
      `Live Smart Scan diagnostic evaluation budget cannot exceed ${SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET}.`,
    );
  }
}

function assertLiveNormalLimits(deps: SmartScanDeps, tickers: string[]): void {
  if (usesSimulatedMode(deps) || deps.smartScanMode !== 'normal') return;
  if (tickers.length === 0) {
    throw new Error('Provide at least one valid ticker symbol.');
  }
  if (tickers.length > SMART_SCAN_MAX_TICKERS) {
    throw new Error(`Live Smart Scan allows at most ${SMART_SCAN_MAX_TICKERS} companies (requested ${tickers.length}).`);
  }
}

async function loadChainPayload(deps: SmartScanDeps, ticker: string): Promise<unknown> {
  if (deps.chainPayloadForTicker) return deps.chainPayloadForTicker(ticker);
  if (usesSimulatedMode(deps)) return smartMockNestedChainPayload(ticker);
  if (!deps.brokerage) {
    throw new Error('Live Smart Scan requires an authenticated brokerage client.');
  }
  return deps.brokerage.getJson(nestedChainPath(ticker));
}

function isRateLimit(error: unknown): boolean {
  if (error instanceof TastytradeError) return error.status === 429;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b429\b|rate.?limit|too many requests/i.test(message);
}

function markProviderFailure(state: TickerState, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  state.lastError = message;
  if (isRateLimit(error)) {
    state.progress.status = 'rate-limited';
    state.progress.message = `Provider rate limit reached (${message}). This company stays retryable — use Retry Companies later.`;
  } else {
    state.progress.status = 'error';
    state.progress.message = `${message} This company stays retryable.`;
  }
}

function refreshTickerAggregates(scan: MutableSmartScan): void {
  const byTicker = new Map<string, FinderCandidate[]>();
  for (const row of scan.result.candidates) {
    const list = byTicker.get(row.underlying);
    if (list) list.push(row);
    else byTicker.set(row.underlying, [row]);
  }
  for (const [ticker, rows] of byTicker) {
    const state = scan.tickers.get(ticker);
    if (!state) continue;
    state.progress.evaluatedContracts = rows.length;
    state.progress.incompleteContracts = rows.filter((row) => row.outcome === 'incomplete').length;
    state.progress.exactMatches = rows.filter((row) => row.outcome === 'exact').length;
    state.progress.nearMatches = rows.filter((row) => row.outcome === 'near').length;
    if (state.progress.status === 'chain-loaded') {
      state.progress.status = 'evaluated';
      state.progress.message = 'At least one contract evaluated.';
      scan.dirty.add(ticker);
    }
  }
}

function remainingOccFor(scan: MutableSmartScan, ticker: string): string[] {
  const state = scan.tickers.get(ticker);
  if (!state) return [];
  if (state.queue.length === 0) {
    return (scan.savedRemaining.get(ticker) ?? []).filter((occ) => !scan.evaluatedOcc.has(occ));
  }
  return state.queue.map((c) => c.occSymbol).filter((occ) => occ && !scan.evaluatedOcc.has(occ));
}

function buildProgress(scan: MutableSmartScan, operationBudget: number, usedThisOp: number): SmartScanProgress {
  const tickerRows = [...scan.tickers.values()].map((row) => row.progress);
  let remainingCount = 0;
  for (const ticker of scan.tickers.keys()) {
    if (scan.focusFilter && ticker !== scan.focusFilter) continue;
    remainingCount += remainingOccFor(scan, ticker).length;
  }
  const companiesChainRetrieved = tickerRows.filter((row) =>
    ['chain-loaded', 'evaluated', 'empty', 'unsupported', 'error', 'rate-limited'].includes(row.status),
  ).length;
  const companiesWithEvaluated = tickerRows.filter((row) => row.evaluatedContracts > 0).length;
  const companiesPending = tickerRows.filter((row) => row.status === 'pending').length;
  const companiesBad = tickerRows.filter((row) => row.status === 'empty' || row.status === 'unsupported').length;
  const companiesErr = tickerRows.filter((row) => isRetryableTickerStatus(row.status)).length;
  const eligible = tickerRows.reduce((sum, row) => sum + row.eligibleContracts, 0);
  const fully = scan.result.candidates.filter((row) => row.outcome !== 'incomplete').length;
  const partial = scan.result.candidates.filter((row) => row.outcome === 'incomplete').length;
  const missing = scan.result.candidates.filter(
    (row) => row.flags.missingGreeks || row.flags.missingAsk || row.ask == null,
  ).length;
  const counters = buildCandidateValidationCounters(scan.result.candidates, remainingCount);
  const idle = scan.result.status !== 'running';

  const progress: SmartScanProgress = {
    companiesSelected: tickerRows.length,
    companiesChainRetrieved,
    companiesWithEvaluatedContracts: companiesWithEvaluated,
    companiesNotYetScanned: companiesPending,
    companiesUnsupportedOrEmpty: companiesBad,
    companiesRateLimitedOrError: companiesErr,
    eligibleContractsDiscovered: eligible,
    contractsFullyEvaluated: fully,
    contractsPartiallyEvaluated: partial,
    contractsNotYetEvaluated: remainingCount,
    missingQuotesOrGreeks: missing,
    evaluationBudget: operationBudget,
    evaluationBudgetUsed: usedThisOp,
    batchSize: FINDER_BATCH_SIZE,
    canScanMore: remainingCount > 0 && idle,
    cancelled: scan.result.status === 'cancelled',
    plainSummary: '',
    coverageNote:
      'A finished evaluation batch does not mean every company or every eligible contract was examined. Use Scan More for additional coverage, or Scan Next Companies to continue through the saved company list.',
    attempted: counters.attempted,
    withPrices: counters.withPrices,
    withGreeks: counters.withGreeks,
    validatedOk: counters.validatedOk,
    strategyAssessed: counters.strategyAssessed,
    meetHardNumerical: counters.meetHardNumerical,
    rejectionBreakdown: counters.rejectionBreakdown,
  };
  progress.plainSummary = buildSmartScanPlainSummary(progress);
  return progress;
}

function refreshResult(scan: MutableSmartScan): void {
  refreshTickerAggregates(scan);
  scan.result.tickers = [...scan.tickers.values()].map((row) => ({ ...row.progress }));
  scan.result.progress = buildProgress(scan, scan.opBudget, scan.opUsed);
  scan.result.insights = buildSmartScanInsights({
    tickers: scan.result.tickers,
    candidates: scan.result.candidates,
    progress: scan.result.progress,
  });
  const idle = scan.result.status !== 'running';
  scan.result.companyCursor = scan.companyCursor;
  scan.result.companiesInUniverseQueue = scan.orderedTickerQueue.length;
  scan.result.canScanNextCompanies = idle && scan.companyCursor < scan.orderedTickerQueue.length;
  scan.result.companiesRetryable = scan.result.tickers.filter((row) => isRetryableTickerStatus(row.status)).length;
  scan.result.activeBatchId = scan.activeBatchId;
  scan.result.updatedAt = nowOf(scan).toISOString();
}

/** Write pending progress for the active batch. Throws ResearchPersistenceError on any storage failure. */
function commitProgress(
  scan: MutableSmartScan,
  options: { plannedOcc?: string[]; finish?: { batchStatus: 'completed' | 'failed' | 'cancelled'; error: string | null } } = {},
): void {
  const sqlite = scan.deps.persistSqlite;
  const batchId = scan.activeBatchId;
  if (!sqlite || !batchId) {
    scan.dirty.clear();
    scan.pendingCandidates = [];
    scan.pendingOcc = [];
    return;
  }
  const cols = discoverSessionColumns(scan.result, scan.orderedTickerQueue.length, scan.companyCursor);
  const companies = [...scan.dirty].map((ticker) => {
    const state = scan.tickers.get(ticker)!;
    return {
      ticker,
      queueIndex: scan.queueIndex.get(ticker) ?? scan.orderedTickerQueue.length,
      progress: state.progress,
      remainingOcc: remainingOccFor(scan, ticker),
      lastError: state.lastError,
    };
  });
  try {
    commitResearchProgress(sqlite, {
      sessionId: scan.result.scanId,
      batchId,
      status: scan.result.status,
      progressJson: cols.progressJson,
      metaJson: cols.metaJson,
      finishedAt: scan.result.finishedAt,
      companies,
      candidates: scan.pendingCandidates,
      evaluatedOcc: scan.pendingOcc,
      plannedOcc: options.plannedOcc,
      evaluationCount: scan.opUsed,
      now: nowOf(scan),
      finish: options.finish,
    });
  } catch (error) {
    if (error instanceof ResearchClaimError) throw error;
    const detail = error instanceof Error ? error.message : 'unknown storage error';
    throw new ResearchPersistenceError(
      `Research progress could not be saved (${detail}). The scan was stopped so unsaved work is not reported as saved.`,
    );
  }
  scan.dirty.clear();
  scan.pendingCandidates = [];
  scan.pendingOcc = [];
}

function takeNextSlots(scan: MutableSmartScan, limit: number): QueueSlot[] {
  const batch: QueueSlot[] = [];
  while (scan.queueOffset < scan.globalQueue.length && batch.length < limit) {
    const slot = scan.globalQueue[scan.queueOffset]!;
    scan.queueOffset += 1;
    if (scan.evaluatedOcc.has(slot.contract.occSymbol)) continue;
    if (scan.focusFilter && slot.ticker !== scan.focusFilter) continue;
    batch.push(slot);
  }
  return batch;
}

async function ensureQuoteSource(scan: MutableSmartScan): Promise<FinderQuoteSource> {
  if (scan.quoteSource) return scan.quoteSource;
  if (scan.deps.quoteSource) {
    scan.quoteSource = scan.deps.quoteSource;
  } else if (usesSimulatedMode(scan.deps)) {
    scan.quoteSource = new SmartMockQuoteSource(nowOf(scan).toISOString());
  } else if (scan.deps.brokerage) {
    const live = new LiveFinderQuoteSource({
      client: scan.deps.brokerage,
      restSymbolByStreamer: new Map(),
      collectMs: 4000,
      now: scan.deps.now,
    });
    await live.start();
    scan.liveQuoteSource = live;
    scan.quoteSource = live;
  } else {
    throw new Error('Live Smart Scan requires brokerage quotes.');
  }
  return scan.quoteSource;
}

type UnderlyingFetch = { observation: UnderlyingObservation | null; error: unknown };

/**
 * Observe stock prices for several companies. Live mode uses one streaming session for the
 * whole set; simulated mode never touches the brokerage. Never throws.
 */
async function fetchUnderlyings(scan: MutableSmartScan, tickers: readonly string[]): Promise<Map<string, UnderlyingFetch>> {
  const out = new Map<string, UnderlyingFetch>();
  if (scan.deps.underlyingQuote) {
    for (const ticker of tickers) {
      try {
        out.set(ticker, { observation: await scan.deps.underlyingQuote(ticker), error: null });
      } catch (error) {
        out.set(ticker, { observation: null, error });
      }
    }
    return out;
  }
  if (usesSimulatedMode(scan.deps)) {
    const quoteAt = nowOf(scan).toISOString();
    for (const ticker of tickers) {
      out.set(ticker, { observation: { price: mockSpotForTicker(ticker), quoteAt, bid: null, ask: null }, error: null });
    }
    return out;
  }
  const brokerage = scan.deps.brokerage;
  if (!brokerage) {
    for (const ticker of tickers) out.set(ticker, { observation: null, error: new Error('Brokerage quotes are not available.') });
    return out;
  }
  const streamerByTicker = new Map<string, string>();
  const restMap = new Map<string, { symbol: string; kind: 'equity' }>();
  for (const ticker of tickers) {
    try {
      const equity = await resolveEquityStreamer(brokerage, ticker);
      streamerByTicker.set(ticker, equity.streamerSymbol);
      restMap.set(equity.streamerSymbol, { symbol: equity.returnedSymbol, kind: 'equity' });
    } catch (error) {
      out.set(ticker, { observation: null, error });
    }
  }
  if (streamerByTicker.size === 0) return out;
  try {
    const live = new LiveFinderQuoteSource({ client: brokerage, restSymbolByStreamer: restMap, collectMs: 3000, now: scan.deps.now });
    await live.start();
    let quotes;
    try {
      quotes = await live.fetchQuotes([...streamerByTicker.values()]);
    } finally {
      await live.stop();
    }
    for (const [ticker, streamer] of streamerByTicker) {
      const eq = quotes.get(streamer);
      const price = selectEquitySpotPrice(eq?.bid ?? null, eq?.ask ?? null, eq?.mark ?? null);
      if (scan.deps.database && eq) {
        upsertObservationFromSnapshot(scan.deps.database, { snapshot: eq, instrumentKind: 'equity', underlying: ticker, now: nowOf(scan) });
      }
      out.set(ticker, {
        observation: price
          ? { price, quoteAt: eq?.providerEventAt ?? eq?.receivedAt ?? nowOf(scan).toISOString(), bid: eq?.bid ?? null, ask: eq?.ask ?? null }
          : null,
        error: null,
      });
    }
  } catch (error) {
    for (const ticker of streamerByTicker.keys()) out.set(ticker, { observation: null, error });
  }
  return out;
}

function applyUnderlying(state: TickerState, observation: UnderlyingObservation): void {
  state.underlyingPrice = observation.price;
  state.underlyingQuoteAt = observation.quoteAt;
  state.underlyingBid = observation.bid;
  state.underlyingAsk = observation.ask;
  state.underlyingRefreshNote = null;
  state.progress.underlyingPrice = observation.price;
  state.progress.underlyingQuoteAt = observation.quoteAt;
}

/**
 * Before evaluating new option quotes for a company in this operation, observe its stock price
 * again so the pairing comes from the same trading session. Earlier candidates keep their own
 * stored stock price. On failure the saved price is kept and new evaluations are marked unverified.
 */
async function refreshUnderlyingsForSlice(scan: MutableSmartScan, slice: readonly QueueSlot[]): Promise<void> {
  const tickers = [...new Set(slice.map((slot) => slot.ticker))].filter(
    (ticker) => !scan.opUnderlyingFresh.has(ticker) && scan.tickers.has(ticker),
  );
  if (tickers.length === 0) return;
  const fetched = await fetchUnderlyings(scan, tickers);
  for (const ticker of tickers) {
    scan.opUnderlyingFresh.add(ticker);
    const state = scan.tickers.get(ticker)!;
    const result = fetched.get(ticker);
    if (result?.observation) {
      applyUnderlying(state, result.observation);
    } else {
      const reason = result?.error instanceof Error ? result.error.message : 'no stock quote was returned';
      state.underlyingRefreshNote =
        `A current stock price could not be retrieved (${reason}); the saved price from ` +
        `${state.underlyingQuoteAt ?? 'an unknown time'} is trusted only for option quotes from that same trading session.`;
    }
    scan.dirty.add(ticker);
  }
}

/** Evaluate slots in quote slices of FINDER_BATCH_SIZE, committing after each evaluated contract. */
async function evaluateSlots(scan: MutableSmartScan, slots: readonly QueueSlot[]): Promise<number> {
  const quoteSource = await ensureQuoteSource(scan);
  const asOf = asOfDate(nowOf(scan));
  let used = 0;

  for (let index = 0; index < slots.length; index += FINDER_BATCH_SIZE) {
    if (scan.cancelRequested) break;
    const slice = slots.slice(index, index + FINDER_BATCH_SIZE);
    await refreshUnderlyingsForSlice(scan, slice);
    if (scan.cancelRequested) break;
    const streamers = slice.map((row) => row.contract.streamerSymbol!).filter(Boolean);
    if (scan.liveQuoteSource) {
      for (const slot of slice) {
        if (slot.contract.streamerSymbol) {
          scan.liveQuoteSource.registerRestSymbol(slot.contract.streamerSymbol, slot.contract.occSymbol, 'equity-option');
        }
      }
    }
    const quotes = await quoteSource.fetchQuotes(streamers);
    const now = nowOf(scan);

    for (const slot of slice) {
      const state = scan.tickers.get(slot.ticker);
      let quote = slot.contract.streamerSymbol ? quotes.get(slot.contract.streamerSymbol) ?? null : null;
      if (scan.deps.database && slot.contract.streamerSymbol) {
        if (quote && (quote.ask != null || quote.delta != null)) {
          upsertObservationFromSnapshot(scan.deps.database, {
            snapshot: quote,
            instrumentKind: 'equity-option',
            underlying: slot.ticker,
            occSymbol: slot.contract.occSymbol,
            underlyingProviderEventAt: state?.underlyingQuoteAt ?? null,
            now,
          });
        }
        const cached = getObservationByStreamer(scan.deps.database, slot.contract.streamerSymbol);
        quote = mergeLiveWithCache(quote, cached, now);
      }
      const candidate = buildFinderCandidate({
        contract: slot.contract,
        underlyingPrice: state?.underlyingPrice ?? null,
        underlyingQuoteAt: state?.underlyingQuoteAt ?? null,
        underlyingBid: state?.underlyingBid ?? null,
        underlyingAsk: state?.underlyingAsk ?? null,
        underlyingRefreshNote: state?.underlyingRefreshNote ?? null,
        quote,
        profile: scan.profile,
        tolerances: scan.tolerances,
        asOfDate: asOf,
        now,
        screeningFreshnessSeconds: scan.screeningFreshnessSeconds,
      });
      scan.result.candidates.push(candidate);
      scan.pendingCandidates.push(candidate);
      scan.evaluatedOcc.add(slot.contract.occSymbol);
      scan.pendingOcc.push(slot.contract.occSymbol);
      scan.dirty.add(slot.ticker);
      used += 1;
      scan.opUsed += 1;
      refreshResult(scan);
      commitProgress(scan);
    }
  }
  return used;
}

/** Stage A for one company: chain + spot, then an ordered eligible queue. Never throws for provider errors. */
async function loadCompany(scan: MutableSmartScan, ticker: string): Promise<void> {
  const state = scan.tickers.get(ticker)!;
  const budgets = budgetsFromProfile(scan.profile);
  state.queue = [];
  state.lastError = null;
  scan.savedRemaining.delete(ticker);
  try {
    const payload = await loadChainPayload(scan.deps, ticker);
    if (ticker === SMART_MOCK_SPECIAL.EMPTY) {
      state.progress.status = 'empty';
      state.progress.message = 'No option chain items returned for this ticker.';
      return;
    }
    const parsed = parseNestedOptionChain(payload, ticker);
    const simulated = usesSimulatedMode(scan.deps);
    /* Live path must not fall back to simulated mockSpotForTicker. */
    const fetched = (await fetchUnderlyings(scan, [ticker])).get(ticker);
    scan.opUnderlyingFresh.add(ticker);
    if (!fetched?.observation) {
      const lookupError = fetched?.error ?? null;
      const lookupMessage = lookupError instanceof Error ? lookupError.message : null;
      const unsupported =
        lookupMessage != null && /not supported|instrument lookup|did not match|HTTP 404/i.test(lookupMessage);
      if (unsupported) {
        state.progress.status = 'unsupported';
        state.progress.message = `${ticker} is not supported for live Smart Scan (${lookupMessage}). No simulated data is used when live mode is active.`;
      } else {
        markProviderFailure(
          state,
          lookupError ??
            new Error(
              'Live equity quote unavailable — intrinsic value cannot be calculated without a stock price. No simulated data is used when live mode is active.',
            ),
          'Live equity lookup failed.',
        );
      }
      return;
    }
    applyUnderlying(state, fetched.observation);
    const spot = fetched.observation.price;

    if (parsed.standardCalls === 0 && parsed.unsupportedAdjusted > 0) {
      state.progress.status = 'unsupported';
      state.progress.message = 'Only unsupported/adjusted contracts were found — no standard LEAPS evaluated.';
      return;
    }
    if (parsed.contracts.length === 0) {
      state.progress.status = 'empty';
      state.progress.message = simulated
        ? 'Chain retrieved but no contracts were available.'
        : `${ticker} returned an empty option chain. Live Smart Scan does not fall back to simulated data.`;
      return;
    }

    const plan = orderEligibleQueue({
      contracts: parsed.contracts,
      stockPrice: spot,
      budgets,
      priority: scan.result.scanPriority,
      alreadyEvaluated: scan.evaluatedOcc,
    });
    state.queue = plan.queue.filter((row) => !scan.evaluatedOcc.has(row.occSymbol));
    state.progress.eligibleContracts = plan.eligibleCount;
    state.progress.status = 'chain-loaded';
    state.progress.message =
      plan.eligibleCount > 0
        ? `${plan.eligibleCount} long-dated eligible contracts queued (prioritization estimates are not market prices).`
        : 'Chain loaded but no LEAPS met the minimum expiration window.';
  } catch (error) {
    markProviderFailure(state, error, 'Chain load failed.');
  }
}

/**
 * After SQLite hydrate, contract queues are not in memory. Explicit continuation re-requests
 * chains only for companies with saved remaining contracts, and keeps exactly those contracts.
 */
async function ensureContractQueuesLoaded(scan: MutableSmartScan): Promise<number> {
  let rediscovered = 0;
  for (const [ticker, saved] of [...scan.savedRemaining.entries()]) {
    const state = scan.tickers.get(ticker);
    if (!state || state.queue.length > 0) continue;
    if (scan.focusFilter && ticker !== scan.focusFilter) continue;
    const wanted = new Set(saved.filter((occ) => !scan.evaluatedOcc.has(occ)));
    if (wanted.size === 0) {
      scan.savedRemaining.delete(ticker);
      continue;
    }
    if (scan.cancelRequested) break;
    rediscovered += 1;
    try {
      const payload = await loadChainPayload(scan.deps, ticker);
      const parsed = parseNestedOptionChain(payload, ticker);
      const fetched = (await fetchUnderlyings(scan, [ticker])).get(ticker);
      scan.opUnderlyingFresh.add(ticker);
      const savedQuoteAt = state.underlyingQuoteAt;
      if (fetched?.observation) {
        applyUnderlying(state, fetched.observation);
      } else {
        const reason = fetched?.error instanceof Error ? fetched.error.message : 'no stock quote was returned';
        state.underlyingRefreshNote =
          `A current stock price could not be retrieved (${reason}); the saved price from ` +
          `${savedQuoteAt ?? 'an unknown time'} is trusted only for option quotes from that same trading session.`;
      }
      const plan = orderEligibleQueue({
        contracts: parsed.contracts.filter((row) => wanted.has(row.occSymbol)),
        stockPrice: state.underlyingPrice,
        budgets: budgetsFromProfile(scan.profile),
        priority: scan.result.scanPriority,
        alreadyEvaluated: scan.evaluatedOcc,
      });
      state.queue = plan.queue.filter((row) => wanted.has(row.occSymbol));
      scan.savedRemaining.delete(ticker);
      const missing = wanted.size - state.queue.length;
      state.progress.message =
        `Re-requested the option chain to continue ${state.queue.length} saved remaining contracts` +
        (missing > 0 ? ` (${missing} are no longer listed by the provider)` : '') +
        (state.underlyingRefreshNote
          ? `. ${state.underlyingRefreshNote}`
          : `. Stock price re-observed at ${state.underlyingQuoteAt}; earlier results keep the stock price they were evaluated with (originally ${savedQuoteAt ?? 'unknown'}).`);
    } catch (error) {
      markProviderFailure(state, error, 'Chain rediscovery failed.');
    }
    scan.dirty.add(ticker);
    refreshResult(scan);
    commitProgress(scan);
  }
  return rediscovered;
}

function rebuildGlobalQueue(scan: MutableSmartScan, priority: ScanMorePriority, onlyTickers?: readonly string[]): void {
  const budgets = budgetsFromProfile(scan.profile);
  const observations = observationsFromCandidates(scan.result.candidates);
  const allow = onlyTickers ? new Set(onlyTickers) : null;
  const perTicker = new Map<string, NestedChainContract[]>();
  for (const [ticker, state] of scan.tickers) {
    if (allow && !allow.has(ticker)) continue;
    const remaining = state.queue.filter((row) => !scan.evaluatedOcc.has(row.occSymbol));
    if (remaining.length === 0) continue;
    const plan = orderEligibleQueue({
      contracts: remaining,
      stockPrice: state.underlyingPrice,
      budgets,
      priority,
      observations: observations.filter((row) => remaining.some((contract) => contract.expiration === row.expiration)),
      alreadyEvaluated: scan.evaluatedOcc,
    });
    perTicker.set(ticker, plan.queue);
  }
  scan.globalQueue = interleaveTickerQueues(perTicker);
  scan.queueOffset = 0;
}

/** Stage A for each company (committed one by one), then an interleaved evaluation pass. */
async function runCompanyBatch(scan: MutableSmartScan, tickers: readonly string[], budget: number): Promise<string> {
  for (const ticker of tickers) {
    if (scan.cancelRequested) break;
    await loadCompany(scan, ticker);
    scan.dirty.add(ticker);
    refreshResult(scan);
    commitProgress(scan);
  }
  if (scan.cancelRequested) return 'Cancelled before evaluation.';
  rebuildGlobalQueue(scan, scan.result.scanPriority, tickers);
  scan.result.message =
    'Stage A finished for this company group. Evaluating an interleaved sample of contracts (estimates are not fills).';
  const slots = takeNextSlots(scan, budget);
  if (slots.length > 0) commitProgress(scan, { plannedOcc: slots.map((slot) => slot.contract.occSymbol) });
  const used = await evaluateSlots(scan, slots);
  return used === 0
    ? 'No contracts were evaluated. Check unsupported or empty companies, then try another group.'
    : `Company batch complete (${used} contracts). Matching a profile is not a claim of profitability.`;
}

async function runContractsBatch(
  scan: MutableSmartScan,
  count: number,
  priority: ScanMorePriority,
  mode: 'diversified' | 'focus-ticker',
  focusTicker?: string,
): Promise<string> {
  scan.focusFilter = mode === 'focus-ticker' ? (focusTicker ?? null) : null;
  const rediscovered = await ensureContractQueuesLoaded(scan);
  rebuildGlobalQueue(scan, priority);
  scan.result.message =
    mode === 'focus-ticker'
      ? `Scan More focusing on ${focusTicker} remaining contracts (same session — not a new company group).`
      : 'Scan More continuing diversified discovery across the same company group.';
  const slots = takeNextSlots(scan, count);
  if (slots.length > 0) commitProgress(scan, { plannedOcc: slots.map((slot) => slot.contract.occSymbol) });
  const used = await evaluateSlots(scan, slots);
  const rediscoveryNote = rediscovered > 0 ? ` ${RESEARCH_REDISCOVERY_NOTICE} (${rediscovered} companies.)` : '';
  return used === 0
    ? `No additional contracts remained for this Scan More Contracts request.${rediscoveryNote}`
    : `Scan More Contracts complete (${used} additional contracts). Same research session — not a new company batch.${rediscoveryNote}`;
}

function retryableNote(scan: MutableSmartScan): string {
  const n = scan.result.companiesRetryable ?? 0;
  return n > 0 ? ` ${n} ${n === 1 ? 'company' : 'companies'} can be retried.` : '';
}

/**
 * Claim the session synchronously, so a concurrent request fails before any provider call.
 * The cursor (if any) advances atomically with the claim.
 */
function beginOperation(
  scan: MutableSmartScan,
  input: { batchKind: ResearchBatchKind; tickers: string[]; budget: number; cursor?: { expected: number; next: number } },
): void {
  if (scan.running) throw new Error('A Smart Scan operation is already running.');
  const sqlite = scan.deps.persistSqlite;
  const now = nowOf(scan);
  if (sqlite) {
    const claim = claimResearchBatch(sqlite, {
      sessionId: scan.result.scanId,
      batchKind: input.batchKind,
      tickers: input.tickers,
      evaluationBudget: input.budget,
      cursor: input.cursor,
      now,
    });
    scan.activeBatchId = claim.batchId;
    scan.stopHeartbeat?.();
    scan.stopHeartbeat = startClaimHeartbeat(sqlite, {
      sessionId: scan.result.scanId,
      batchId: claim.batchId,
      now: () => nowOf(scan),
      intervalMs: scan.deps.claimHeartbeatMs,
      onLost: () => {
        if (scan.result.status !== 'running' || scan.activeBatchId !== claim.batchId) return;
        scan.cancelRequested = true;
        scan.result.persistenceError =
          'This scan lost its research claim to another operation, so it stopped. Results saved before that point are kept.';
      },
    });
  } else {
    scan.memoryBatchSeq += 1;
    scan.activeBatchId = `${scan.result.scanId}:b${scan.memoryBatchSeq}`;
  }
  if (input.cursor) scan.companyCursor = input.cursor.next;
  if (input.batchKind !== 'contracts') {
    for (const ticker of input.tickers) {
      const state = scan.tickers.get(ticker)!;
      state.progress.attemptCount = (state.progress.attemptCount ?? 0) + 1;
      state.progress.status = 'pending';
      state.progress.message = 'Queued in the active batch.';
    }
  }
  scan.cancelRequested = false;
  scan.opUnderlyingFresh.clear();
  scan.opBudget = input.budget;
  scan.opUsed = 0;
  scan.opTickers = input.batchKind === 'contracts' ? [] : [...input.tickers];
  scan.result.status = 'running';
  scan.result.finishedAt = null;
  scan.result.error = null;
  scan.result.persistenceError = null;
  refreshResult(scan);
}

function finalize(scan: MutableSmartScan, status: 'completed' | 'cancelled' | 'failed', message: string, error: string | null): void {
  scan.stopHeartbeat?.();
  scan.stopHeartbeat = null;
  scan.result.status = status;
  scan.result.finishedAt = nowOf(scan).toISOString();
  scan.result.error = error;
  scan.result.message = message;
  refreshResult(scan);
  scan.result.activeBatchId = null;
  commitProgress(scan, { finish: { batchStatus: status, error } });
}

function launch(scan: MutableSmartScan, work: () => Promise<string>): void {
  scan.running = Promise.resolve()
    .then(async () => {
      try {
        const message = await work();
        if (scan.cancelRequested) {
          finalize(
            scan,
            'cancelled',
            'Smart Scan cancelled. Results reflect only contracts evaluated before cancellation. The selected company group was not fully examined.' +
              retryableNote(scan),
            null,
          );
        } else {
          refreshResult(scan);
          finalize(scan, 'completed', message + retryableNote(scan), null);
        }
      } catch (error) {
        handleOperationFailure(scan, error);
      }
    })
    .finally(async () => {
      scan.stopHeartbeat?.();
      scan.stopHeartbeat = null;
      scan.activeBatchId = null;
      scan.result.activeBatchId = null;
      if (scan.liveQuoteSource) {
        await scan.liveQuoteSource.stop().catch(() => undefined);
        scan.liveQuoteSource = null;
        scan.quoteSource = null;
      }
      scan.running = null;
    });
}

function handleOperationFailure(scan: MutableSmartScan, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Smart Scan failed.';
  const batchId = scan.activeBatchId;
  if (error instanceof ResearchPersistenceError || error instanceof ResearchClaimError) {
    scan.result.status = 'failed';
    scan.result.error = message;
    scan.result.persistenceError = message;
    scan.result.message = message;
    scan.result.finishedAt = nowOf(scan).toISOString();
    if (scan.deps.persistSqlite && batchId && error instanceof ResearchPersistenceError) {
      abandonResearchBatch(scan.deps.persistSqlite, scan.result.scanId, batchId, message);
    }
    return;
  }
  // Provider failure mid-operation: companies still pending in this batch become retryable.
  for (const ticker of scan.opTickers) {
    const state = scan.tickers.get(ticker);
    if (state?.progress.status === 'pending') {
      markProviderFailure(state, error, message);
      scan.dirty.add(ticker);
    }
  }
  try {
    finalize(scan, 'failed', `${message} Saved progress is kept; continue with an explicit action.${retryableNote(scan)}`, message);
  } catch (persistError) {
    const detail = persistError instanceof Error ? persistError.message : 'Research progress could not be saved.';
    scan.result.persistenceError = detail;
    if (scan.deps.persistSqlite && batchId) abandonResearchBatch(scan.deps.persistSqlite, scan.result.scanId, batchId, detail);
  }
}

function buildScan(input: {
  result: SmartScanResult;
  deps: SmartScanDeps;
  profile: StrategyProfile;
  orderedTickerQueue: string[];
  tickers: Map<string, TickerState>;
  companyCursor: number;
  evaluatedOcc: Iterable<string>;
  savedRemaining?: Map<string, string[]>;
}): MutableSmartScan {
  return {
    result: input.result,
    cancelRequested: false,
    running: null,
    deps: input.deps,
    profile: input.profile,
    tolerances: input.result.tolerances,
    screeningFreshnessSeconds: 60,
    globalQueue: [],
    queueOffset: 0,
    evaluatedOcc: new Set(input.evaluatedOcc),
    tickers: input.tickers,
    quoteSource: null,
    liveQuoteSource: null,
    focusFilter: null,
    orderedTickerQueue: input.orderedTickerQueue,
    queueIndex: new Map(input.orderedTickerQueue.map((ticker, index) => [ticker, index])),
    companyCursor: input.companyCursor,
    activeBatchId: null,
    memoryBatchSeq: 0,
    opBudget: input.result.progress.evaluationBudget,
    opUsed: 0,
    opTickers: [],
    dirty: new Set(),
    pendingCandidates: [],
    pendingOcc: [],
    savedRemaining: input.savedRemaining ?? new Map(),
    opUnderlyingFresh: new Set(),
    stopHeartbeat: null,
  };
}

/**
 * Start a session. With a resolved universe, the session pins that version's full ordered
 * membership: requested tickers first, then the rest of the universe in stored order.
 * Only the first batch (≤12) is evaluated now; the cursor records how far the queue was attempted.
 */
export function startSmartScan(
  deps: SmartScanDeps,
  body: unknown,
  universe: ResolvedScanUniverse | null = null,
): SmartScanResult {
  const request = smartScanRequestSchema.parse(body);
  const selected = normalizeTickerList(request.tickers);
  if (request.tickers.length > 0 && selected.tickers.length === 0) {
    throw new Error('Provide at least one valid ticker symbol.');
  }
  if (selected.tickers.length > SMART_SCAN_MAX_TICKERS) {
    throw new Error(`Smart Scan accepts at most ${SMART_SCAN_MAX_TICKERS} companies per operation.`);
  }

  const profile = deps.readProfile(request.profileId);
  if (profile.id !== request.profileId) {
    throw new Error(`Strategy profile ${request.profileId} is not available.`);
  }

  const universeTickers = universe ? normalizeTickerList(universe.tickers).tickers : [];
  let orderedTickerQueue = normalizeTickerList([...selected.tickers, ...universeTickers]).tickers;
  if (orderedTickerQueue.length === 0) throw new Error('Provide at least one valid ticker symbol.');
  const batchTickers = selected.tickers.length > 0 ? selected.tickers : orderedTickerQueue.slice(0, SMART_SCAN_MAX_TICKERS);

  const now = (deps.now ?? (() => new Date()))();
  const scanId = createScanId(now);
  const requestedBudget = request.evaluationBudget ?? SMART_SCAN_DEFAULT_BUDGET;
  let budget = Math.min(requestedBudget, SMART_SCAN_MAX_BUDGET);
  const priority = request.scanPriority ?? 'closest-to-strategy';
  const simulated = usesSimulatedMode(deps);
  if (!simulated) {
    if (deps.smartScanMode === 'diagnostic') {
      // Reject over-budget live diagnostics against the requested value before any clamp.
      assertLiveDiagnosticLimits(deps, batchTickers, requestedBudget);
      budget = Math.min(budget, SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET);
      // Diagnostic sessions never queue companies beyond the allowlisted batch.
      orderedTickerQueue = [...batchTickers];
    } else {
      assertLiveNormalLimits(deps, batchTickers);
      // Initial normal live scan is paced to the default budget (24); Scan More can request more later.
      budget = Math.min(budget, SMART_SCAN_DEFAULT_BUDGET);
    }
  }
  const companyNames = { ...(universe?.companyNames ?? {}), ...(request.companyNames ?? {}) };

  const tickers = new Map<string, TickerState>();
  for (const ticker of orderedTickerQueue) {
    tickers.set(ticker, newTickerState(emptyTickerProgress(ticker, companyNames[ticker] ?? null)));
  }

  const result: SmartScanResult = {
    scanId,
    status: 'running',
    mode: simulated ? 'simulated-fixture' : 'live-gated',
    profileId: profile.id,
    profileName: profile.name,
    profileRevision: profile.revision,
    scanPriority: priority,
    universeId: universe?.universeId ?? request.universeId ?? null,
    universeVersionId: universe?.universeVersionId ?? null,
    universeLabel: universe?.label ?? request.universeLabel ?? `Manual selection (${batchTickers.length} companies)`,
    startedAt: now.toISOString(),
    finishedAt: null,
    updatedAt: now.toISOString(),
    sessionPersistence: deps.persistSqlite ? 'sqlite' : 'in-memory',
    sessionNotice: SMART_SCAN_SESSION_NOTICE,
    message: 'Smart Scan started.',
    simulated,
    simulatedNotice: simulated ? 'SIMULATED DATA — NOT ACTUAL MARKET PRICES' : null,
    dataSource: simulated
      ? 'SIMULATED smart-scan fixture chains (local labeled multi-ticker universe — not a brokerage chain)'
      : 'tastytrade nested option chains + quotes (read-only)',
    canScanNextCompanies: false,
    companyCursor: 0,
    companiesInUniverseQueue: orderedTickerQueue.length,
    companiesRetryable: 0,
    activeBatchId: null,
    persistenceError: null,
    progress: {
      companiesSelected: orderedTickerQueue.length,
      companiesChainRetrieved: 0,
      companiesWithEvaluatedContracts: 0,
      companiesNotYetScanned: orderedTickerQueue.length,
      companiesUnsupportedOrEmpty: 0,
      companiesRateLimitedOrError: 0,
      eligibleContractsDiscovered: 0,
      contractsFullyEvaluated: 0,
      contractsPartiallyEvaluated: 0,
      contractsNotYetEvaluated: 0,
      missingQuotesOrGreeks: 0,
      evaluationBudget: budget,
      evaluationBudgetUsed: 0,
      batchSize: FINDER_BATCH_SIZE,
      canScanMore: false,
      cancelled: false,
      plainSummary: 'Scan starting.',
      coverageNote: 'In progress.',
    },
    tickers: [...tickers.values()].map((row) => row.progress),
    insights: [],
    candidates: [],
    tolerances: request.tolerances ?? SHOW_PROFILE_MISSES,
    error: null,
  };

  const scan = buildScan({ result, deps, profile, orderedTickerQueue, tickers, companyCursor: 0, evaluatedOcc: [] });
  if (deps.persistSqlite) {
    try {
      createDiscoverSession(deps.persistSqlite, {
        result,
        strategySnapshot: profile,
        orderedTickerQueue,
        companies: result.tickers,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown storage error';
      throw new ResearchPersistenceError(`The research session could not be saved (${detail}). No scan was started.`);
    }
  }
  sessions.set(scanId, scan);
  beginOperation(scan, {
    batchKind: 'companies',
    tickers: batchTickers,
    budget,
    cursor: { expected: 0, next: batchTickers.length },
  });
  launch(scan, () => runCompanyBatch(scan, batchTickers, budget));
  return structuredClone(scan.result);
}

/**
 * Rebuild an in-memory session from SQLite for explicit continue actions.
 * Does not call brokerage until an operation actually runs.
 */
function tryHydrateDiscoverSession(scanId: string, deps: SmartScanDeps): MutableSmartScan | null {
  const sqlite = deps.persistSqlite;
  if (!sqlite) return null;
  const restored = loadDiscoverRestore(sqlite, scanId);
  if (!restored) return null;

  const tickers = new Map<string, TickerState>();
  for (const row of restored.result.tickers) tickers.set(row.ticker, newTickerState({ ...row }));
  for (const ticker of restored.orderedTickerQueue) {
    if (!tickers.has(ticker)) tickers.set(ticker, newTickerState(emptyTickerProgress(ticker, null)));
  }
  const result = structuredClone(restored.result);
  result.sessionPersistence = 'sqlite';
  const scan = buildScan({
    result,
    deps,
    profile: restored.strategySnapshot,
    orderedTickerQueue: [...restored.orderedTickerQueue],
    tickers,
    companyCursor: restored.companyCursor,
    evaluatedOcc: restored.evaluatedOcc,
    savedRemaining: loadRemainingOccByTicker(sqlite, scanId),
  });
  sessions.set(scanId, scan);
  return scan;
}

function resolveScan(scanId: string, deps: SmartScanDeps | undefined, missingMessage: string): MutableSmartScan {
  let scan = sessions.get(scanId) ?? null;
  if (!scan && deps) scan = tryHydrateDiscoverSession(scanId, deps);
  if (!scan) throw new Error(missingMessage);
  if (deps && !scan.running) {
    if (usesSimulatedMode(deps) !== scan.result.simulated) {
      throw new Error(
        `This session cannot continue: it was created with ${scan.result.simulated ? 'simulated' : 'live'} data and current settings use ${
          usesSimulatedMode(deps) ? 'simulated' : 'live'
        } data. Start a new scan instead.`,
      );
    }
    scan.deps = deps;
  }
  return scan;
}

export function continueSmartScan(scanId: string, body: unknown = {}, deps?: SmartScanDeps): SmartScanResult {
  const request = smartScanMoreRequestSchema.parse(body ?? {});
  const scan = resolveScan(
    scanId,
    deps,
    'Smart Scan session was not found. Open View Saved Results, then use Scan More Contracts to continue.',
  );
  if (scan.running) throw new Error('A Smart Scan operation is already running.');
  const priority = request.priority ?? scan.result.scanPriority;
  let count = Math.min(request.count, SMART_SCAN_MAX_BUDGET);
  if (isLiveDiagnostic(scan.deps)) {
    const remaining = Math.max(0, SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET - scan.evaluatedOcc.size);
    if (remaining === 0) {
      throw new Error(
        `Live Smart Scan diagnostic already evaluated ${SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET} contracts — no further evaluations allowed.`,
      );
    }
    count = Math.min(count, remaining);
  }
  const focus = request.mode === 'focus-ticker' ? request.focusTicker?.trim().toUpperCase() : undefined;
  beginOperation(scan, { batchKind: 'contracts', tickers: focus ? [focus] : [], budget: count });
  scan.result.scanPriority = priority;
  launch(scan, () => runContractsBatch(scan, count, priority, request.mode, focus));
  return structuredClone(scan.result);
}

/**
 * Scan Next Companies — claim the next `count` companies of the pinned queue.
 * The cursor advance is part of the claim, so two concurrent requests cannot both advance it.
 */
export function scanNextCompanies(scanId: string, body: unknown = {}, deps?: SmartScanDeps): SmartScanResult {
  const request = smartScanNextCompaniesRequestSchema.parse(body ?? {});
  const scan = resolveScan(
    scanId,
    deps,
    'Smart Scan session was not found. Open View Saved Results, then use Scan Next Companies to continue the same universe version.',
  );
  if (scan.running) throw new Error('A Smart Scan operation is already running.');
  const cursor = scan.companyCursor;
  const next = scan.orderedTickerQueue.slice(cursor, cursor + request.count);
  if (next.length === 0) {
    throw new Error('No unprocessed companies remain in this session universe queue.');
  }
  let budget = Math.min(request.evaluationBudget, SMART_SCAN_MAX_BUDGET);
  if (isLiveDiagnostic(scan.deps)) {
    assertLiveDiagnosticLimits(scan.deps, next, budget);
    budget = Math.min(budget, SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET);
  }
  const priority = request.priority ?? scan.result.scanPriority;
  beginOperation(scan, {
    batchKind: 'companies',
    tickers: next,
    budget,
    cursor: { expected: cursor, next: cursor + next.length },
  });
  scan.result.scanPriority = priority;
  scan.result.message = `Scan Next Companies: evaluating ${next.join(', ')} (companies ${cursor + 1}–${cursor + next.length} of ${scan.orderedTickerQueue.length}).`;
  launch(scan, () => runCompanyBatch(scan, next, budget));
  return structuredClone(scan.result);
}

/** Retry companies whose last attempt errored, was rate-limited, or was interrupted. Cursor unchanged. */
export function retrySmartScanCompanies(scanId: string, body: unknown = {}, deps?: SmartScanDeps): SmartScanResult {
  const request = smartScanRetryCompaniesRequestSchema.parse(body ?? {});
  const scan = resolveScan(scanId, deps, 'Smart Scan session was not found. Open View Saved Results first.');
  if (scan.running) throw new Error('A Smart Scan operation is already running.');
  const retryable = [...scan.tickers.values()]
    .filter((state) => isRetryableTickerStatus(state.progress.status))
    .map((state) => state.progress.ticker);
  const wanted = request.tickers ? new Set(normalizeTickerList(request.tickers).tickers) : null;
  const chosen = (wanted ? retryable.filter((ticker) => wanted.has(ticker)) : retryable).slice(0, SMART_SCAN_MAX_TICKERS);
  if (chosen.length === 0) throw new Error('No retryable companies in this session.');
  let budget = Math.min(request.evaluationBudget, SMART_SCAN_MAX_BUDGET);
  if (isLiveDiagnostic(scan.deps)) {
    assertLiveDiagnosticLimits(scan.deps, chosen, budget);
    budget = Math.min(budget, SMART_SCAN_LIVE_DIAGNOSTIC_MAX_BUDGET);
  }
  beginOperation(scan, { batchKind: 'retry', tickers: chosen, budget });
  scan.result.message = `Retrying ${chosen.join(', ')} (provider data is requested again).`;
  launch(scan, () => runCompanyBatch(scan, chosen, budget));
  return structuredClone(scan.result);
}

export function getSmartScan(scanId: string, persistSqlite?: Database.Database): SmartScanResult | null {
  const scan = sessions.get(scanId);
  if (scan) return structuredClone(scan.result);
  if (!persistSqlite) return null;
  const restored = loadDiscoverRestore(persistSqlite, scanId);
  return restored ? structuredClone(restored.result) : null;
}

export async function waitForSmartScan(scanId: string): Promise<SmartScanResult | null> {
  const scan = sessions.get(scanId);
  if (!scan) return null;
  if (scan.running) await scan.running;
  return structuredClone(scan.result);
}

export function cancelSmartScan(scanId: string): SmartScanResult | null {
  const scan = sessions.get(scanId);
  if (!scan) return null;
  scan.cancelRequested = true;
  if (scan.result.status === 'running') {
    scan.result.message = 'Cancellation requested. Waiting for the current quote batch to finish.';
  }
  return structuredClone(scan.result);
}

/** Drop in-memory sessions (tests, and to simulate a process restart). */
export function resetSmartScans(): void {
  sessions.clear();
}

export async function runSmartScanForTest(
  deps: SmartScanDeps,
  body: unknown,
  universe: ResolvedScanUniverse | null = null,
): Promise<SmartScanResult> {
  const started = startSmartScan(deps, body, universe);
  return (await waitForSmartScan(started.scanId))!;
}

export async function runSmartScanMoreForTest(scanId: string, body: unknown = {}, deps?: SmartScanDeps): Promise<SmartScanResult> {
  continueSmartScan(scanId, body, deps);
  return (await waitForSmartScan(scanId))!;
}

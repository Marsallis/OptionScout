import {
  FINDER_BATCH_SIZE,
  FINDER_DEFAULT_EVALUATION_BUDGET,
  FINDER_MAX_EVALUATION_BUDGET,
  RESEARCH_REDISCOVERY_NOTICE,
  SCAN_MORE_PRIORITY_LABELS,
  SHOW_PROFILE_MISSES,
  buildCandidateValidationCounters,
  finderRetryMissingRequestSchema,
  finderScanMoreRequestSchema,
  finderScanRequestSchema,
  type DiscoveryTolerances,
  type FinderCandidate,
  type FinderPlainProgress,
  type FinderScanRequest,
  type FinderScanResult,
  type ScanMorePriority,
  type StrategyProfile,
  selectEquitySpotPrice,
} from '@optionscout/shared';
import type { BrokerageReadClient } from '../brokerage/client.js';
import { buildFinderCandidate, incompleteUnsupportedCandidate } from './build-candidate.js';
import { nestedChainPath, parseNestedOptionChain, type NestedChainContract, type ParsedNestedChain } from './chain.js';
import {
  DEMO_SPOT,
  DEMO_UNDERLYING,
  demoEquityStreamer,
  demoNestedChainPayload,
  DemoFinderQuoteSource,
  isDemoFixtureSymbol,
} from './demo-chain.js';
import { isRegularUsEquitySession } from '../brokerage/market-hours.js';
import { resolveEquityStreamer } from './equities.js';
import { LiveFinderQuoteSource } from './live-quotes.js';
import type { FinderQuoteSource, UnderlyingObservation } from './quotes.js';
import {
  budgetsFromProfile,
  observationsFromCandidates,
  orderEligibleQueue,
  takeNextFromQueue,
} from './selection.js';
import { getObservationByStreamer, mergeLiveWithCache, upsertObservationFromSnapshot } from './observations.js';
import type Database from 'better-sqlite3';
import type { AppDatabase } from '../db/client.js';
import {
  ResearchClaimError,
  ResearchPersistenceError,
  abandonResearchBatch,
  claimResearchBatch,
  commitResearchProgress,
  createFinderSession,
  finderSessionColumns,
  loadFinderRestore,
  startClaimHeartbeat,
} from './research-sessions.js';

export interface FinderScanDeps {
  liveScanEnabled: boolean;
  brokerage: BrokerageReadClient | null;
  portfolioView: 'demo' | 'brokerage';
  /** Resolve a strategy by id (revision pinned for the life of the scan). */
  readProfile: (profileId?: string) => StrategyProfile;
  now?: () => Date;
  quoteSource?: FinderQuoteSource;
  chainPayload?: unknown;
  underlyingPrice?: string;
  delayBetweenBatchesMs?: number;
  /** Ideal / hard max for Stage A prioritization (dollars). Defaults from strategy profile. */
  idealCost?: number;
  hardMaxCost?: number;
  /** Optional durable last-known observations (live path). */
  database?: AppDatabase;
  /** When set, Finder research sessions persist to SQLite. */
  persistSqlite?: Database.Database;
  /** Test seam: stock observation used when a continuation refreshes the underlying price. */
  underlyingQuote?: (ticker: string) => Promise<UnderlyingObservation | null>;
  /** Claim lease renewal interval (tests shorten it). */
  claimHeartbeatMs?: number;
}

export type FinderTestDeps = Partial<
  Pick<FinderScanDeps, 'quoteSource' | 'chainPayload' | 'underlyingPrice' | 'now' | 'underlyingQuote' | 'claimHeartbeatMs'>
>;

interface MutableScan {
  result: FinderScanResult;
  cancelRequested: boolean;
  running: Promise<void> | null;
  deps: FinderScanDeps;
  profile: StrategyProfile;
  tolerances: DiscoveryTolerances;
  screeningFreshnessSeconds: number;
  queue: NestedChainContract[];
  queueOffset: number;
  evaluatedOcc: Set<string>;
  /** OCC symbols that were attempted (includes retry targets). Unique evaluated count uses this. */
  attemptedOcc: Set<string>;
  underlyingPrice: string | null;
  underlyingQuoteAt: string | null;
  underlyingBid: string | null;
  underlyingAsk: string | null;
  /** Why the stock price used for this operation is not a fresh observation, if it is not. */
  underlyingRefreshNote: string | null;
  quoteSource: FinderQuoteSource | null;
  liveQuoteSource: LiveFinderQuoteSource | null;
  parsed: ParsedNestedChain | null;
  unsupportedAdded: boolean;
  selectionAlgorithm: string;
  scanPriority: ScanMorePriority;
  activeBatchId: string | null;
  opUsed: number;
  pendingCandidates: FinderCandidate[];
  pendingOcc: string[];
  stopHeartbeat: (() => void) | null;
}

/** Commit pending Finder progress for the active claim. Throws ResearchPersistenceError on storage failure. */
function commitFinder(
  scan: MutableScan,
  finish?: { batchStatus: 'completed' | 'failed' | 'cancelled'; error: string | null },
): void {
  const sqlite = scan.deps.persistSqlite;
  const batchId = scan.activeBatchId;
  if (!sqlite || !batchId) {
    scan.pendingCandidates = [];
    scan.pendingOcc = [];
    return;
  }
  const cols = finderSessionColumns(scan.result);
  try {
    commitResearchProgress(sqlite, {
      sessionId: scan.result.scanId,
      batchId,
      status: scan.result.status,
      progressJson: cols.progressJson,
      metaJson: cols.metaJson,
      finishedAt: scan.result.finishedAt,
      candidates: scan.pendingCandidates,
      evaluatedOcc: scan.pendingOcc,
      evaluationCount: scan.opUsed,
      now: (scan.deps.now ?? (() => new Date()))(),
      finish,
    });
  } catch (error) {
    if (error instanceof ResearchClaimError) throw error;
    const detail = error instanceof Error ? error.message : 'unknown storage error';
    throw new ResearchPersistenceError(
      `Research progress could not be saved (${detail}). The scan was stopped so unsaved work is not reported as saved.`,
    );
  }
  scan.pendingCandidates = [];
  scan.pendingOcc = [];
}

/** Take the session claim synchronously so overlapping operations are rejected before any provider call. */
function beginFinderOperation(scan: MutableScan, budget: number): void {
  if (scan.running) throw new Error('A scan operation is already running.');
  const sqlite = scan.deps.persistSqlite;
  if (sqlite) {
    const claim = claimResearchBatch(sqlite, {
      sessionId: scan.result.scanId,
      batchKind: 'contracts',
      tickers: [scan.result.underlying],
      evaluationBudget: budget,
      now: (scan.deps.now ?? (() => new Date()))(),
    });
    scan.activeBatchId = claim.batchId;
    scan.stopHeartbeat?.();
    scan.stopHeartbeat = startClaimHeartbeat(sqlite, {
      sessionId: scan.result.scanId,
      batchId: claim.batchId,
      now: () => (scan.deps.now ?? (() => new Date()))(),
      intervalMs: scan.deps.claimHeartbeatMs,
      onLost: () => {
        if (scan.running && scan.activeBatchId === claim.batchId) scan.cancelRequested = true;
      },
    });
  }
  scan.opUsed = 0;
  scan.cancelRequested = false;
}

/** Final commit + claim release. Storage failures are surfaced on the result, never swallowed. */
function finishFinderOperation(scan: MutableScan): void {
  scan.stopHeartbeat?.();
  scan.stopHeartbeat = null;
  const status = scan.result.status;
  const batchStatus = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';
  try {
    commitFinder(scan, { batchStatus, error: scan.result.error });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research progress could not be saved.';
    scan.result.status = 'failed';
    scan.result.error = message;
    scan.result.message = message;
    if (scan.deps.persistSqlite && scan.activeBatchId && error instanceof ResearchPersistenceError) {
      abandonResearchBatch(scan.deps.persistSqlite, scan.result.scanId, scan.activeBatchId, message);
    }
  } finally {
    scan.activeBatchId = null;
  }
}

const scans = new Map<string, MutableScan>();

function asOfDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function createScanId(now: Date): string {
  return `scan_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function moneyNumber(value: string): number {
  return Number(value);
}

function coverageSummary(scan: MutableScan): string {
  const p = scan.result.progress;
  const mode = scan.result.mode;
  if (p.exhausted) {
    const scope =
      mode === 'demo-fixture'
        ? 'All eligible contracts in this labeled demo universe were examined. That is not market-wide coverage.'
        : 'All supported eligible contracts discovered for this ticker in this scan were examined. Live chains can still change.';
    return `${p.eligibleLeaps} eligible LEAPS. Fully evaluated ${p.fullyEvaluated}, partial ${p.partiallyEvaluated}, remaining 0. ${scope}`;
  }
  return (
    `${p.eligibleLeaps} eligible LEAPS. Fully evaluated ${p.fullyEvaluated}, partial ${p.partiallyEvaluated}, ` +
    `not yet evaluated ${p.notYetEvaluated}. A completed batch is not completion of the full eligible universe.`
  );
}

function buildCoverageNotes(scan: MutableScan): FinderScanResult['coverageNotes'] {
  const candidates = scan.result.candidates;
  const remaining = scan.result.progress.notYetEvaluated;
  const exhausted = scan.result.progress.exhausted;
  const supported = candidates.filter((row) => row.supportStatus === 'supported');
  const notes: FinderScanResult['coverageNotes'] = [];
  const hardMax = moneyNumber(scan.profile.hard.maxContractCost);
  const hardDelta = Number(scan.profile.hard.minLongDelta);
  const inBudget = supported.filter((row) => {
    const cost = row.calculations.estimatedPurchaseCost;
    return cost != null && moneyNumber(cost) <= hardMax;
  });
  const withDelta = supported.filter((row) => row.delta != null && Number(row.delta) >= hardDelta);
  const both = supported.filter(
    (row) =>
      row.calculations.estimatedPurchaseCost != null &&
      moneyNumber(row.calculations.estimatedPurchaseCost) <= hardMax &&
      row.delta != null &&
      Number(row.delta) >= hardDelta,
  );
  const missingAsk = supported.filter((row) => row.ask == null);
  const missingGreeks = supported.filter((row) => row.flags.missingGreeks);
  const liquidityOnly = supported.filter((row) => row.meetsConfiguredNumericRequirements && row.liquidityUnassessed);

  if (inBudget.length > 0) {
    notes.push({
      code: 'has-in-budget',
      text: `${inBudget.length} evaluated contract(s) have ask-based cost at or below the $${hardMax.toLocaleString('en-US')} hard maximum.`,
    });
  } else if (supported.length === 0) {
    notes.push({
      code: 'insufficient-evaluation',
      text: 'Not enough candidates evaluated to determine whether an in-budget contract exists.',
    });
  } else if (!exhausted && remaining > 0) {
    notes.push({
      code: 'insufficient-evaluation',
      text: `No in-budget contract among the ${supported.length} evaluated candidates yet. ${remaining} remain — Scan More will prioritize nearer estimated budget using observed asks (hints only).`,
    });
  } else {
    notes.push({
      code: 'none-in-budget-among-evaluated',
      text: 'No qualifying in-budget contract exists among the evaluated candidates.',
    });
  }

  if (both.length === 0 && inBudget.length > 0 && withDelta.length > 0) {
    notes.push({
      code: 'budget-delta-conflict',
      text:
        remaining > 0
          ? `No evaluated contract meets both the $${hardMax.toLocaleString('en-US')} budget and the ${hardDelta} minimum delta. ${remaining} contracts remain unexamined.`
          : `No evaluated contract meets both the $${hardMax.toLocaleString('en-US')} budget and the ${hardDelta} minimum delta among the examined set.`,
    });
  }

  if (missingAsk.length > 0) {
    notes.push({
      code: 'quotes-unavailable',
      text: `${missingAsk.length} evaluated contract(s) are missing a valid ask, so purchase cost is incomplete for those rows.`,
    });
  }

  if (missingGreeks.length > 0) {
    const liveGreek = scan.liveQuoteSource?.lastGreekCoverage;
    const liveDetail =
      liveGreek && liveGreek.status !== 'not-subscribed'
        ? ` Last DXLink Greek poll: ${liveGreek.received} received, ${liveGreek.missing} missing (${liveGreek.status} after ${liveGreek.waitedMs}ms). Unavailable Greek events are not protocol failures.`
        : ' Closed-session feeds often omit Greek events.';
    notes.push({
      code: 'missing-greeks-common',
      text: `${missingGreeks.length} evaluated contract(s) lack provider Greeks. Missing deltas stay null/incomplete — not fabricated.${liveDetail}`,
    });
  }

  if (exhausted && inBudget.length === 0 && supported.some((row) => row.outcome === 'outside-profile')) {
    notes.push({
      code: 'constraints-restrictive',
      text: 'Among examined contracts, hard requirements appear mutually restrictive with available strikes (for example cost vs delta vs expiration).',
    });
  }

  if (liquidityOnly.length > 0) {
    notes.push({
      code: 'liquidity-unassessed-only',
      text: `${liquidityOnly.length} contract(s) meet configured numeric requirements — liquidity unassessed (bid/ask, OI, and volume thresholds remain unconfigured).`,
    });
  }

  if (/[Rr]efined with \d+ observed|Unified reorder/.test(scan.selectionAlgorithm)) {
    notes.push({
      code: 'adaptive-refinement-applied',
      text: 'Remaining contracts were reordered with the unified selection engine using observed asks as prioritization hints only — not displayed prices.',
    });
  }

  notes.push({
    code: 'scan-priority-applied',
    text: `Search priority “${SCAN_MORE_PRIORITY_LABELS[scan.scanPriority].label}” guides which unevaluated contracts are checked next. It is not an investment-quality score.`,
  });

  return notes;
}

function buildPlainProgress(scan: MutableScan): FinderPlainProgress {
  const p = scan.result.progress;
  const hardMax = moneyNumber(scan.profile.hard.maxContractCost);
  const supported = scan.result.candidates.filter((row) => row.supportStatus === 'supported');
  const withinHardBudget = supported.filter(
    (row) => row.calculations.estimatedPurchaseCost != null && moneyNumber(row.calculations.estimatedPurchaseCost) <= hardMax,
  ).length;
  const meetsAssessable = supported.filter((row) => row.meetsConfiguredNumericRequirements).length;
  const incompleteMissingData = supported.filter((row) => row.outcome === 'incomplete').length;
  const strikes = supported.map((row) => Number(row.strike)).filter((value) => Number.isFinite(value));
  const stock = scan.underlyingPrice == null ? null : Number(scan.underlyingPrice);
  let moneynessCoverage = 'Not enough evaluated contracts to describe moneyness coverage yet.';
  if (stock != null && Number.isFinite(stock) && strikes.length > 0) {
    const deep = strikes.filter((strike) => stock - strike >= 40).length;
    const mid = strikes.filter((strike) => stock - strike >= 15 && stock - strike < 40).length;
    const near = strikes.filter((strike) => stock - strike < 15).length;
    moneynessCoverage = `Among evaluated calls: ${deep} deeper ITM, ${mid} mid ITM, ${near} nearer ATM/OTM (by strike vs stock).`;
  }
  const batchStatus: FinderPlainProgress['batchStatus'] = scan.result.status === 'running'
    ? 'running'
    : scan.result.status === 'cancelled'
      ? 'cancelled'
      : scan.result.status === 'failed'
        ? 'failed'
        : p.exhausted
          ? 'universe-examined'
          : 'batch-finished';
  const nextStepHint = p.canScanMore
    ? 'Use Scan More to examine more eligible contracts with your selected priority. Use Retry Missing Data only to refill quotes/Greeks on rows already attempted.'
    : p.exhausted
      ? 'Every eligible contract in this scan was attempted. Start a new search to refresh quotes or change strategy.'
      : 'Review the contracts below, adjust display filters (no new market requests), or start a new search.';
  const counters = buildCandidateValidationCounters(supported, p.notYetEvaluated);
  const rejectParts = Object.entries(counters.rejectionBreakdown)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => `${code}=${count}`);
  const countLine = `Counts: attempted ${counters.attempted}; with prices ${counters.withPrices}; with Greeks ${counters.withGreeks}; validated OK ${counters.validatedOk}; rejected (${rejectParts.length > 0 ? rejectParts.join(', ') : 'none'}); strategy-assessed ${counters.strategyAssessed}; meet hard numerical ${counters.meetHardNumerical}; unevaluated ${counters.unevaluated}.`;
  const headline =
    batchStatus === 'universe-examined'
      ? `Finished examining all ${p.eligibleLeaps} eligible long-dated calls for this scan. ${countLine}`
      : batchStatus === 'batch-finished'
        ? `This batch finished. ${p.notYetEvaluated} eligible contracts are still unexamined — that does not mean none are suitable. ${countLine}`
        : `${scan.result.message} ${countLine}`;
  return {
    headline,
    eligibleMeaning:
      '“Eligible” means supported long-dated calls that meet initial chain criteria (call type, streamer symbol, expiration window). It does not mean the contract is a good investment.',
    batchStatus,
    eligibleLongDatedCalls: p.eligibleLeaps,
    uniqueContractsAttempted: scan.attemptedOcc.size,
    fullyEvaluated: p.fullyEvaluated,
    partiallyEvaluated: p.partiallyEvaluated,
    notYetEvaluated: p.notYetEvaluated,
    withinHardBudget,
    meetsAssessableNumericRequirements: meetsAssessable,
    incompleteMissingData,
    expirationCoverage: `${p.expirationsRepresented} of ${p.expirationsEligible} eligible expirations represented in evaluated rows.`,
    moneynessCoverage,
    snapshotSource: scan.result.marketContext.dataSource,
    snapshotAt: scan.result.marketContext.underlyingQuoteAt ?? scan.result.finishedAt,
    nextStepHint,
    validationCounters: counters,
  };
}

function refreshProgress(scan: MutableScan, operationBudget: number): void {
  const eligible = scan.result.progress.eligibleLeaps;
  const evaluated = scan.result.progress.evaluated;
  const supported = scan.result.candidates.filter((row) => row.supportStatus === 'supported');
  const fullyEvaluated = supported.filter((row) => row.ask != null && !row.flags.missingGreeks).length;
  const partiallyEvaluated = supported.filter((row) => row.ask == null || row.flags.missingGreeks).length;
  const remaining = Math.max(0, eligible - evaluated);
  const exhausted = remaining === 0 && eligible > 0;
  const missingProviderGreeks = supported.filter((row) => row.flags.missingGreeks).length;
  const missingValidQuotes = supported.filter((row) => row.ask == null || row.flags.crossedMarket || row.flags.invalidPrice).length;
  const hardMax = moneyNumber(scan.profile.hard.maxContractCost);
  const withinHardBudget = supported.filter(
    (row) => row.calculations.estimatedPurchaseCost != null && moneyNumber(row.calculations.estimatedPurchaseCost) <= hardMax,
  ).length;
  const meetsAssessableNumericRequirements = supported.filter((row) => row.meetsConfiguredNumericRequirements).length;
  const incompleteMissingData = supported.filter((row) => row.outcome === 'incomplete').length;
  const expirationsRepresented = new Set(supported.map((row) => row.expiration)).size;
  const requestBudget =
    (scan.liveQuoteSource?.requestCount.rest ?? 0) +
    (scan.liveQuoteSource?.requestCount.dxlinkBatches ?? 0) +
    (scan.liveQuoteSource?.requestCount.quoteToken ?? 0);
  const canRetryMissingData =
    supported.some((row) => row.ask == null || row.flags.missingGreeks) &&
    scan.result.status !== 'cancelled' &&
    scan.result.status !== 'failed';

  scan.result.progress.remaining = remaining;
  scan.result.progress.notYetEvaluated = remaining;
  scan.result.progress.fullyEvaluated = fullyEvaluated;
  scan.result.progress.partiallyEvaluated = partiallyEvaluated;
  scan.result.progress.missingProviderGreeks = missingProviderGreeks;
  scan.result.progress.missingValidQuotes = missingValidQuotes;
  scan.result.progress.withinHardBudget = withinHardBudget;
  scan.result.progress.meetsAssessableNumericRequirements = meetsAssessableNumericRequirements;
  scan.result.progress.incompleteMissingData = incompleteMissingData;
  scan.result.progress.expirationsRepresented = expirationsRepresented;
  scan.result.progress.estimatedRequestBudgetUsed = requestBudget;
  scan.result.progress.canRetryMissingData = canRetryMissingData;
  scan.result.progress.lastScanPriority = scan.scanPriority;
  scan.result.progress.exhausted = exhausted;
  scan.result.progress.canScanMore = remaining > 0 && scan.result.status !== 'cancelled' && scan.result.status !== 'failed';
  scan.result.progress.partial = !exhausted;
  scan.result.progress.evaluationBudget = operationBudget;
  scan.result.progress.coverageSummary = coverageSummary(scan);
  scan.result.progress.selectionAlgorithm = scan.selectionAlgorithm;
  scan.result.progress.plain = buildPlainProgress(scan);
  scan.result.progress.rejectionBreakdown = scan.result.progress.plain.validationCounters?.rejectionBreakdown ?? {};
  scan.result.scanPriority = scan.scanPriority;
  scan.result.coverageNotes = buildCoverageNotes(scan);
}

function usesDemoFixture(deps: FinderScanDeps): boolean {
  return !deps.liveScanEnabled || deps.portfolioView === 'demo' || !deps.brokerage;
}

async function loadChainPayload(deps: FinderScanDeps, underlying: string): Promise<{ payload: unknown; mode: 'demo-fixture' | 'live-gated' }> {
  if (deps.chainPayload !== undefined) {
    return { payload: deps.chainPayload, mode: deps.liveScanEnabled && deps.portfolioView === 'brokerage' ? 'live-gated' : 'demo-fixture' };
  }
  if (usesDemoFixture(deps)) {
    const symbol = underlying.trim().toUpperCase();
    if (!isDemoFixtureSymbol(symbol)) {
      throw new Error(
        `Demo Mode only scans the fictional ticker ${DEMO_UNDERLYING}. Real symbols such as ${symbol} require Authenticated brokerage view with installation FINDER_LIVE_SCAN=true and owner on-demand search enabled in Settings.`,
      );
    }
    return { payload: demoNestedChainPayload(symbol), mode: 'demo-fixture' };
  }
  const payload = await deps.brokerage!.getJson(nestedChainPath(underlying));
  return { payload, mode: 'live-gated' };
}

function setMarketContext(
  scan: MutableScan,
  input: {
    mode: 'demo-fixture' | 'live-gated';
    underlyingPrice: string | null;
    underlyingQuoteAt: string | null;
    quoteSkewWarning?: string | null;
  },
): void {
  const now = (scan.deps.now ?? (() => new Date()))();
  const simulated = input.mode === 'demo-fixture';
  scan.result.marketContext = {
    underlyingPrice: input.underlyingPrice,
    underlyingQuoteAt: input.underlyingQuoteAt,
    marketSession: isRegularUsEquitySession(now) ? 'regular' : 'closed',
    dataSource: simulated
      ? 'SIMULATED demo-fixture (local labeled universe — not a brokerage chain)'
      : 'tastytrade nested option chain + equity/option quotes (read-only)',
    simulated,
    simulatedNotice: simulated ? 'SIMULATED DATA — NOT ACTUAL MARKET PRICES' : null,
    quoteSkewWarning: input.quoteSkewWarning ?? null,
  };
}

async function createQuoteSource(
  scan: MutableScan,
  selected: readonly NestedChainContract[],
  underlying: string,
  nowIso: string,
): Promise<FinderQuoteSource> {
  if (scan.deps.quoteSource) return scan.deps.quoteSource;
  if (usesDemoFixture(scan.deps)) {
    return new DemoFinderQuoteSource(scan.deps.underlyingPrice ?? DEMO_SPOT, nowIso, {
      afterHours: true,
      providerTimestamp: true,
    });
  }
  const brokerage = scan.deps.brokerage;
  if (!brokerage) {
    throw new Error('Live Finder requires an authenticated brokerage client.');
  }
  const equity = await resolveEquityStreamer(brokerage, underlying);
  const restSymbolByStreamer = new Map<string, { symbol: string; kind: 'equity' | 'equity-option' }>();
  restSymbolByStreamer.set(equity.streamerSymbol, { symbol: equity.returnedSymbol, kind: 'equity' });
  for (const contract of selected) {
    if (contract.streamerSymbol) {
      restSymbolByStreamer.set(contract.streamerSymbol, { symbol: contract.occSymbol, kind: 'equity-option' });
    }
  }
  // Register remaining queue symbols for later Scan More batches.
  for (const contract of scan.queue) {
    if (contract.streamerSymbol && !restSymbolByStreamer.has(contract.streamerSymbol)) {
      restSymbolByStreamer.set(contract.streamerSymbol, { symbol: contract.occSymbol, kind: 'equity-option' });
    }
  }
  const live = new LiveFinderQuoteSource({
    client: brokerage,
    restSymbolByStreamer,
    collectMs: 4000,
    now: scan.deps.now,
  });
  await live.start();
  scan.liveQuoteSource = live;
  return live;
}

async function resolveUnderlyingQuote(
  scan: MutableScan,
  underlying: string,
  quoteSource: FinderQuoteSource,
): Promise<{ price: string | null; quoteAt: string | null; bid: string | null; ask: string | null }> {
  if (scan.deps.underlyingQuote) {
    const observed = await scan.deps.underlyingQuote(underlying);
    return observed ?? { price: null, quoteAt: null, bid: null, ask: null };
  }
  if (scan.deps.underlyingPrice) {
    return { price: scan.deps.underlyingPrice, quoteAt: (scan.deps.now ?? (() => new Date()))().toISOString(), bid: null, ask: null };
  }
  if (quoteSource instanceof DemoFinderQuoteSource) {
    const row = quoteSource.underlyingQuote(demoEquityStreamer(underlying));
    return { price: row.ask, quoteAt: row.providerEventAt ?? row.receivedAt, bid: null, ask: null };
  }
  if (!scan.deps.liveScanEnabled || !scan.deps.brokerage) {
    return { price: DEMO_SPOT, quoteAt: (scan.deps.now ?? (() => new Date()))().toISOString(), bid: null, ask: null };
  }
  const equity = await resolveEquityStreamer(scan.deps.brokerage, underlying);
  scan.liveQuoteSource?.registerRestSymbol(equity.streamerSymbol, equity.returnedSymbol, 'equity');
  const quotes = await quoteSource.fetchQuotes([equity.streamerSymbol]);
  const row = quotes.get(equity.streamerSymbol);
  if (row && scan.deps.database) {
    upsertObservationFromSnapshot(scan.deps.database, {
      snapshot: row,
      instrumentKind: 'equity',
      underlying,
      now: (scan.deps.now ?? (() => new Date()))(),
    });
  }
  return {
    price: selectEquitySpotPrice(row?.bid ?? null, row?.ask ?? null, row?.mark ?? null),
    quoteAt: row?.providerEventAt ?? row?.receivedAt ?? null,
    bid: row?.bid ?? null,
    ask: row?.ask ?? null,
  };
}

/**
 * Before a continuation evaluates new option quotes, observe the stock price again so each new
 * candidate pairs observations from the same trading session. Earlier candidates keep the stock
 * price stored in their own snapshot. Returns a plain-language note for the result message.
 */
async function refreshFinderUnderlying(scan: MutableScan): Promise<string> {
  const savedAt = scan.underlyingQuoteAt;
  let failure: string;
  try {
    const resolved = await resolveUnderlyingQuote(scan, scan.result.underlying, scan.quoteSource!);
    if (resolved.price && resolved.quoteAt) {
      scan.underlyingPrice = resolved.price;
      scan.underlyingQuoteAt = resolved.quoteAt;
      scan.underlyingBid = resolved.bid;
      scan.underlyingAsk = resolved.ask;
      scan.underlyingRefreshNote = null;
      setMarketContext(scan, { mode: scan.result.mode, underlyingPrice: resolved.price, underlyingQuoteAt: resolved.quoteAt });
      return savedAt && savedAt !== resolved.quoteAt
        ? ` Stock price re-observed at ${resolved.quoteAt}; earlier results keep the stock price they were evaluated with (originally ${savedAt}).`
        : '';
    }
    failure = 'no stock quote was returned';
  } catch (error) {
    failure = error instanceof Error ? error.message : 'stock quote request failed';
  }
  scan.underlyingBid = null;
  scan.underlyingAsk = null;
  scan.underlyingRefreshNote =
    `A current stock price could not be retrieved (${failure}); the saved price from ` +
    `${savedAt ?? 'an unknown time'} is trusted only for option quotes from that same trading session.`;
  return ` ${scan.underlyingRefreshNote}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluateBatch(scan: MutableScan, batch: readonly NestedChainContract[], operationBudget: number): Promise<void> {
  if (!scan.quoteSource || scan.underlyingPrice == null) {
    throw new Error('Scan quote source is not ready.');
  }
  const nowFn = scan.deps.now ?? (() => new Date());
  const asOf = scan.result.asOfDate;
  const candidates = [...scan.result.candidates];
  scan.result.candidates = candidates;

  for (let index = 0; index < batch.length; index += FINDER_BATCH_SIZE) {
    if (scan.cancelRequested) {
      scan.result.status = 'cancelled';
      scan.result.progress.cancelled = true;
      scan.result.progress.canScanMore = false;
      scan.result.message =
        'Scan cancelled. Results below reflect only the contracts evaluated before cancellation. The full eligible set was not processed.';
      scan.result.finishedAt = nowFn().toISOString();
      refreshProgress(scan, operationBudget);
      return;
    }

    const slice = batch.slice(index, index + FINDER_BATCH_SIZE);
    scan.result.progress.awaitingData = Math.max(0, batch.length - index);
    const streamers = slice.map((row) => row.streamerSymbol!).filter(Boolean);
    if (scan.liveQuoteSource) {
      for (const contract of slice) {
        if (contract.streamerSymbol) {
          scan.liveQuoteSource.registerRestSymbol(contract.streamerSymbol, contract.occSymbol, 'equity-option');
        }
      }
    }
    const quotes = await scan.quoteSource.fetchQuotes(streamers);
    const now = nowFn();

    for (const contract of slice) {
      let quote = contract.streamerSymbol ? quotes.get(contract.streamerSymbol) ?? null : null;
      if (scan.deps.database && contract.streamerSymbol) {
        if (quote && (quote.ask != null || quote.delta != null)) {
          upsertObservationFromSnapshot(scan.deps.database, {
            snapshot: quote,
            instrumentKind: 'equity-option',
            underlying: contract.underlying,
            occSymbol: contract.occSymbol,
            underlyingProviderEventAt: scan.underlyingQuoteAt,
            now,
          });
        }
        const cached = getObservationByStreamer(scan.deps.database, contract.streamerSymbol);
        quote = mergeLiveWithCache(quote, cached, now);
      }
      const candidate = buildFinderCandidate({
        contract,
        underlyingPrice: scan.underlyingPrice,
        underlyingQuoteAt: scan.underlyingQuoteAt,
        underlyingBid: scan.underlyingBid,
        underlyingAsk: scan.underlyingAsk,
        underlyingRefreshNote: scan.underlyingRefreshNote,
        quote,
        profile: scan.profile,
        tolerances: scan.tolerances,
        asOfDate: asOf,
        now,
        screeningFreshnessSeconds: scan.screeningFreshnessSeconds,
      });
      candidates.push(candidate);
      scan.pendingCandidates.push(candidate);
      scan.pendingOcc.push(contract.occSymbol);
      scan.opUsed += 1;
      scan.evaluatedOcc.add(contract.occSymbol);
      scan.attemptedOcc.add(contract.occSymbol);
      scan.result.progress.evaluated = scan.attemptedOcc.size;
      if (!quote || quote.ask == null) scan.result.progress.unavailableData += 1;
      refreshProgress(scan, operationBudget);
      commitFinder(scan);
    }

    if (scan.deps.delayBetweenBatchesMs && index + FINDER_BATCH_SIZE < batch.length) {
      await sleep(scan.deps.delayBetweenBatchesMs);
    }
  }
}

async function runInitialScan(scan: MutableScan, request: FinderScanRequest): Promise<void> {
  const nowFn = scan.deps.now ?? (() => new Date());
  const budget = Math.min(request.evaluationBudget, FINDER_MAX_EVALUATION_BUDGET);

  try {
    const { payload, mode } = await loadChainPayload(scan.deps, request.underlying);
    scan.result.mode = mode;
    if (request.underlying.trim().toUpperCase() === 'MISSING' && mode === 'demo-fixture') {
      scan.result.status = 'failed';
      scan.result.error = 'Underlying symbol is unavailable.';
      scan.result.message = 'No option chain was returned for that ticker.';
      scan.result.finishedAt = nowFn().toISOString();
      setMarketContext(scan, { mode, underlyingPrice: null, underlyingQuoteAt: null });
      return;
    }

    const parsed = parseNestedOptionChain(payload, request.underlying);
    scan.parsed = parsed;
    scan.result.underlying = parsed.underlying;
    scan.result.progress.discovered = parsed.discovered;
    scan.result.progress.standardCalls = parsed.standardCalls;
    scan.result.progress.putsDiscovered = parsed.putsDiscovered;
    scan.result.progress.unsupportedAdjusted = parsed.unsupportedAdjusted;
    scan.result.progress.missingStreamer = parsed.missingStreamer;

    // Bootstrap quote source with empty registration, resolve underlying, then build queue.
    const bootstrapSource =
      scan.deps.quoteSource ??
      (usesDemoFixture(scan.deps)
        ? new DemoFinderQuoteSource(scan.deps.underlyingPrice ?? DEMO_SPOT, nowFn().toISOString(), { providerTimestamp: true })
        : null);

    let underlyingPrice = scan.deps.underlyingPrice ?? null;
    let underlyingQuoteAt: string | null = null;
    if (bootstrapSource) {
      scan.quoteSource = bootstrapSource;
      const resolved = await resolveUnderlyingQuote(scan, parsed.underlying, bootstrapSource);
      underlyingPrice = resolved.price;
      underlyingQuoteAt = resolved.quoteAt;
    } else if (scan.deps.brokerage) {
      // Live path: resolve equity first via REST through a temporary live source with equity only.
      const equity = await resolveEquityStreamer(scan.deps.brokerage, parsed.underlying);
      const restSymbolByStreamer = new Map<string, { symbol: string; kind: 'equity' | 'equity-option' }>([
        [equity.streamerSymbol, { symbol: equity.returnedSymbol, kind: 'equity' }],
      ]);
      const live = new LiveFinderQuoteSource({
        client: scan.deps.brokerage,
        restSymbolByStreamer,
        collectMs: 3000,
        now: scan.deps.now,
      });
      await live.start();
      scan.liveQuoteSource = live;
      scan.quoteSource = live;
      const quotes = await live.fetchQuotes([equity.streamerSymbol]);
      const equityQuote = quotes.get(equity.streamerSymbol);
      scan.underlyingBid = equityQuote?.bid ?? null;
      scan.underlyingAsk = equityQuote?.ask ?? null;
      underlyingPrice = selectEquitySpotPrice(
        equityQuote?.bid ?? null,
        equityQuote?.ask ?? null,
        equityQuote?.mark ?? null,
      );
      underlyingQuoteAt = equityQuote?.providerEventAt ?? equityQuote?.receivedAt ?? null;
    }

    if (mode === 'live-gated' && (underlyingPrice == null || underlyingPrice === '')) {
      scan.result.status = 'failed';
      scan.result.error = 'Underlying quote unavailable.';
      scan.result.message =
        'Live Finder could not retrieve an underlying stock price. Intrinsic value and moneyness cannot be calculated without it.';
      scan.result.finishedAt = nowFn().toISOString();
      setMarketContext(scan, { mode, underlyingPrice: null, underlyingQuoteAt });
      return;
    }

    scan.underlyingPrice = underlyingPrice;
    scan.underlyingQuoteAt = underlyingQuoteAt;
    setMarketContext(scan, { mode, underlyingPrice, underlyingQuoteAt });
    const budgets = {
      ...budgetsFromProfile(scan.profile),
      idealCost: scan.deps.idealCost ?? moneyNumber(scan.profile.preferences.idealContractCost),
      hardMaxCost: scan.deps.hardMaxCost ?? moneyNumber(scan.profile.hard.maxContractCost),
    };
    // Same unified engine as Scan More — priority + strategy budgets guide order only.
    const plan = orderEligibleQueue({
      contracts: parsed.contracts,
      stockPrice: underlyingPrice,
      budgets,
      priority: scan.scanPriority,
    });
    scan.queue = plan.queue;
    scan.queueOffset = 0;
    scan.selectionAlgorithm = plan.algorithm;
    scan.result.progress.eligibleLeaps = plan.eligibleCount;
    scan.result.progress.expirationsEligible = plan.expirationsEligible;
    scan.result.progress.selectionAlgorithm = plan.algorithm;
    scan.result.progress.lastScanPriority = scan.scanPriority;

    if (!scan.quoteSource) {
      scan.quoteSource = await createQuoteSource(scan, [], parsed.underlying, nowFn().toISOString());
    } else if (scan.liveQuoteSource) {
      for (const contract of scan.queue) {
        if (contract.streamerSymbol) {
          scan.liveQuoteSource.registerRestSymbol(contract.streamerSymbol, contract.occSymbol, 'equity-option');
        }
      }
    }

    const candidates: FinderCandidate[] = [];
    if (!scan.unsupportedAdded) {
      for (const contract of parsed.contracts) {
        if (contract.optionType !== 'call') continue;
        if (contract.supportStatus === 'supported') continue;
        const unsupported = incompleteUnsupportedCandidate(
          contract,
          scan.profile,
          scan.tolerances,
          scan.result.asOfDate,
          nowFn(),
          scan.screeningFreshnessSeconds,
        );
        candidates.push(unsupported);
        scan.pendingCandidates.push(unsupported);
        scan.result.progress.unavailableData += 1;
      }
      scan.unsupportedAdded = true;
    }
    scan.result.candidates = candidates;

    const { batch, nextOffset } = takeNextFromQueue(scan.queue, scan.queueOffset, budget, scan.evaluatedOcc);
    scan.queueOffset = nextOffset;
    scan.result.progress.selectedForEvaluation = batch.length;
    refreshProgress(scan, budget);

    await evaluateBatch(scan, batch, budget);
    if (scan.result.progress.cancelled) return;

    scan.result.status = 'completed';
    scan.result.finishedAt = nowFn().toISOString();
    scan.result.progress.awaitingData = 0;
    refreshProgress(scan, budget);
    const passNote = scan.result.progress.exhausted
      ? ` This pass evaluated ${batch.length} contract(s).`
      : ` This pass evaluated ${batch.length} contract(s). Use Scan More to continue the remaining eligible set.`;
    const modeNote =
      mode === 'demo-fixture'
        ? ` SIMULATED DATA for fictional ${DEMO_UNDERLYING} only — not actual market prices for any real issuer. Live scans require FINDER_LIVE_SCAN=true plus the owner on-demand search setting.`
        : ' Live-gated read-only brokerage chain.';
    scan.result.message = `${scan.result.progress.coverageSummary}${passNote}${modeNote}`;
  } catch (error) {
    scan.result.status = 'failed';
    scan.result.error = error instanceof Error ? error.message : 'Scan failed.';
    scan.result.message = error instanceof Error ? error.message : 'The scan could not finish.';
    scan.result.finishedAt = nowFn().toISOString();
    scan.result.progress.canScanMore = false;
    if (!scan.result.marketContext.underlyingPrice && scan.underlyingPrice) {
      setMarketContext(scan, {
        mode: scan.result.mode,
        underlyingPrice: scan.underlyingPrice,
        underlyingQuoteAt: scan.underlyingQuoteAt,
      });
    }
  } finally {
    // Keep live session open for Scan More; diagnose script stops explicitly via reset.
  }
}

function rebuildRemainingQueue(scan: MutableScan, priority: ScanMorePriority): void {
  if (!scan.parsed) return;
  const budgets = {
    ...budgetsFromProfile(scan.profile),
    idealCost: scan.deps.idealCost ?? moneyNumber(scan.profile.preferences.idealContractCost),
    hardMaxCost: scan.deps.hardMaxCost ?? moneyNumber(scan.profile.hard.maxContractCost),
  };
  const observations = observationsFromCandidates(scan.result.candidates);
  const plan = orderEligibleQueue({
    contracts: scan.parsed.contracts,
    stockPrice: scan.underlyingPrice,
    budgets,
    priority,
    observations,
    alreadyEvaluated: scan.evaluatedOcc,
  });
  // Keep already-evaluated prefix empty; queue is remaining only, offset resets to 0.
  scan.queue = plan.queue;
  scan.queueOffset = 0;
  scan.scanPriority = priority;
  scan.selectionAlgorithm = plan.algorithm;
  scan.result.progress.selectionAlgorithm = plan.algorithm;
  scan.result.progress.lastScanPriority = priority;
}

/**
 * After a restart the parsed chain and quote source are not in memory. Re-request the chain
 * (disclosed) and keep the saved stock price; evaluated OCC symbols come from SQLite.
 */
async function rehydrateChain(scan: MutableScan): Promise<string> {
  const nowFn = scan.deps.now ?? (() => new Date());
  const { payload } = await loadChainPayload(scan.deps, scan.result.underlying);
  scan.parsed = parseNestedOptionChain(payload, scan.result.underlying);
  if (!scan.quoteSource) {
    scan.quoteSource = await createQuoteSource(scan, [], scan.result.underlying, nowFn().toISOString());
  }
  return ` ${RESEARCH_REDISCOVERY_NOTICE}`;
}

async function runScanMore(scan: MutableScan, count: number, priority?: ScanMorePriority): Promise<void> {
  const nowFn = scan.deps.now ?? (() => new Date());
  const budget = Math.min(count, FINDER_MAX_EVALUATION_BUDGET);
  scan.result.status = 'running';
  scan.result.finishedAt = null;
  try {
    const rediscoveryNote = scan.parsed ? '' : await rehydrateChain(scan);
    const nextPriority = priority ?? scan.scanPriority;
    // Same engine as Start Search: reorder remaining with strategy + priority + observed asks.
    rebuildRemainingQueue(scan, nextPriority);

    const { batch, nextOffset } = takeNextFromQueue(scan.queue, scan.queueOffset, budget, scan.evaluatedOcc);
    scan.queueOffset = nextOffset;
    scan.result.progress.selectedForEvaluation = batch.length;
    if (batch.length === 0) {
      scan.result.status = 'completed';
      scan.result.finishedAt = nowFn().toISOString();
      refreshProgress(scan, budget);
      scan.result.message = `${scan.result.progress.plain.headline}${rediscoveryNote}`;
      return;
    }
    const underlyingNote = await refreshFinderUnderlying(scan);
    await evaluateBatch(scan, batch, budget);
    if (scan.result.progress.cancelled) return;
    scan.result.status = 'completed';
    scan.result.finishedAt = nowFn().toISOString();
    scan.result.progress.awaitingData = 0;
    refreshProgress(scan, budget);
    scan.result.message = `${scan.result.progress.plain.headline} Scan More added ${batch.length} contract(s) using “${SCAN_MORE_PRIORITY_LABELS[nextPriority].label}”.${rediscoveryNote}${underlyingNote}`;
  } catch (error) {
    scan.result.status = 'failed';
    scan.result.error = error instanceof Error ? error.message : 'Scan More failed.';
    scan.result.message = 'The Scan More request could not finish.';
    scan.result.finishedAt = nowFn().toISOString();
    scan.result.progress.canScanMore = false;
  }
}

/**
 * Retry Missing Data — re-quote already-attempted rows that lack ask/Greeks.
 * Does not inflate unique evaluated-contract count; does not pull new OCC symbols.
 */
async function runRetryMissingData(scan: MutableScan, count: number): Promise<void> {
  const nowFn = scan.deps.now ?? (() => new Date());
  const budget = Math.min(count, FINDER_MAX_EVALUATION_BUDGET);
  scan.result.status = 'running';
  scan.result.finishedAt = null;
  try {
    if (!scan.parsed) await rehydrateChain(scan);
    if (!scan.quoteSource || !scan.parsed) {
      throw new Error('Scan quote source is not ready for retry.');
    }
    const incomplete = scan.result.candidates.filter(
      (row) =>
        row.supportStatus === 'supported' &&
        (row.ask == null || row.flags.missingGreeks) &&
        row.streamerSymbol != null,
    );
    const targets = incomplete.slice(0, budget);
    if (targets.length === 0) {
      scan.result.status = 'completed';
      scan.result.finishedAt = nowFn().toISOString();
      refreshProgress(scan, budget);
      scan.result.message = 'No evaluated contracts currently need a missing-data retry.';
      scan.result.coverageNotes = [
        ...scan.result.coverageNotes.filter((note) => note.code !== 'retry-missing-data'),
        { code: 'retry-missing-data', text: 'Retry Missing Data found no incomplete evaluated rows to refresh.' },
      ];
      return;
    }

    const byOcc = new Map(scan.parsed.contracts.map((row) => [row.occSymbol, row]));
    const batch = targets.map((row) => byOcc.get(row.occSymbol)).filter((row): row is NestedChainContract => row != null);
    const streamers = batch.map((row) => row.streamerSymbol!).filter(Boolean);
    if (scan.liveQuoteSource) {
      for (const contract of batch) {
        if (contract.streamerSymbol) {
          scan.liveQuoteSource.registerRestSymbol(contract.streamerSymbol, contract.occSymbol, 'equity-option');
        }
      }
    }
    const underlyingNote = await refreshFinderUnderlying(scan);
    const quotes = await scan.quoteSource.fetchQuotes(streamers);
    const greekStatus = scan.liveQuoteSource?.lastGreekCoverage.status ?? 'not-subscribed';
    const refreshed: FinderCandidate[] = [];
    for (const contract of batch) {
      const quote = contract.streamerSymbol ? quotes.get(contract.streamerSymbol) ?? null : null;
      refreshed.push(
        buildFinderCandidate({
          contract,
          underlyingPrice: scan.underlyingPrice,
          underlyingQuoteAt: scan.underlyingQuoteAt,
          underlyingBid: scan.underlyingBid,
          underlyingAsk: scan.underlyingAsk,
          underlyingRefreshNote: scan.underlyingRefreshNote,
          quote,
          profile: scan.profile,
          tolerances: scan.tolerances,
          asOfDate: scan.result.asOfDate,
          now: nowFn(),
          screeningFreshnessSeconds: scan.screeningFreshnessSeconds,
        }),
      );
      scan.attemptedOcc.add(contract.occSymbol);
    }
    const byId = new Map(refreshed.map((row) => [row.occSymbol, row]));
    scan.result.candidates = scan.result.candidates.map((row) => byId.get(row.occSymbol) ?? row);
    scan.pendingCandidates.push(...refreshed);
    scan.opUsed += refreshed.length;
    // Unique evaluated count stays attemptedOcc size — retries do not double-count.
    scan.result.progress.evaluated = scan.attemptedOcc.size;
    scan.result.status = 'completed';
    scan.result.finishedAt = nowFn().toISOString();
    refreshProgress(scan, budget);
    scan.result.coverageNotes = [
      ...scan.result.coverageNotes.filter((note) => note.code !== 'retry-missing-data'),
      {
        code: 'retry-missing-data',
        text: `Retry Missing Data refreshed ${batch.length} already-evaluated contract(s). Greek coverage status: ${greekStatus}. Unique attempted count unchanged at ${scan.attemptedOcc.size}.${underlyingNote}`,
      },
    ];
    scan.result.message = `${scan.result.progress.plain.headline}${underlyingNote}`;
  } catch (error) {
    scan.result.status = 'failed';
    scan.result.error = error instanceof Error ? error.message : 'Retry Missing Data failed.';
    scan.result.message = 'The Retry Missing Data request could not finish.';
    scan.result.finishedAt = nowFn().toISOString();
  }
}

function emptyPlainProgress(): FinderPlainProgress {
  return {
    headline: 'Scan not started.',
    eligibleMeaning:
      '“Eligible” means supported long-dated calls that meet initial chain criteria. It does not mean the contract is a good investment.',
    batchStatus: 'running',
    eligibleLongDatedCalls: 0,
    uniqueContractsAttempted: 0,
    fullyEvaluated: 0,
    partiallyEvaluated: 0,
    notYetEvaluated: 0,
    withinHardBudget: 0,
    meetsAssessableNumericRequirements: 0,
    incompleteMissingData: 0,
    expirationCoverage: 'No expirations evaluated yet.',
    moneynessCoverage: 'No moneyness coverage yet.',
    snapshotSource: 'pending',
    snapshotAt: null,
    nextStepHint: 'Start a search to evaluate contracts.',
  };
}

function emptyProgress(budget: number, priority: ScanMorePriority = 'closest-to-strategy'): FinderScanResult['progress'] {
  return {
    discovered: 0,
    standardCalls: 0,
    putsDiscovered: 0,
    unsupportedAdjusted: 0,
    missingStreamer: 0,
    eligibleLeaps: 0,
    evaluationBudget: budget,
    selectedForEvaluation: 0,
    evaluated: 0,
    fullyEvaluated: 0,
    partiallyEvaluated: 0,
    notYetEvaluated: 0,
    remaining: 0,
    awaitingData: 0,
    unavailableData: 0,
    missingProviderGreeks: 0,
    missingValidQuotes: 0,
    withinHardBudget: 0,
    meetsAssessableNumericRequirements: 0,
    incompleteMissingData: 0,
    expirationsEligible: 0,
    expirationsRepresented: 0,
    estimatedRequestBudgetUsed: 0,
    canRetryMissingData: false,
    lastScanPriority: priority,
    partial: true,
    cancelled: false,
    exhausted: false,
    canScanMore: false,
    batchSize: FINDER_BATCH_SIZE,
    coverageSummary: 'Scan not started.',
    selectionAlgorithm: 'pending',
    plain: emptyPlainProgress(),
  };
}

export function startFinderScan(deps: FinderScanDeps, body: unknown): FinderScanResult {
  const request = finderScanRequestSchema.parse(body);
  const profile = deps.readProfile(request.profileId);
  if (profile.id !== request.profileId) {
    throw new Error(`Strategy profile ${request.profileId} is not available.`);
  }

  const now = (deps.now ?? (() => new Date()))();
  const scanId = createScanId(now);
  const budget = request.evaluationBudget ?? FINDER_DEFAULT_EVALUATION_BUDGET;
  const priority = request.scanPriority ?? 'closest-to-strategy';
  const liveReady = deps.liveScanEnabled && deps.portfolioView === 'brokerage' && Boolean(deps.brokerage);
  const result: FinderScanResult = {
    scanId,
    status: 'running',
    mode: liveReady ? 'live-gated' : 'demo-fixture',
    underlying: request.underlying.trim().toUpperCase(),
    profileId: profile.id,
    profileName: profile.name,
    profileRevision: profile.revision,
    scanPriority: priority,
    startedAt: now.toISOString(),
    finishedAt: null,
    asOfDate: asOfDate(now),
    screeningFreshnessSeconds: request.screeningFreshnessSeconds,
    message: 'Scan started.',
    progress: emptyProgress(budget, priority),
    coverageNotes: [],
    marketContext: {
      underlyingPrice: null,
      underlyingQuoteAt: null,
      marketSession: isRegularUsEquitySession(now) ? 'regular' : 'closed',
      dataSource: liveReady
        ? 'tastytrade nested option chain + equity/option quotes (read-only)'
        : 'SIMULATED demo-fixture (local labeled universe — not a brokerage chain)',
      simulated: !liveReady,
      simulatedNotice: liveReady ? null : 'SIMULATED DATA — NOT ACTUAL MARKET PRICES',
      quoteSkewWarning: null,
    },
    tolerances: request.tolerances ?? SHOW_PROFILE_MISSES,
    candidates: [],
    error: null,
  };

  const scan: MutableScan = {
    result,
    cancelRequested: false,
    running: null,
    deps,
    profile,
    tolerances: request.tolerances ?? SHOW_PROFILE_MISSES,
    screeningFreshnessSeconds: request.screeningFreshnessSeconds,
    queue: [],
    queueOffset: 0,
    evaluatedOcc: new Set(),
    attemptedOcc: new Set(),
    underlyingPrice: null,
    underlyingQuoteAt: null,
    underlyingBid: null,
    underlyingAsk: null,
    underlyingRefreshNote: null,
    quoteSource: null,
    liveQuoteSource: null,
    parsed: null,
    unsupportedAdded: false,
    selectionAlgorithm: 'pending',
    scanPriority: priority,
    activeBatchId: null,
    opUsed: 0,
    pendingCandidates: [],
    pendingOcc: [],
    stopHeartbeat: null,
  };
  if (deps.persistSqlite) {
    try {
      createFinderSession(deps.persistSqlite, { result: { ...result, sessionPersistence: 'sqlite' }, strategySnapshot: profile });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown storage error';
      throw new ResearchPersistenceError(`The research session could not be saved (${detail}). No scan was started.`);
    }
  }
  scans.set(scanId, scan);
  beginFinderOperation(scan, budget);
  launchFinder(scan, () => runInitialScan(scan, { ...request, evaluationBudget: budget, scanPriority: priority }));
  return structuredClone(result);
}

function launchFinder(scan: MutableScan, work: () => Promise<void>): void {
  scan.running = Promise.resolve()
    .then(work)
    .finally(() => {
      finishFinderOperation(scan);
      scan.running = null;
    });
}

/** Rebuild a Finder session from SQLite for an explicit continue action. No provider calls here. */
function tryHydrateFinderSession(scanId: string, deps: FinderScanDeps): MutableScan | null {
  if (!deps.persistSqlite) return null;
  const restored = loadFinderRestore(deps.persistSqlite, scanId);
  if (!restored) return null;
  const result = structuredClone(restored.result);
  const scan: MutableScan = {
    result,
    cancelRequested: false,
    running: null,
    deps,
    profile: restored.strategySnapshot,
    tolerances: result.tolerances,
    screeningFreshnessSeconds: result.screeningFreshnessSeconds,
    queue: [],
    queueOffset: 0,
    evaluatedOcc: new Set(restored.evaluatedOcc),
    attemptedOcc: new Set(restored.evaluatedOcc),
    underlyingPrice: result.marketContext.underlyingPrice,
    underlyingQuoteAt: result.marketContext.underlyingQuoteAt,
    underlyingBid: null,
    underlyingAsk: null,
    underlyingRefreshNote: null,
    quoteSource: null,
    liveQuoteSource: null,
    parsed: null,
    unsupportedAdded: true,
    selectionAlgorithm: result.progress.selectionAlgorithm,
    scanPriority: result.scanPriority,
    activeBatchId: null,
    opUsed: 0,
    pendingCandidates: [],
    pendingOcc: [],
    stopHeartbeat: null,
  };
  scans.set(scanId, scan);
  return scan;
}

function resolveFinderScan(scanId: string, deps?: FinderScanDeps): MutableScan {
  let scan = scans.get(scanId) ?? null;
  if (!scan && deps) scan = tryHydrateFinderSession(scanId, deps);
  if (!scan) throw new Error('Finder scan was not found.');
  if (scan.running) throw new Error('A scan operation is already running.');
  if (deps) {
    const demoNow = usesDemoFixture(deps);
    const demoThen = scan.result.mode === 'demo-fixture';
    if (deps.chainPayload === undefined && demoNow !== demoThen) {
      throw new Error(
        `This scan was created with ${demoThen ? 'simulated' : 'live'} data and current settings use ${
          demoNow ? 'simulated' : 'live'
        } data. Start a new search instead.`,
      );
    }
    scan.deps = deps;
  }
  if (scan.underlyingPrice == null) throw new Error('This scan cannot continue: it has no saved stock price.');
  return scan;
}

export function continueFinderScan(scanId: string, body: unknown = {}, deps?: FinderScanDeps): FinderScanResult {
  const request = finderScanMoreRequestSchema.parse(body ?? {});
  const scan = resolveFinderScan(scanId, deps);
  if (scan.result.progress.remaining === 0) {
    throw new Error('All eligible contracts have already been evaluated.');
  }
  beginFinderOperation(scan, request.count);
  scan.result.status = 'running';
  launchFinder(scan, () => runScanMore(scan, request.count, request.priority));
  return structuredClone(scan.result);
}

export function retryFinderMissingData(scanId: string, body: unknown = {}, deps?: FinderScanDeps): FinderScanResult {
  const request = finderRetryMissingRequestSchema.parse(body ?? {});
  const scan = resolveFinderScan(scanId, deps);
  beginFinderOperation(scan, request.count);
  scan.result.status = 'running';
  launchFinder(scan, () => runRetryMissingData(scan, request.count));
  return structuredClone(scan.result);
}

export function getFinderScan(scanId: string, persistSqlite?: Database.Database): FinderScanResult | null {
  const scan = scans.get(scanId);
  if (scan) return structuredClone(scan.result);
  if (!persistSqlite) return null;
  const restored = loadFinderRestore(persistSqlite, scanId);
  return restored ? structuredClone(restored.result) : null;
}

export async function waitForFinderScan(scanId: string): Promise<FinderScanResult | null> {
  const scan = scans.get(scanId);
  if (!scan) return null;
  if (scan.running) await scan.running;
  return structuredClone(scan.result);
}

export function cancelFinderScan(scanId: string): FinderScanResult | null {
  const scan = scans.get(scanId);
  if (!scan) return null;
  scan.cancelRequested = true;
  if (scan.result.status === 'running') {
    scan.result.message = 'Cancellation requested. Waiting for the current batch to finish.';
  }
  return structuredClone(scan.result);
}

export function resetFinderScans(): void {
  for (const scan of scans.values()) {
    void scan.liveQuoteSource?.stop().catch(() => undefined);
  }
  scans.clear();
}

export async function runFinderScanForTest(deps: FinderScanDeps, body: unknown): Promise<FinderScanResult> {
  const started = startFinderScan(deps, body);
  return (await waitForFinderScan(started.scanId))!;
}

export async function runFinderScanMoreForTest(
  scanId: string,
  count = FINDER_DEFAULT_EVALUATION_BUDGET,
  priority?: ScanMorePriority,
): Promise<FinderScanResult> {
  continueFinderScan(scanId, { count, priority });
  return (await waitForFinderScan(scanId))!;
}

export async function runFinderRetryMissingForTest(
  scanId: string,
  count = FINDER_BATCH_SIZE,
): Promise<FinderScanResult> {
  retryFinderMissingData(scanId, { count });
  return (await waitForFinderScan(scanId))!;
}

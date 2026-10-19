import { describe, expect, it } from 'vitest';
import { parseNestedOptionChain, type NestedChainContract } from './chain.js';
import {
  buildBudgetAwareQueue,
  floorCost,
  observationsFromCandidates,
  refineRemainingQueue,
  selectCallableContracts,
} from './selection.js';
import type { FinderQuoteSnapshot, FinderQuoteSource } from './quotes.js';
import { SAL_PMCC_DEEP_ITM } from '@optionscout/shared';
import { resetFinderScans, runFinderScanForTest, runFinderScanMoreForTest } from './scan.js';
import { afterEach } from 'vitest';

afterEach(() => {
  resetFinderScans();
});

/** Reproduces the AAPL-style problem: deep-ITM floors look near-budget but asks exceed $7k; affordable mid strikes exist. */
const AAPL_LIKE_SPOT = 250;
const IDEAL = 6000;
const HARD_MAX = 7000;

function padOcc(strike: number, expYymmdd: string): string {
  const strikeCents = Math.round(strike * 1000)
    .toString()
    .padStart(8, '0');
  return `AAPL  ${expYymmdd}C${strikeCents}`;
}

function aaplLikeChainPayload(): unknown {
  // 471 eligible LEAPS across several expirations (strikes every $2.50 from 80–220 ≈ 57 per exp × 8 + extras ≈ 471).
  const expirations = [
    { date: '2028-01-21', dte: 463, yymmdd: '280121' },
    { date: '2028-06-16', dte: 610, yymmdd: '280616' },
    { date: '2028-12-15', dte: 792, yymmdd: '281215' },
    { date: '2029-01-19', dte: 827, yymmdd: '290119' },
    { date: '2029-06-15', dte: 974, yymmdd: '290615' },
    { date: '2029-12-21', dte: 1163, yymmdd: '291221' },
    { date: '2030-01-18', dte: 1191, yymmdd: '300118' },
    { date: '2030-06-21', dte: 1345, yymmdd: '300621' },
  ];
  const strikes: number[] = [];
  for (let strike = 80; strike <= 220; strike += 2.5) strikes.push(strike);
  // 57 strikes × 8 expirations = 456; pad to 471 with denser near-ATM on first two exps.
  const items = [
    {
      'underlying-symbol': 'AAPL',
      'root-symbol': 'AAPL',
      'option-chain-type': 'Standard',
      'shares-per-contract': 100,
      deliverables: [],
      expirations: expirations.map((exp, expIndex) => {
        const list = [...strikes];
        if (expIndex < 2) {
          for (let strike = 221; strike <= 228; strike += 1) list.push(strike);
        }
        return {
          'expiration-type': 'Regular',
          'expiration-date': exp.date,
          'days-to-expiration': exp.dte,
          'settlement-type': 'PM',
          strikes: list.map((strike) => ({
            'strike-price': strike,
            call: padOcc(strike, exp.yymmdd),
            'call-streamer-symbol': `.AAPL${exp.yymmdd}C${strike}`,
          })),
        };
      }),
    },
  ];
  return { data: { items } };
}

/**
 * Legacy Stage A: sort solely by |intrinsicFloor − ideal|.
 * Deep ITM with floors near $6–7k sort first even when LEAPS extrinsic pushes asks over cap.
 */
function legacyIntrinsicNearIdealFirst(
  contracts: readonly NestedChainContract[],
  stock: number,
  ideal: number,
  minDays = 365,
): NestedChainContract[] {
  const eligible = contracts.filter(
    (row) => row.optionType === 'call' && row.supportStatus === 'supported' && row.streamerSymbol && (row.daysToExpiration ?? 0) >= minDays,
  );
  return [...eligible].sort((a, b) => {
    const da = Math.abs(floorCost(stock, a) - ideal);
    const db = Math.abs(floorCost(stock, b) - ideal);
    if (da !== db) return da - db;
    return Number(a.strike) - Number(b.strike) || a.occSymbol.localeCompare(b.occSymbol);
  });
}

/**
 * Synthetic asks: deep ITM have large extrinsic so askCost often > $7k when floor is near-ideal;
 * higher strikes (floor well under ideal) land in-budget. Some symbols omit Greeks.
 */
function aaplLikeAsk(strike: number, dte: number): number {
  const intrinsic = Math.max(AAPL_LIKE_SPOT - strike, 0);
  // Non-linear LEAPS extrinsic: deep ITM asks sit well above intrinsic floors near $6–7k
  // (mirrors live AAPL ~$7.5k+), while modest-ITM strikes remain affordable.
  const moneyness = AAPL_LIKE_SPOT - strike;
  const baseExtrinsic = 6 + dte / 150;
  const deepItmBump =
    moneyness >= 55 ? 18 + (moneyness - 55) * 0.12 : moneyness >= 40 ? 14 : moneyness >= 25 ? 8 : moneyness >= 10 ? 4 : 1.5;
  return Math.round((intrinsic + baseExtrinsic + deepItmBump) * 100) / 100;
}

function aaplLikeQuoteSource(options?: { omitGreeks?: boolean }): FinderQuoteSource {
  const omitGreeks = options?.omitGreeks ?? true;
  return {
    async fetchQuotes(streamerSymbols) {
      const map = new Map<string, FinderQuoteSnapshot>();
      const receivedAt = '2026-10-15T22:30:00.000Z';
      for (const streamer of streamerSymbols) {
        if (!streamer.startsWith('.AAPL')) {
          map.set(streamer, {
            streamerSymbol: streamer,
            bid: String(AAPL_LIKE_SPOT - 0.05),
            ask: String(AAPL_LIKE_SPOT),
            mark: String(AAPL_LIKE_SPOT),
            delta: null,
            theta: null,
            gamma: null,
            vega: null,
            impliedVolatility: null,
            volume: 1_000_000,
            openInterest: null,
            providerEventAt: receivedAt,
            greekEventAt: null,
            receivedAt,
            sourceLabel: 'mock equity',
          });
          continue;
        }
        const match = /\.AAPL(\d{6})C([\d.]+)$/.exec(streamer);
        const strike = match ? Number(match[2]) : 200;
        const yymmdd = match?.[1] ?? '280121';
        const year = 2000 + Number(yymmdd.slice(0, 2));
        const month = Number(yymmdd.slice(2, 4)) - 1;
        const day = Number(yymmdd.slice(4, 6));
        const dte = Math.round((Date.UTC(year, month, day) - Date.UTC(2026, 9, 15)) / 86_400_000);
        const ask = aaplLikeAsk(strike, dte);
        const bid = Math.round((ask - 0.35) * 100) / 100;
        // Affordable mid-strikes get delta; deep ITM often "missing" after hours.
        const deep = AAPL_LIKE_SPOT - strike > 45;
        const delta = omitGreeks || deep ? null : String(Math.min(0.95, 0.55 + (AAPL_LIKE_SPOT - strike) / 200).toFixed(2));
        map.set(streamer, {
          streamerSymbol: streamer,
          bid: String(bid),
          ask: String(ask),
          mark: String((bid + ask) / 2),
          delta,
          theta: delta != null ? '-0.02' : null,
          gamma: null,
          vega: null,
          impliedVolatility: null,
          volume: 120,
          openInterest: 500,
          providerEventAt: receivedAt,
          greekEventAt: delta != null ? receivedAt : null,
          receivedAt,
          sourceLabel: 'mock AAPL-like closed-session snapshot',
        });
      }
      return map;
    },
  };
}

describe('adaptive LEAPS selection vs intrinsic-floor-only', () => {
  it('builds an AAPL-like universe of ~471 eligible LEAPS across several expirations', () => {
    const parsed = parseNestedOptionChain(aaplLikeChainPayload(), 'AAPL');
    const leaps = parsed.contracts.filter(
      (row) => row.optionType === 'call' && row.supportStatus === 'supported' && (row.daysToExpiration ?? 0) >= 365,
    );
    expect(leaps.length).toBeGreaterThanOrEqual(460);
    expect(leaps.length).toBeLessThanOrEqual(480);
    expect(new Set(leaps.map((row) => row.expiration)).size).toBeGreaterThanOrEqual(6);
  });

  it('improves first-batch coverage of the $6–7k cost region versus intrinsic-floor near-ideal', () => {
    const parsed = parseNestedOptionChain(aaplLikeChainPayload(), 'AAPL');
    const stock = String(AAPL_LIKE_SPOT);
    const adaptive = selectCallableContracts(parsed.contracts, 24, 365, stock, IDEAL, HARD_MAX);
    const legacy = legacyIntrinsicNearIdealFirst(parsed.contracts, AAPL_LIKE_SPOT, IDEAL).slice(0, 24);

    const inBudgetAsk = (contract: NestedChainContract) => {
      const ask = aaplLikeAsk(Number(contract.strike), contract.daysToExpiration ?? 500);
      return ask * contract.multiplier <= HARD_MAX;
    };

    const adaptiveInBudget = adaptive.filter(inBudgetAsk).length;
    const legacyInBudget = legacy.filter(inBudgetAsk).length;

    // Legacy near-ideal floors cluster on deep ITM whose asks sit ~$7.5k+.
    expect(legacyInBudget).toBeLessThan(adaptiveInBudget);
    expect(adaptiveInBudget).toBeGreaterThanOrEqual(2);
    // Adaptive still keeps some exploration (not only in-budget).
    expect(adaptive.filter((row) => !inBudgetAsk(row)).length).toBeGreaterThan(0);
    // Representative sampling hits multiple expirations in the first batch.
    expect(new Set(adaptive.map((row) => row.expiration)).size).toBeGreaterThanOrEqual(3);
  });

  it('never drops eligible contracts from the queue solely because floor misses budget preferences', () => {
    const parsed = parseNestedOptionChain(aaplLikeChainPayload(), 'AAPL');
    const plan = buildBudgetAwareQueue(parsed.contracts, String(AAPL_LIKE_SPOT), {
      idealCost: IDEAL,
      hardMaxCost: HARD_MAX,
    });
    expect(plan.queue.length).toBe(plan.eligibleCount);
    expect(plan.eligibleCount).toBeGreaterThanOrEqual(460);
  });

  it('Stage A1 reorders remaining toward observed budget region without inventing displayed prices', () => {
    const parsed = parseNestedOptionChain(aaplLikeChainPayload(), 'AAPL');
    const plan = buildBudgetAwareQueue(parsed.contracts, String(AAPL_LIKE_SPOT), {
      idealCost: IDEAL,
      hardMaxCost: HARD_MAX,
    });
    const first = plan.queue.slice(0, 24);
    const remaining = plan.queue.slice(24);
    const observations = first.map((contract) => {
      const ask = aaplLikeAsk(Number(contract.strike), contract.daysToExpiration ?? 500);
      const floor = floorCost(AAPL_LIKE_SPOT, contract);
      return {
        occSymbol: contract.occSymbol,
        expiration: contract.expiration,
        strike: Number(contract.strike),
        intrinsicFloor: floor,
        askCost: ask * 100,
        extrinsicPerShare: Math.max(0, ask - Math.max(AAPL_LIKE_SPOT - Number(contract.strike), 0)),
      };
    });
    const refined = refineRemainingQueue(remaining, String(AAPL_LIKE_SPOT), observations, {
      idealCost: IDEAL,
      hardMaxCost: HARD_MAX,
    });
    expect(refined.queue.length).toBe(remaining.length);
    expect(refined.algorithmNote).toMatch(/Unified reorder|observed extrinsic/i);
    const nextBatch = refined.queue.slice(0, 24);
    const inBudget = (contract: NestedChainContract) =>
      aaplLikeAsk(Number(contract.strike), contract.daysToExpiration ?? 500) * 100 <= HARD_MAX;
    const refinedHits = nextBatch.filter(inBudget).length;
    const unreorderedHits = remaining.slice(0, 24).filter(inBudget).length;
    expect(refinedHits).toBeGreaterThanOrEqual(unreorderedHits);
  });
});

describe('AAPL-like mocked finder scan completeness', () => {
  it('reports partial evaluation metrics and Scan More refinement when first batch is all over budget', async () => {
    const result = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        chainPayload: aaplLikeChainPayload(),
        quoteSource: aaplLikeQuoteSource({ omitGreeks: true }),
        underlyingPrice: String(AAPL_LIKE_SPOT),
        now: () => new Date('2026-10-15T22:30:00.000Z'),
      },
      { underlying: 'AAPL', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 24 },
    );

    expect(result.status).toBe('completed');
    expect(result.progress.eligibleLeaps).toBeGreaterThanOrEqual(460);
    expect(result.progress.evaluated).toBe(24);
    expect(result.progress.notYetEvaluated).toBe(result.progress.eligibleLeaps - 24);
    expect(result.progress.partiallyEvaluated).toBeGreaterThan(0);
    expect(result.progress.missingProviderGreeks).toBeGreaterThan(0);
    expect(result.progress.canScanMore).toBe(true);
    expect(result.progress.exhausted).toBe(false);
    expect(result.progress.coverageSummary).toMatch(/not yet evaluated/i);
    expect(result.progress.coverageSummary).not.toMatch(/market-wide coverage/i);
    expect(result.coverageNotes.some((note) => note.code === 'missing-greeks-common')).toBe(true);
    expect(
      result.coverageNotes.some((note) =>
        ['has-in-budget', 'insufficient-evaluation', 'none-in-budget-among-evaluated'].includes(note.code),
      ),
    ).toBe(true);

    const supported = result.candidates.filter((row) => row.supportStatus === 'supported');
    const inBudget = supported.filter(
      (row) => row.calculations.estimatedPurchaseCost != null && Number(row.calculations.estimatedPurchaseCost) <= HARD_MAX,
    );
    // Adaptive first batch should find some in-budget asks (unlike pure intrinsic-floor bias).
    expect(inBudget.length).toBeGreaterThan(0);

    const more = await runFinderScanMoreForTest(result.scanId, 24);
    expect(more.progress.evaluated).toBe(48);
    expect(more.progress.notYetEvaluated).toBe(more.progress.eligibleLeaps - 48);
    expect(more.progress.selectionAlgorithm).toMatch(/Unified|Priority/i);
  });

  it('applies unified priority reorder on Scan More when the first batch has no in-budget asks', async () => {
    // Quote source that prices every evaluated ask above hard max (forces refinement path).
    const overBudgetQuotes: FinderQuoteSource = {
      async fetchQuotes(streamerSymbols) {
        const base = aaplLikeQuoteSource({ omitGreeks: true });
        const map = await base.fetchQuotes(streamerSymbols);
        for (const [streamer, row] of map) {
          if (streamer.startsWith('.AAPL')) {
            map.set(streamer, {
              ...row,
              ask: '95.00',
              bid: '94.50',
              mark: '94.75',
            });
          }
        }
        return map;
      },
    };
    const first = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        chainPayload: aaplLikeChainPayload(),
        quoteSource: overBudgetQuotes,
        underlyingPrice: String(AAPL_LIKE_SPOT),
        now: () => new Date('2026-10-15T22:30:00.000Z'),
      },
      { underlying: 'AAPL', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 24 },
    );
    expect(
      first.candidates.filter(
        (row) =>
          row.supportStatus === 'supported' &&
          row.calculations.estimatedPurchaseCost != null &&
          Number(row.calculations.estimatedPurchaseCost) <= HARD_MAX,
      ),
    ).toHaveLength(0);
    const more = await runFinderScanMoreForTest(first.scanId, 24, 'within-budget');
    expect(more.progress.selectionAlgorithm).toMatch(/within-budget|Unified|observed/i);
    expect(more.progress.lastScanPriority).toBe('within-budget');
    expect(more.coverageNotes.some((note) => note.code === 'adaptive-refinement-applied' || note.code === 'scan-priority-applied')).toBe(
      true,
    );
  });

  it('keeps missing provider Greeks null and incomplete — never fabricated', async () => {
    const result = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        chainPayload: aaplLikeChainPayload(),
        quoteSource: aaplLikeQuoteSource({ omitGreeks: true }),
        underlyingPrice: String(AAPL_LIKE_SPOT),
        now: () => new Date('2026-10-15T22:30:00.000Z'),
      },
      { underlying: 'AAPL', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 12 },
    );
    const supported = result.candidates.filter((row) => row.supportStatus === 'supported');
    expect(supported.every((row) => row.delta == null)).toBe(true);
    expect(supported.every((row) => row.flags.missingGreeks)).toBe(true);
    expect(supported.some((row) => row.outcome === 'incomplete')).toBe(true);
  });
});

describe('observationsFromCandidates', () => {
  it('only uses actual ask costs — never preselection floors as observations', () => {
    const rows = observationsFromCandidates([
      {
        occSymbol: 'X',
        expiration: '2029-01-19',
        strike: '200',
        ask: '55.00',
        multiplier: 100,
        underlyingPrice: '250',
        calculations: { intrinsicValue: '50.00', estimatedPurchaseCost: '5500.00' },
      },
      {
        occSymbol: 'Y',
        expiration: '2029-01-19',
        strike: '100',
        ask: null,
        multiplier: 100,
        underlyingPrice: '250',
        calculations: { intrinsicValue: '150.00', estimatedPurchaseCost: null },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.askCost).toBe(5500);
    expect(rows[0]!.extrinsicPerShare).toBe(5);
  });
});

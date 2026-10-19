import { SAL_PMCC_DEEP_ITM, SHOW_PROFILE_MISSES, assessCandidate } from '@optionscout/shared';
import { describe, expect, it } from 'vitest';
import { buildFinderCandidate } from './build-candidate.js';
import type { NestedChainContract } from './chain.js';
import type { FinderQuoteSnapshot } from './quotes.js';

/** Synthetic / replay fixtures — not live brokerage scans. */

function contract(overrides: Partial<NestedChainContract> = {}): NestedChainContract {
  return {
    underlying: 'DEMO',
    rootSymbol: 'DEMO',
    occSymbol: 'DEMO  280121C00040000',
    streamerSymbol: '.DEMO280121C40',
    optionType: 'call',
    strike: '40.00',
    expiration: '2028-01-21',
    daysToExpiration: 463,
    multiplier: 100,
    chainType: 'Standard',
    settlementType: 'PM',
    expirationType: 'Regular',
    deliverables: [],
    standardContract: true,
    supportStatus: 'supported',
    supportNote: 'ok',
    active: true,
    closingOnly: false,
    ...overrides,
  };
}

function quote(overrides: Partial<FinderQuoteSnapshot> = {}): FinderQuoteSnapshot {
  return {
    streamerSymbol: '.DEMO280121C40',
    // Preferred ideal is strictly below $6,000; with stock 99 / strike 40, ask 59 → cost $5,900 and intrinsic 59 ≤ ask.
    bid: '58.50',
    ask: '59.00',
    mark: '58.75',
    delta: '0.85',
    theta: '-0.02',
    gamma: '0.01',
    vega: '0.30',
    impliedVolatility: '0.28',
    volume: 50,
    openInterest: 400,
    providerEventAt: '2026-10-15T13:59:30.000Z',
    greekEventAt: '2026-10-15T13:59:30.000Z',
    receivedAt: '2026-10-15T14:00:00.000Z',
    sourceLabel: 'test-quote-synthetic',
    ...overrides,
  };
}

describe('buildFinderCandidate stale Greeks', () => {
  it('does not use historical-unverified delta for hard pass and marks unverifiedGreeks', () => {
    const now = new Date('2026-10-15T14:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract(),
      // Spot 99 / strike 40 / ask 59 → intrinsic 59 (possible); isolates Greek-alignment behavior.
      underlyingPrice: '99.00',
      underlyingQuoteAt: '2026-10-15T13:59:30.000Z',
      quote: quote({
        // Wide quote/greek skew → historical-unverified
        providerEventAt: '2026-10-15T13:59:50.000Z',
        greekEventAt: '2026-10-15T13:50:00.000Z',
        delta: '0.90',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.greekVerification).toBe('historical-unverified');
    expect(candidate.flags.unverifiedGreeks).toBe(true);
    expect(candidate.flags.missingGreeks).toBe(true);
    expect(candidate.meetsConfiguredNumericRequirements).toBe(false);
    expect(candidate.outcome).toBe('incomplete');
    // Delta is still displayed for research, but classification must not hard-pass on it.
    expect(candidate.delta).toBe('0.90');
    expect(candidate.reasons.some((reason) => reason.metric === 'delta' && reason.kind === 'hard' && reason.passed)).toBe(
      false,
    );
    expect(candidate.validationIssues.some((issue) => issue.code === 'greek_unaligned')).toBe(true);
    expect(assessCandidate(candidate).plainSummary).toMatch(/Delta requirement not verified/i);
  });

  it('allows aligned Greeks with current-session or previous-session to meet numeric rules', () => {
    const currentSessionNow = new Date('2026-10-15T14:00:00.000Z');
    const current = buildFinderCandidate({
      contract: contract(),
      underlyingPrice: '99.00',
      underlyingQuoteAt: '2026-10-15T13:59:30.000Z',
      quote: quote({
        providerEventAt: '2026-10-15T13:59:30.000Z',
        greekEventAt: '2026-10-15T13:59:25.000Z',
        observationFreshness: 'current-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now: currentSessionNow,
      screeningFreshnessSeconds: 60,
    });
    expect(current.greekVerification).toBe('aligned');
    expect(current.observationFreshness).toBe('current-session');
    expect(current.flags.unverifiedGreeks).toBe(false);
    expect(current.flags.missingGreeks).toBe(false);
    expect(current.meetsConfiguredNumericRequirements).toBe(true);
    expect(['exact', 'near'].includes(current.outcome)).toBe(true);

    // After the close: same-day events classify as previous-session but remain numerically assessable.
    const afterHoursNow = new Date('2026-10-15T21:00:00.000Z');
    const previous = buildFinderCandidate({
      contract: contract(),
      underlyingPrice: '99.00',
      underlyingQuoteAt: '2026-10-15T18:00:00.000Z',
      quote: quote({
        providerEventAt: '2026-10-15T18:00:00.000Z',
        greekEventAt: '2026-10-15T18:00:00.000Z',
        receivedAt: afterHoursNow.toISOString(),
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now: afterHoursNow,
      screeningFreshnessSeconds: 60,
    });
    expect(previous.greekVerification).toBe('aligned');
    expect(previous.observationFreshness).toBe('previous-session');
    expect(previous.meetsConfiguredNumericRequirements).toBe(true);
    expect(previous.flags.unverifiedGreeks).toBe(false);
  });
});

describe('Phase 1D.2a.2b over-rejection fixes (synthetic / replay)', () => {
  it('A: fictional wide spot ask makes intrinsic exceed the option ask', () => {
    const now = new Date('2026-10-17T18:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract({
        underlying: 'ZZTST',
        occSymbol: 'ZZTST 290119C00040000',
        streamerSymbol: '.ZZTST290119C40',
        strike: '40.00',
        expiration: '2029-01-19',
        daysToExpiration: 825,
      }),
      underlyingPrice: '80.00',
      underlyingQuoteAt: '2026-10-17T12:00:00.000Z',
      underlyingBid: '50.00',
      underlyingAsk: '80.00',
      quote: quote({
        streamerSymbol: '.ZZTST290119C40',
        bid: '10.00',
        ask: '12.00',
        mark: '11.00',
        delta: '0.86',
        providerEventAt: '2026-10-16T12:00:00.000Z',
        greekEventAt: '2026-10-16T12:00:00.000Z',
        receivedAt: '2026-10-17T17:00:00.000Z',
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-17',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.calculations.intrinsicValue).toBe('40.00');
    expect(Number(candidate.calculations.intrinsicPercent)).toBeGreaterThan(100);
    expect(candidate.dataQuality).toBe('inconsistent');
    expect(candidate.meetsConfiguredNumericRequirements).toBe(false);
    expect(candidate.outcome).toBe('incomplete');
    expect(candidate.validationIssues.some((issue) => issue.code === 'option_ask_below_intrinsic')).toBe(true);
    expect(candidate.validationIssues.some((issue) => issue.code === 'underlying_nbbo_wide')).toBe(true);
  });

  it('B: fictional mark, small extrinsic, and a research clock gap stay assessable', () => {
    const now = new Date('2026-10-17T18:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract({
        underlying: 'ZZTST',
        occSymbol: 'ZZTST 280121C00050000',
        streamerSymbol: '.ZZTST280121C50',
        strike: '50.00',
        expiration: '2028-01-21',
        daysToExpiration: 461,
      }),
      underlyingPrice: '200.00',
      underlyingQuoteAt: '2026-10-17T11:00:00.000Z',
      underlyingBid: '199.90',
      underlyingAsk: '200.10',
      quote: quote({
        streamerSymbol: '.ZZTST280121C50',
        bid: '151.00',
        ask: '152.00',
        mark: '151.50',
        delta: '0.88',
        providerEventAt: '2026-10-16T22:00:00.000Z',
        greekEventAt: '2026-10-16T22:00:00.000Z',
        receivedAt: now.toISOString(),
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-17',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.calculations.intrinsicValue).toBe('150.00');
    expect(candidate.calculations.extrinsicValue).toBe('2.00');
    expect(candidate.dataQuality).not.toBe('inconsistent');
    expect(candidate.validationIssues.some((issue) => issue.code === 'stock_option_research_clock_gap')).toBe(true);
    expect(candidate.validationIssues.some((issue) => issue.severity === 'reject')).toBe(false);
    expect(candidate.greekVerification).toBe('aligned');
    // Ask-based cost ($15,200) exceeds the hard maximum. The strategy miss stays assessable.
    expect(candidate.outcome).toBe('outside-profile');
    expect(assessCandidate(candidate).underlyingIncompatible).toBe(false);
    expect(assessCandidate(candidate).marketDataValidity).toBe('Valid');
  });

  it('C: QCOM nonnegative extrinsic + valid timestamps → assessed', () => {
    const now = new Date('2026-10-15T21:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract({
        underlying: 'QCOM',
        occSymbol: 'QCOM  280121C00120000',
        streamerSymbol: '.QCOM280121C120',
        strike: '120.00',
        expiration: '2028-01-21',
        daysToExpiration: 463,
      }),
      underlyingPrice: '170.00',
      underlyingQuoteAt: '2026-10-15T18:00:00.000Z',
      quote: quote({
        streamerSymbol: '.QCOM280121C120',
        bid: '54.00',
        ask: '55.00',
        mark: '54.50',
        delta: '0.82',
        providerEventAt: '2026-10-15T18:00:00.000Z',
        greekEventAt: '2026-10-15T18:00:00.000Z',
        receivedAt: now.toISOString(),
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(Number(candidate.calculations.extrinsicValue)).toBeGreaterThanOrEqual(0);
    expect(candidate.dataQuality).toBe('usable');
    expect(candidate.outcome).not.toBe('incomplete');
    expect(candidate.meetsConfiguredNumericRequirements).toBe(true);
  });

  it('D: WMT previous-session + synchronized Greeks → historical numerical fit', () => {
    const now = new Date('2026-10-15T21:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract({
        underlying: 'WMT',
        occSymbol: 'WMT   280121C00080000',
        streamerSymbol: '.WMT280121C80',
        strike: '80.00',
        expiration: '2028-01-21',
        daysToExpiration: 462,
      }),
      underlyingPrice: '118.70',
      underlyingQuoteAt: '2026-10-15T18:00:00.000Z',
      quote: quote({
        streamerSymbol: '.WMT280121C80',
        bid: '43.25',
        ask: '44.45',
        mark: '43.85',
        delta: '0.8565',
        providerEventAt: '2026-10-15T18:00:00.000Z',
        greekEventAt: '2026-10-15T18:00:00.000Z',
        receivedAt: now.toISOString(),
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.greekVerification).toBe('aligned');
    expect(candidate.observationFreshness).toBe('previous-session');
    expect(candidate.meetsConfiguredNumericRequirements).toBe(true);
    expect(assessCandidate(candidate).isHistoricalNumericalFit).toBe(true);
    expect(assessCandidate(candidate).isVerifiedCurrentMatch).toBe(false);
  });

  it('E: WMT missing delta → incomplete / cannot verify delta, not hard-passed', () => {
    const now = new Date('2026-10-15T21:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract({
        underlying: 'WMT',
        occSymbol: 'WMT   280121C00080000',
        streamerSymbol: '.WMT280121C80',
        strike: '80.00',
        expiration: '2028-01-21',
        daysToExpiration: 462,
      }),
      underlyingPrice: '118.70',
      underlyingQuoteAt: '2026-10-15T18:00:00.000Z',
      quote: quote({
        streamerSymbol: '.WMT280121C80',
        bid: '43.25',
        ask: '44.45',
        mark: '43.85',
        delta: null,
        greekEventAt: null,
        providerEventAt: '2026-10-15T18:00:00.000Z',
        receivedAt: now.toISOString(),
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.delta).toBeNull();
    expect(candidate.meetsConfiguredNumericRequirements).toBe(false);
    expect(candidate.outcome).toBe('incomplete');
    expect(candidate.reasons.some((reason) => reason.kind === 'hard' && reason.metric === 'delta' && !reason.passed)).toBe(
      false,
    );
    expect(assessCandidate(candidate).plainSummary).toMatch(/Delta requirement not verified/i);
    expect(assessCandidate(candidate).strategyFit).toBe('Cannot verify required values');
  });

  it('F: Live regular-session stock/option skew → stock_option_live_skew reject', () => {
    const now = new Date('2026-10-15T14:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract(),
      underlyingPrice: '99.00',
      underlyingQuoteAt: '2026-10-15T13:58:00.000Z',
      quote: quote({
        providerEventAt: '2026-10-15T13:50:00.000Z',
        greekEventAt: '2026-10-15T13:50:00.000Z',
        receivedAt: now.toISOString(),
        // Force current-session classification for the live-skew path.
        observationFreshness: 'current-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.marketSession).toBe('regular');
    expect(candidate.observationFreshness).toBe('current-session');
    expect(candidate.dataQuality).toBe('inconsistent');
    expect(candidate.validationIssues.some((issue) => issue.code === 'stock_option_live_skew')).toBe(true);
    expect(candidate.meetsConfiguredNumericRequirements).toBe(false);
  });

  it('G: Invalid underlying NBBO wide → underlying_nbbo_wide WARNING, not automatic reject when mark intrinsic OK', () => {
    const now = new Date('2026-10-15T21:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract({
        underlying: 'ZZTST',
        strike: '40.00',
        occSymbol: 'ZZTST 280121C00040000',
        streamerSymbol: '.ZZTST280121C40',
      }),
      underlyingPrice: '100.00',
      underlyingQuoteAt: '2026-10-15T18:00:00.000Z',
      underlyingBid: '100.00',
      underlyingAsk: '130.00',
      quote: quote({
        streamerSymbol: '.ZZTST280121C40',
        bid: '61.00',
        ask: '62.00',
        mark: '61.50',
        delta: '0.88',
        providerEventAt: '2026-10-15T18:00:00.000Z',
        greekEventAt: '2026-10-15T18:00:00.000Z',
        receivedAt: now.toISOString(),
        observationFreshness: 'previous-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.validationIssues.some((issue) => issue.code === 'underlying_nbbo_wide' && issue.severity === 'warning')).toBe(
      true,
    );
    expect(candidate.dataQuality).not.toBe('inconsistent');
    expect(candidate.validationIssues.some((issue) => issue.code === 'option_ask_below_intrinsic')).toBe(false);
  });

  it('H: Crossed option quote → reject crossed_option_market', () => {
    const now = new Date('2026-10-15T14:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract(),
      underlyingPrice: '99.00',
      underlyingQuoteAt: '2026-10-15T13:59:30.000Z',
      quote: quote({
        bid: '60.00',
        ask: '59.00',
        providerEventAt: '2026-10-15T13:59:30.000Z',
        greekEventAt: '2026-10-15T13:59:30.000Z',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });

    expect(candidate.flags.crossedMarket).toBe(true);
    expect(candidate.dataQuality).toBe('inconsistent');
    expect(candidate.validationIssues.some((issue) => issue.code === 'crossed_option_market')).toBe(true);
    expect(candidate.meetsConfiguredNumericRequirements).toBe(false);
  });

  it('stays usable when intrinsic is within ask (baseline)', () => {
    const now = new Date('2026-10-15T14:00:00.000Z');
    const candidate = buildFinderCandidate({
      contract: contract(),
      underlyingPrice: '99.00',
      underlyingQuoteAt: '2026-10-15T13:59:30.000Z',
      quote: quote({
        providerEventAt: '2026-10-15T13:59:30.000Z',
        greekEventAt: '2026-10-15T13:59:25.000Z',
        observationFreshness: 'current-session',
      }),
      profile: SAL_PMCC_DEEP_ITM,
      tolerances: SHOW_PROFILE_MISSES,
      asOfDate: '2026-10-15',
      now,
      screeningFreshnessSeconds: 60,
    });
    expect(candidate.calculations.intrinsicValue).toBe('59.00');
    expect(Number(candidate.calculations.intrinsicPercent)).toBeLessThanOrEqual(100);
    expect(candidate.dataQuality).toBe('usable');
    expect(candidate.meetsConfiguredNumericRequirements).toBe(true);
  });
});

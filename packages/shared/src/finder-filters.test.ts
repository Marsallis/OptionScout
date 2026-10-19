import { describe, expect, it } from 'vitest';
import { applyDisplayFilters, EMPTY_DISPLAY_FILTER, metricAvailabilityNotes } from './finder-filters.js';
import type { FinderCandidate } from './finder.js';

function candidate(partial: Partial<FinderCandidate> & Pick<FinderCandidate, 'id' | 'occSymbol'>): FinderCandidate {
  return {
    underlying: 'DEMO',
    streamerSymbol: '.X',
    optionType: 'call',
    strike: '40.00',
    expiration: '2028-01-21',
    multiplier: 100,
    chainType: 'Standard',
    standardContract: true,
    supportStatus: 'supported',
    supportNote: 'ok',
    active: true,
    closingOnly: false,
    underlyingPrice: '100.00',
    bid: '60.00',
    ask: '61.00',
    mark: '60.50',
    delta: '0.80',
    theta: '-0.02',
    gamma: null,
    vega: null,
    impliedVolatility: null,
    volume: null,
    openInterest: null,
    providerEventAt: '2026-10-15T14:00:00.000Z',
    receivedAt: '2026-10-15T14:00:01.000Z',
    marketSession: 'regular',
    dataQuality: 'usable',
    flags: {
      crossedMarket: false,
      missingBid: false,
      missingAsk: false,
      invalidPrice: false,
      staleInputs: false,
      missingProviderTimestamp: false,
      quoteGreekMismatch: false,
      missingGreeks: false,
      unverifiedGreeks: false,
      afterHoursSnapshot: false,
      fromCache: false,
      actionable: true,
    },
    calculations: {
      intrinsicValue: '60.00',
      estimatedPurchaseCost: '6100.00',
      extrinsicValue: '1.00',
      intrinsicPercent: '98.00',
      bidAskSpreadDollars: '1.00',
      bidAskSpreadPercent: '1.65',
      expirationBreakEven: '161.00',
      daysToExpiration: 463,
      strikeDistance: '60.00',
      downsideMoneyness15: '10.00',
      downsideMoneyness20: '15.00',
      downsideMoneyness30: '25.00',
      deltaCapitalExposure: '0.40',
      midpoint: '60.50',
      quoteSourceLabel: 'test',
    },
    outcome: 'near',
    label: 'Near Match',
    visible: true,
    usableForComparison: true,
    withinExploration: true,
    reasons: [],
    metrics: {
      purchaseCost: 6100,
      delta: 0.8,
      intrinsicPercent: 98,
      extrinsicValue: 1,
      bidAskSpread: 1.65,
      liquidity: null,
      dte: 463,
      theta: -0.02,
      downsideMoneyness: 10,
      pmccCompatibility: null,
    },
    pmccReason: null,
    meetsConfiguredNumericRequirements: true,
    liquidityUnassessed: true,
    observationFreshness: 'current-session',
    greekVerification: 'aligned',
    greekProviderEventAt: '2026-10-15T14:00:00.000Z',
    validationIssues: [],
    ...partial,
  };
}

describe('display filters', () => {
  it('filters evaluated rows without inventing open interest availability', () => {
    const rows = [
      candidate({ id: 'a', occSymbol: 'A', calculations: { ...candidate({ id: 'a', occSymbol: 'A' }).calculations, estimatedPurchaseCost: '5000.00' } }),
      candidate({ id: 'b', occSymbol: 'B', outcome: 'outside-profile', delta: '0.60' }),
    ];
    const filtered = applyDisplayFilters(rows, {
      ...EMPTY_DISPLAY_FILTER,
      maxContractCost: '5500.00',
      outcomes: ['near', 'exact'],
    });
    expect(filtered.map((row) => row.id)).toEqual(['a']);
    const notes = metricAvailabilityNotes(rows);
    expect(notes.some((note) => note.key === 'openInterest' && note.availability === 'not-available-yet')).toBe(true);
  });
});

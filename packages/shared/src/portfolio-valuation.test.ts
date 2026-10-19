import { describe, expect, it } from 'vitest';
import { buildMultiModeValuation, buildRealizedAudit, valueOpenLeg } from './portfolio-valuation.js';

/**
 * Fictional long/short pair used for valuation-mode regression.
 * Long mid $73.85 / short ask $4.25 reproduces a combined illustration of $845.75
 * when the long is marked at mid and the short at ask. Those modes stay labeled separately.
 */
describe('fictional valuation modes', () => {
  const long = {
    symbol: 'ZZT   280121C00155000',
    direction: 'long' as const,
    openQuantity: '1',
    multiplier: '100',
    remainingBasis: '6301.12',
    bid: '72.00',
    ask: '75.70',
    mid: '73.85',
    mark: '73.85',
    quoteAsOf: '2026-10-16T17:00:00.000Z',
    quoteFetchedAt: '2026-10-16T17:05:00.000Z',
  };
  const short = {
    symbol: 'ZZT   261016C00227500',
    direction: 'short' as const,
    openQuantity: '1',
    multiplier: '100',
    remainingBasis: '186.87',
    bid: '3.95',
    ask: '4.25',
    mid: '4.10',
    mark: '4.25',
    quoteAsOf: '2026-10-16T17:00:00.000Z',
    quoteFetchedAt: '2026-10-16T17:05:00.000Z',
  };

  it('values the long at midpoint and documents broker-mark vs mid', () => {
    const mid = valueOpenLeg(long, 'midpoint');
    expect(mid.marketValueOrLiability).toBe('7385.00');
    expect(mid.unrealized).toBe('1083.88');
    expect(mid.priceSource).toMatch(/mid/i);
  });

  it('values the short cover at ask for conservative liquidation', () => {
    const conservative = valueOpenLeg(short, 'conservative-liquidation');
    expect(conservative.pricePerShare).toBe('4.25');
    expect(conservative.marketValueOrLiability).toBe('425.00');
    expect(conservative.unrealized).toBe('-238.13');
  });

  it('reproduces $845.75 only as a labeled mid-long + ask-short mix, not as the default broker-mark mode', () => {
    const mixed =
      Number(valueOpenLeg(long, 'midpoint').unrealized) + Number(valueOpenLeg(short, 'conservative-liquidation').unrealized);
    expect(mixed.toFixed(2)).toBe('845.75');

    const multi = buildMultiModeValuation([long, short]);
    // Broker marks differ per leg in this snapshot (long mark=mid, short mark=ask).
    expect(multi.combinedUnrealized['broker-mark']).toBe('845.75');
    expect(multi.combinedUnrealized.midpoint).toBe('860.75');
    expect(multi.combinedUnrealized['conservative-liquidation']).toBe('660.75');
    expect(multi.warnings.some((row) => /matches the ask/i.test(row))).toBe(true);
    expect(multi.quoteAsOf).toBe('2026-10-16T17:00:00.000Z');
  });
});

describe('realized audit', () => {
  it('does not treat open short credits as realized profit', () => {
    const audit = buildRealizedAudit([
      {
        underlying: 'ZZT',
        symbol: 'ZZT short',
        multiplier: '100',
        cycles: [
          {
            openingTransactionId: '1',
            side: 'short',
            status: 'open',
            openedAt: '2026-10-13T14:29:55.000Z',
            closedAt: null,
            originalQuantity: '1',
            openQuantity: '1',
            openingCash: '188.00',
            closingCash: '0.00',
            fees: '1.13',
            realized: '0.00',
            feesComplete: false,
            notes: [],
          },
        ],
      },
      {
        underlying: 'NVDA',
        symbol: 'NVDA closed short',
        multiplier: '100',
        cycles: [
          {
            openingTransactionId: '2',
            side: 'short',
            status: 'closed',
            openedAt: '2026-08-01T14:00:00.000Z',
            closedAt: '2026-09-01T14:00:00.000Z',
            originalQuantity: '1',
            openQuantity: '0',
            openingCash: '420.00',
            closingCash: '110.00',
            fees: '2.00',
            realized: '308.00',
            feesComplete: true,
            notes: [],
          },
        ],
      },
    ]);
    expect(audit.grossShortOpeningCredits).toBe('608.00');
    expect(audit.closedShortRealized).toBe('308.00');
    expect(audit.totalIncluded).toBe('308.00');
    expect(audit.includedCycleCount).toBe(1);
    expect(audit.label).toMatch(/partial accounting/i);
    expect(audit.howCalculated).toMatch(/FIFO/i);
    expect(audit.lines.find((row) => row.id === '1')?.includedInTotal).toBe(false);
  });

  it('includes partial realized while a cycle remains open and does not double-count roll openings', () => {
    const audit = buildRealizedAudit([
      {
        underlying: 'AMZN',
        symbol: 'AMZN roll short',
        multiplier: '100',
        cycles: [
          {
            openingTransactionId: 'close-lot',
            side: 'short',
            status: 'closed',
            openedAt: '2026-06-24T15:00:00.000Z',
            closedAt: '2026-06-25T15:00:00.000Z',
            originalQuantity: '1',
            openQuantity: '0',
            openingCash: '545.00',
            closingCash: '275.00',
            fees: '1.00',
            realized: '269.00',
            feesComplete: false,
            notes: [],
          },
          {
            openingTransactionId: 'roll-open',
            side: 'short',
            status: 'open',
            openedAt: '2026-06-25T15:01:00.000Z',
            closedAt: null,
            originalQuantity: '1',
            openQuantity: '0.5',
            openingCash: '475.00',
            closingCash: '200.00',
            fees: '1.00',
            realized: '137.00',
            feesComplete: false,
            notes: ['Partial close on remaining open lot'],
          },
        ],
      },
    ]);
    expect(audit.totalIncluded).toBe('406.00');
    expect(audit.includedCycleCount).toBe(2);
    expect(audit.grossShortOpeningCredits).toBe('1020.00');
    expect(audit.lines.filter((row) => row.includedInTotal).map((row) => row.id)).toEqual(['close-lot', 'roll-open']);
    expect(audit.label).toMatch(/partial accounting/i);
  });

  it('excludes unreconciled assignment cycles from the supported total', () => {
    const audit = buildRealizedAudit([
      {
        underlying: 'AMD',
        symbol: 'AMD assigned',
        multiplier: '100',
        cycles: [
          {
            openingTransactionId: 'assign',
            side: 'short',
            status: 'unreconciled',
            openedAt: '2026-04-01T15:00:00.000Z',
            closedAt: null,
            originalQuantity: '1',
            openQuantity: '0',
            openingCash: '210.00',
            closingCash: '0.00',
            fees: '0.00',
            realized: null,
            feesComplete: false,
            notes: ['Assignment withheld'],
          },
        ],
      },
    ]);
    expect(audit.totalIncluded).toBeNull();
    expect(audit.includedCycleCount).toBe(0);
    expect(audit.excludedNotes.length).toBeGreaterThan(0);
  });
});

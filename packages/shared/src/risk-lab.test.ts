import { describe, expect, it } from 'vitest';
import { callMark, netGreeks, scenarioPnl } from './risk-lab.js';

const legs = [
  {
    side: 'long' as const,
    strike: 80,
    daysToExpiration: 400,
    entryPremium: 22,
    iv: 0.25,
    delta: 0.8,
    gamma: 0.01,
    theta: -0.02,
    vega: 0.2,
  },
  {
    side: 'short' as const,
    strike: 100,
    daysToExpiration: 30,
    entryPremium: 4,
    iv: 0.28,
    delta: 0.16,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.1,
  },
];

describe('risk lab P/L', () => {
  it('prices an at-the-money one-year call near the known Black-Scholes value', () => {
    const mark = callMark(100, 100, 1, 0.2);
    expect(mark).toBeGreaterThan(7.9);
    expect(mark).toBeLessThan(8.1);
  });

  it('uses intrinsic value once a leg is at expiration', () => {
    expect(callMark(110, 100, 0, 0.3)).toBe(10);
    expect(callMark(90, 100, 0, 0.3)).toBe(0);
  });

  it('computes PMCC expiration P/L from strike width and net debit', () => {
    const pnl = scenarioPnl({
      spot: 100,
      daysPassed: 400,
      ivChangePercent: 0,
      legs,
    });
    // Long intrinsic 20, short intrinsic 0, value 2000, debit 1800.
    expect(pnl).toBeCloseTo(200, 5);
  });

  it('loses the net debit when the underlying expires worthless', () => {
    const pnl = scenarioPnl({
      spot: 1,
      daysPassed: 400,
      ivChangePercent: 0,
      legs,
    });
    expect(pnl).toBeCloseTo(-1800, 5);
  });

  it('nets greeks long minus short and leaves a greek blank when a leg is missing it', () => {
    expect(netGreeks(legs).delta).toBeCloseTo(0.64, 5);
    expect(netGreeks([{ ...legs[0]!, gamma: null }, legs[1]!]).gamma).toBeNull();
  });
});

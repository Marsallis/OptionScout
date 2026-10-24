import { describe, expect, it } from 'vitest';
import { SAL_PMCC_DEEP_ITM } from './strategy-profile.js';
import { analyzePmcc, evaluatePmccRules } from './pmcc-math.js';

const asOf = '2026-10-15';

describe('PMCC math', () => {
  it('computes debit, width, breakeven, and extrinsic from the two premiums', () => {
    const analysis = analyzePmcc({
      spot: '100.00',
      asOf,
      long: {
        strike: '80.00',
        expiration: '2028-01-21',
        premium: '22.00',
        bid: '21.40',
        ask: '22.00',
        delta: '0.82',
        gamma: '0.01',
        theta: '-0.02',
        vega: '0.20',
        iv: '0.25',
      },
      short: {
        strike: '100.00',
        expiration: '2026-11-20',
        premium: '4.00',
        bid: '4.00',
        ask: '4.40',
        delta: '0.15',
        gamma: '0.02',
        theta: '-0.04',
        vega: '0.10',
        iv: '0.28',
      },
    });
    expect(analysis.structureOk).toBe(true);
    expect(analysis.netDebitPerShare).toBe('18.00');
    expect(analysis.netDebit).toBe('1800.00');
    expect(analysis.maxProfit).toBe('200.00');
    expect(analysis.maxLoss).toBe('1800.00');
    expect(analysis.breakeven).toBe('98.00');
    expect(analysis.longIntrinsic).toBe('20.00');
    expect(analysis.longExtrinsic).toBe('2.00');
    expect(analysis.shortIntrinsic).toBe('0.00');
    expect(analysis.shortDays).toBeGreaterThan(0);
    expect(analysis.longDays).toBeGreaterThan(analysis.shortDays ?? 0);
  });

  it('refuses a conventional max-profit figure when the short strike is not above the long strike', () => {
    const analysis = analyzePmcc({
      spot: '100.00',
      asOf,
      long: {
        strike: '100.00',
        expiration: '2028-01-21',
        premium: '10.00',
        bid: '9.50',
        ask: '10.00',
        delta: '0.50',
        gamma: null,
        theta: null,
        vega: null,
        iv: null,
      },
      short: {
        strike: '90.00',
        expiration: '2026-11-20',
        premium: '12.00',
        bid: '12.00',
        ask: '12.40',
        delta: '0.60',
        gamma: null,
        theta: null,
        vega: null,
        iv: null,
      },
    });
    expect(analysis.structureOk).toBe(false);
    expect(analysis.maxProfit).toBeNull();
  });

  it('checks saved rules without scoring open interest or volume', () => {
    const check = evaluatePmccRules(SAL_PMCC_DEEP_ITM, {
      spot: '100.00',
      asOf,
      long: {
        strike: '40.00',
        expiration: '2029-01-19',
        premium: '61.50',
        bid: '60.25',
        ask: '61.50',
        delta: '0.82',
        gamma: '0.01',
        theta: '-0.02',
        vega: '0.20',
        iv: '0.25',
      },
      short: {
        strike: '110.00',
        expiration: '2026-11-06',
        premium: '1.20',
        bid: '1.20',
        ask: '1.40',
        delta: '0.15',
        gamma: '0.02',
        theta: '-0.03',
        vega: '0.08',
        iv: '0.30',
      },
    });
    expect(check.long.outcome === 'exact' || check.long.outcome === 'near').toBe(true);
    expect(check.long.unconfigured).toEqual(expect.arrayContaining(['Open-interest minimum is not configured.']));
    expect(check.passes).toBe(true);
  });
});

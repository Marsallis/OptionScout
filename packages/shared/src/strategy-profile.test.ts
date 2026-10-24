import { describe, expect, it } from 'vitest';
import { SAL_PMCC_DEEP_ITM, classifyLongCall, classifyShortCall, downsidePrices, strategyProfileSchema } from './strategy-profile.js';

const complete = {
  contractCost: '5500.00',
  longDelta: '0.82',
  intrinsicPercent: '85',
  expirationDays: 800,
  bidAskSpreadPercent: '1.5',
  openInterest: 500,
  volume: 100,
};

describe('Sal PMCC profile', () => {
  it('stores the deep ITM defaults and does not treat 0.60 delta as a match', () => {
    expect(strategyProfileSchema.parse(SAL_PMCC_DEEP_ITM).name).toBe('Sal PMCC — Deep ITM');
    expect(strategyProfileSchema.parse({ ...SAL_PMCC_DEEP_ITM, hard: { ...SAL_PMCC_DEEP_ITM.hard, minExpirationDays: 0 } }).hard.minExpirationDays).toBe(0);
    expect(strategyProfileSchema.safeParse({ ...SAL_PMCC_DEEP_ITM, hard: { ...SAL_PMCC_DEEP_ITM.hard, minExpirationDays: -1 } }).success).toBe(false);
    expect(SAL_PMCC_DEEP_ITM.references).toEqual([]);
    const configured = {
      ...SAL_PMCC_DEEP_ITM,
      preferences: { ...SAL_PMCC_DEEP_ITM.preferences, maxBidAskSpreadPercent: '8', minOpenInterest: 100, minVolume: 10 },
    };
    expect(classifyLongCall(configured, { ...complete, longDelta: '0.60' }).outcome).toBe('excluded');
    expect(classifyLongCall(configured, complete).outcome).toBe('exact');
    expect(classifyLongCall(configured, { ...complete, expirationDays: 400 }).outcome).toBe('exact');
  });

  it('separates hard failures, preferences, and unconfigured liquidity', () => {
    expect(classifyLongCall(SAL_PMCC_DEEP_ITM, { ...complete, contractCost: '7500.00' }).outcome).toBe('excluded');
    const near = classifyLongCall(SAL_PMCC_DEEP_ITM, { ...complete, longDelta: '0.78', contractCost: '6500.00' });
    expect(near.outcome).toBe('near');
    expect(near.hardFailures).toEqual([]);
    expect(near.preferenceGaps.length).toBeGreaterThan(0);
    expect(near.unconfigured).toContain('Bid/ask spread limit is not configured.');
    expect(classifyLongCall(SAL_PMCC_DEEP_ITM, { ...complete, longDelta: null }).outcome).toBe('incomplete');
  });

  it('flags short-call review bands without a score', () => {
    const selected = classifyShortCall(SAL_PMCC_DEEP_ITM, { delta: '0.15', daysToExpiration: 14, premiumCapturedPercent: '10' });
    expect(selected.outcome).toBe('exact');
    expect(selected).not.toHaveProperty('score');
    const review = classifyShortCall(SAL_PMCC_DEEP_ITM, { delta: '0.32', daysToExpiration: 10, premiumCapturedPercent: '60' });
    expect(review.outcome).toBe('near');
    expect(review.reviews).toContain('Short delta is in the 0.30–0.35 management review band.');
    expect(downsidePrices('100.00', SAL_PMCC_DEEP_ITM.preferences.downsidePercents)?.map((item) => item.price)).toEqual(['85.00', '80.00', '70.00']);
  });
});

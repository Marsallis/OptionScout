import { describe, expect, it } from 'vitest';
import {
  bidAskSpreadDollars,
  bidAskSpreadPercent,
  daysToExpiration,
  deltaCapitalExposure,
  downsideMoneynessPercent,
  downsidePrice,
  estimatedPurchaseCost,
  expirationBreakEven,
  extrinsicValue,
  intrinsicPercent,
  intrinsicValue,
  isCrossedMarket,
  isImpossibleStandardCallIntrinsic,
  midpoint,
  selectEquitySpotPrice,
  strikeDistance,
} from './finder-math.js';

describe('finder math', () => {
  it('calculates intrinsic, cost, extrinsic, and intrinsic percent from the ask', () => {
    expect(intrinsicValue('100.00', '80.00')).toBe('20.00');
    expect(intrinsicValue('100.00', '120.00')).toBe('0.00');
    expect(estimatedPurchaseCost('65.50', 100)).toBe('6550.00');
    expect(extrinsicValue('65.50', '20.00')).toBe('45.50');
    expect(intrinsicPercent('20.00', '25.00')).toBe('80');
  });

  it('calculates spread, break-even, DTE, and downside checks', () => {
    expect(bidAskSpreadDollars('64.00', '65.50')).toBe('1.50');
    expect(bidAskSpreadPercent('64.00', '66.00')).toBe('3.07');
    expect(expirationBreakEven('80.00', '65.50')).toBe('145.50');
    expect(daysToExpiration('2028-01-21', '2026-10-15')).toBe(463);
    expect(strikeDistance('100.00', '80.00')).toBe('20.00');
    expect(downsidePrice('100.00', '15')).toBe('85.00');
    expect(downsideMoneynessPercent('100.00', '80.00', '15')).toBe('5.88');
    expect(deltaCapitalExposure('0.80', '100.00', '20.00')).toBe('4');
    expect(midpoint('64.00', '66.00')).toBe('65.00');
    expect(isCrossedMarket('66.00', '64.00')).toBe(true);
    expect(bidAskSpreadDollars('66.00', '64.00')).toBeNull();
    expect(bidAskSpreadPercent('66.00', '64.00')).toBeNull();
  });

  it('flags impossible standard-call intrinsic when intrinsic exceeds ask', () => {
    // Fictional spot 80 / strike 40 → intrinsic 40; ask 12 → negative extrinsic.
    const intrinsic = intrinsicValue('80.00', '40.00');
    const ask = '12.00';
    const pct = intrinsicPercent(intrinsic, ask);
    expect(intrinsic).toBe('40.00');
    expect(Number(pct)).toBeGreaterThan(100);
    expect(Number(extrinsicValue(ask, intrinsic))).toBeLessThan(0);
    expect(
      isImpossibleStandardCallIntrinsic({
        optionType: 'call',
        standardContract: true,
        supportStatus: 'supported',
        intrinsicPerShare: intrinsic,
        ask,
        intrinsicPercent: pct,
      }),
    ).toBe(true);
    // Does not silently cap at 100.
    expect(Number(pct)).toBeGreaterThan(100);
  });

  it('selects equity mark over a wide ask', () => {
    expect(selectEquitySpotPrice('50.00', '80.00', '50.25')).toBe('50.25');
    expect(selectEquitySpotPrice('50.00', '80.00', null)).toBe('50.00');
    expect(selectEquitySpotPrice('100.00', '100.20', null)).toBe('100.10');
  });
});

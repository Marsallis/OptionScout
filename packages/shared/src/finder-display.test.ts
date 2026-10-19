import { describe, expect, it } from 'vitest';
import { SHOW_PROFILE_MISSES, evaluateContract, type DiscoveryContract, type DiscoveryReason } from './discovery.js';
import {
  PREFERENCE_GAP_THRESHOLDS,
  formatContractDisplay,
  bidAskSpreadWarning,
  formatSpreadDisplay,
  WIDE_BID_ASK_SPREAD_PERCENT,
  formatUsd,
  summarizePreferenceGaps,
} from './finder-display.js';
import { bidAskSpreadPercent, isCrossedMarket } from './finder-math.js';
import { SAL_PMCC_DEEP_ITM } from './strategy-profile.js';

function reason(overrides: Partial<DiscoveryReason> & Pick<DiscoveryReason, 'metric' | 'kind' | 'passed'>): DiscoveryReason {
  return {
    target: null,
    actual: null,
    difference: null,
    text: 'test',
    ...overrides,
  };
}

function baseContract(overrides: Partial<DiscoveryContract> = {}): DiscoveryContract {
  return {
    id: 'c1',
    underlying: 'QCOM',
    symbol: 'QCOM  281215C00040000',
    contractCost: '5500.00',
    delta: '0.80',
    intrinsicPercent: '80',
    extrinsicValue: null,
    bid: '54.00',
    ask: '55.00',
    bidAskSpreadPercent: '1.82',
    openInterest: 100,
    volume: 10,
    expirationDays: 700,
    theta: '-0.02',
    underlyingPrice: '100.00',
    strike: '40.00',
    downsidePercent: '15',
    quantity: 1,
    multiplier: 100,
    dataQuality: 'usable',
    shortCandidate: null,
    ...overrides,
  };
}

describe('finder display helpers', () => {
  it('formats readable contract labels and money', () => {
    expect(
      formatContractDisplay({
        underlying: 'QCOM',
        strike: '40.00',
        optionType: 'call',
        expiration: '2028-12-15',
      }),
    ).toBe('QCOM • $40 Call • Dec 15, 2028');
    expect(formatUsd('5500.00')).toBe('$5,500.00');
  });

  it('labels small vs significant preference gaps', () => {
    const smallDelta = summarizePreferenceGaps([
      reason({
        metric: 'delta',
        kind: 'preference',
        passed: false,
        target: '0.80',
        actual: '0.78',
        text: 'Delta below preferred',
      }),
    ]);
    expect(smallDelta.severity).toBe('small');
    expect(smallDelta.label).toBe('Small preference gap');

    const smallIntrinsic = summarizePreferenceGaps([
      reason({
        metric: 'intrinsicPercent',
        kind: 'preference',
        passed: false,
        target: '80',
        actual: '78',
        text: 'Intrinsic below preferred',
      }),
    ]);
    expect(smallIntrinsic.severity).toBe('small');

    const significantIntrinsic = summarizePreferenceGaps([
      reason({
        metric: 'intrinsicPercent',
        kind: 'preference',
        passed: false,
        target: '80',
        actual: '0',
        text: 'Intrinsic far below preferred',
      }),
    ]);
    expect(significantIntrinsic.severity).toBe('significant');
    expect(significantIntrinsic.label).toBe('Significant preference gap');
    expect(PREFERENCE_GAP_THRESHOLDS.smallDeltaShortfall).toBe(0.05);
  });

  it('warns on wide or invalid spreads without treating that width as a strategy score', () => {
    expect(WIDE_BID_ASK_SPREAD_PERCENT).toBe(5);
    expect(bidAskSpreadWarning({ bidAskSpreadPercent: '4.9' })).toBeNull();
    expect(bidAskSpreadWarning({ bidAskSpreadPercent: '5' })).toMatch(/Wide bid\/ask spread: 5%/);
    expect(bidAskSpreadWarning({ bidAskSpreadPercent: null, crossedMarket: true })).toMatch(/crossed or invalid/);
    expect(bidAskSpreadWarning({ bidAskSpreadPercent: '-1' })).toMatch(/crossed or invalid/);
  });

  it('keeps crossed markets Incomplete and excludes negative spreads from ranking metrics', () => {
    expect(isCrossedMarket('8.00', '7.50')).toBe(true);
    expect(bidAskSpreadPercent('8.00', '7.50')).toBeNull();
    expect(formatSpreadDisplay({ crossedMarket: true, invalidPrice: false, bidAskSpreadPercent: null }).text).toBe(
      'Crossed/invalid market',
    );

    const row = evaluateContract(SAL_PMCC_DEEP_ITM, SHOW_PROFILE_MISSES, baseContract({
      bid: '8.00',
      ask: '7.50',
      bidAskSpreadPercent: null,
      dataQuality: 'inconsistent',
      contractCost: '750.00',
      delta: '0.60',
      intrinsicPercent: '0',
    }));
    expect(row.outcome).toBe('incomplete');
    expect(row.metrics.bidAskSpread).toBeNull();
    expect(row.usableForComparison).toBe(false);
  });

  it('classifies hard budget misses as Outside Profile without changing exploratory empty defaults', () => {
    const overBudget = evaluateContract(SAL_PMCC_DEEP_ITM, SHOW_PROFILE_MISSES, baseContract({
      contractCost: '8500.00',
      delta: '0.82',
      intrinsicPercent: '90',
    }));
    expect(overBudget.outcome).toBe('outside-profile');

    const emptyExploration = evaluateContract(SAL_PMCC_DEEP_ITM, { ...SHOW_PROFILE_MISSES, minLongDelta: null }, baseContract({
      delta: '0.60',
    }));
    expect(emptyExploration.withinExploration).toBe(true);
    expect(SHOW_PROFILE_MISSES.minLongDelta).toBeNull();
    expect(SAL_PMCC_DEEP_ITM.hard.minLongDelta).toBe('0.75');
    expect(SAL_PMCC_DEEP_ITM.preferences.preferredLongDelta).toBe('0.80');
  });
});

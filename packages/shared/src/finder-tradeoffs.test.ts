import { describe, expect, it } from 'vitest';
import { exploreTradeoffs, toTradeoffView, type TradeoffCandidateView } from './finder-tradeoffs.js';

function view(partial: Partial<TradeoffCandidateView> & Pick<TradeoffCandidateView, 'id' | 'label'>): TradeoffCandidateView {
  return {
    outcome: 'near',
    askCost: null,
    delta: null,
    intrinsicPercent: null,
    extrinsicPerShare: null,
    spreadPercent: null,
    daysToExpiration: 500,
    downsideMoneyness: null,
    crossedOrInvalidSpread: false,
    missingGreeks: false,
    ...partial,
  };
}

describe('exploreTradeoffs', () => {
  it('ranks by selected criteria and surfaces budget vs delta conflicts', () => {
    const candidates = [
      view({ id: 'a', label: 'A', askCost: 6500, delta: 0.62, intrinsicPercent: 70, extrinsicPerShare: 8, missingGreeks: true }),
      view({ id: 'b', label: 'B', askCost: 8200, delta: 0.82, intrinsicPercent: 85, extrinsicPerShare: 12, missingGreeks: true }),
      view({ id: 'c', label: 'C', askCost: 5900, delta: 0.7, intrinsicPercent: 65, extrinsicPerShare: 5, missingGreeks: true }),
    ];
    const result = exploreTradeoffs(candidates, ['best-within-budget', 'highest-delta'], { maxContractCost: 7000, minLongDelta: null }, {
      remainingUnevaluated: 400,
      hardMaxBudget: 7000,
      hardMinDelta: 0.75,
    });
    expect(result.ranked[0]?.id).toBe('c');
    expect(result.conflicts.some((row) => row.code === 'budget-delta-conflict')).toBe(true);
    expect(result.conflicts.find((row) => row.code === 'budget-delta-conflict')?.text).toMatch(/400 contracts remain/);
    expect(result.conflicts.some((row) => row.code === 'missing-greeks-common')).toBe(true);
  });

  it('draft filters do not invent matches when empty', () => {
    const candidates = [view({ id: 'a', label: 'A', askCost: 8000, delta: 0.8 })];
    const result = exploreTradeoffs(candidates, ['highest-delta'], { maxContractCost: 7000, minLongDelta: 0.75 }, {
      remainingUnevaluated: 10,
    });
    expect(result.matchedCount).toBe(0);
    expect(result.conflicts.some((row) => row.code === 'explorer-filter-empty' || row.code === 'none-in-budget-among-evaluated')).toBe(true);
  });

  it('toTradeoffView maps candidate fields without fabricating deltas', () => {
    const mapped = toTradeoffView({
      id: '1',
      label: 'AAPL 200C',
      outcome: 'incomplete',
      delta: null,
      flags: { crossedMarket: false, invalidPrice: false, missingGreeks: true },
      calculations: {
        estimatedPurchaseCost: '5500.00',
        intrinsicPercent: '80.00',
        extrinsicValue: '5.00',
        bidAskSpreadPercent: '1.20',
        daysToExpiration: 600,
        downsideMoneyness15: '12.00',
      },
    });
    expect(mapped.delta).toBeNull();
    expect(mapped.missingGreeks).toBe(true);
    expect(mapped.askCost).toBe(5500);
  });
});

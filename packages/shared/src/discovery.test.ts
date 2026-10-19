import { describe, expect, it } from 'vitest';
import { SAL_PMCC_DEEP_ITM } from './strategy-profile.js';
import {
  SHOW_PROFILE_MISSES,
  compareContracts,
  discoverContracts,
  filterDiscovery,
  paretoFront,
  sortDiscovery,
  type DiscoveryContract,
} from './discovery.js';

const configured = {
  ...SAL_PMCC_DEEP_ITM,
  preferences: { ...SAL_PMCC_DEEP_ITM.preferences, maxBidAskSpreadPercent: '8', minOpenInterest: 100, minVolume: 10 },
};

function contract(overrides: Partial<DiscoveryContract> = {}): DiscoveryContract {
  return {
    id: 'cvx-2028',
    underlying: 'CVX',
    symbol: 'CVX   280121C00155000',
    contractCost: '5500.00',
    delta: '0.82',
    intrinsicPercent: '85',
    extrinsicValue: null,
    bid: '54.00',
    ask: '56.00',
    bidAskSpreadPercent: null,
    openInterest: 500,
    volume: 100,
    expirationDays: 800,
    theta: '-0.02',
    underlyingPrice: '160.00',
    strike: '155.00',
    downsidePercent: '15',
    quantity: 1,
    multiplier: 100,
    dataQuality: 'usable',
    shortCandidate: null,
    ...overrides,
  };
}

describe('inclusive LEAPS discovery', () => {
  it('keeps preference misses visible and leaves the saved profile unchanged', () => {
    const frozen = structuredClone(SAL_PMCC_DEEP_ITM);
    const rows = discoverContracts(configured, { ...SHOW_PROFILE_MISSES, minLongDelta: '0.65' }, [
      contract(),
      contract({ id: 'near', delta: '0.78', contractCost: '6500.00' }),
      contract({ id: 'inspect', delta: '0.70' }),
      contract({ id: 'farther', delta: '0.60' }),
    ]);
    expect(SAL_PMCC_DEEP_ITM.hard.minLongDelta).toBe(frozen.hard.minLongDelta);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.visible)).toBe(true);
    expect(rows.map((row) => row.outcome)).toEqual(['exact', 'near', 'outside-profile', 'outside-profile']);
    const near = rows[1]!;
    expect(near.label).toBe('Near Match');
    expect(near.reasons.find((reason) => reason.kind === 'preference' && reason.metric === 'delta')).toMatchObject({
      target: '0.80',
      actual: '0.78',
      difference: '-0.02',
    });
    const inspected = rows[2]!;
    expect(inspected.label).toBe('Outside Profile');
    expect(inspected.withinExploration).toBe(true);
    expect(inspected.reasons.find((reason) => reason.kind === 'hard' && reason.metric === 'delta')?.text).toContain('0.05 below');
    expect(rows[3]?.withinExploration).toBe(false);
    expect(filterDiscovery(rows)).toHaveLength(4);
    expect(filterDiscovery(rows, { withinExplorationOnly: true }).map((row) => row.id)).not.toContain('farther');
    expect(JSON.stringify(rows)).not.toMatch(/score|probability|sentiment/i);
  });

  it('treats stale, missing, and inconsistent data as incomplete', () => {
    const rows = discoverContracts(configured, SHOW_PROFILE_MISSES, [
      contract({ id: 'stale', dataQuality: 'stale' }),
      contract({ id: 'missing', delta: null, dataQuality: 'missing' }),
      contract({ id: 'crossed', bid: '60.00', ask: '50.00' }),
    ]);
    expect(rows.map((row) => row.outcome)).toEqual(['incomplete', 'incomplete', 'incomplete']);
    expect(rows.every((row) => row.usableForComparison === false && row.visible)).toBe(true);
    expect(rows[0]?.reasons[0]?.text).toContain('not a valid opportunity');
  });

  it('sorts, filters, compares, and finds Pareto tradeoffs across underlyings', () => {
    const rows = discoverContracts(configured, SHOW_PROFILE_MISSES, [
      contract({ id: 'cheap', underlying: 'CVX', contractCost: '5000.00', delta: '0.70' }),
      contract({ id: 'balanced', underlying: 'XOM', contractCost: '6500.00', delta: '0.85' }),
      contract({ id: 'dominated', underlying: 'XOM', contractCost: '6800.00', delta: '0.68' }),
      contract({ id: 'stale', underlying: 'CVX', dataQuality: 'stale', contractCost: '1000.00', delta: '0.99' }),
    ]);
    expect(new Set(rows.map((row) => row.underlying))).toEqual(new Set(['CVX', 'XOM']));
    expect(filterDiscovery(rows, { underlying: 'CVX' }).every((row) => row.underlying === 'CVX')).toBe(true);
    expect(sortDiscovery(rows, 'purchaseCost', 'lower').map((row) => row.id)[0]).toBe('stale');
    const front = paretoFront(rows, [
      { metric: 'purchaseCost', direction: 'lower' },
      { metric: 'delta', direction: 'higher' },
    ]).map((row) => row.id);
    expect(front.sort()).toEqual(['balanced', 'cheap']);
    expect(paretoFront(rows, [])).toEqual([]);
    const compared = compareContracts(rows[0]!, rows[1]!, ['purchaseCost', 'delta']);
    expect(compared[0]?.difference).toBe(-150000);
    expect(compared[1]?.difference).toBe(-1500);
  });
});

import { describe, expect, it } from 'vitest';
import { parseNestedOptionChain, type NestedChainContract } from './chain.js';
import { demoNestedChainPayload } from './demo-chain.js';
import {
  buildBudgetAwareQueue,
  orderEligibleQueue,
  selectCallableContracts,
  takeNextFromQueue,
  type ObservedAskCost,
} from './selection.js';

describe('budget-aware selection', () => {
  it('samples representatively across expirations and still surfaces near-ideal floors early', () => {
    const parsed = parseNestedOptionChain(demoNestedChainPayload('DEMO'), 'DEMO');
    const plan = buildBudgetAwareQueue(parsed.contracts, '100.00', { idealCost: 6000, hardMaxCost: 7000 });
    const first = selectCallableContracts(parsed.contracts, 8, 365, '100.00', 6000, 7000);
    expect(plan.eligibleCount).toBeGreaterThan(8);
    expect(first.length).toBe(8);
    expect(plan.algorithm).toMatch(/Unified candidate-selection engine/i);
    // Floor for strike 40 at stock 100 is 6000 — under-cap closest-to-ideal pass should include it early.
    expect(first.some((row) => row.strike === '40.00')).toBe(true);
    const expirations = new Set(first.map((row) => row.expiration));
    expect(expirations.size).toBeGreaterThan(1);
    // Deepest ITM alone must not monopolize the first batch.
    expect(first.filter((row) => Number(row.strike) <= 15).length).toBeLessThan(first.length);
  });

  it('queues every eligible LEAPS and supports progressive take without duplicates', () => {
    const parsed = parseNestedOptionChain(demoNestedChainPayload('DEMO'), 'DEMO');
    const plan = buildBudgetAwareQueue(parsed.contracts, '100.00', { idealCost: 6000, hardMaxCost: 7000 });
    const evaluated = new Set<string>();
    const first = takeNextFromQueue(plan.queue, 0, 5, evaluated);
    for (const row of first.batch) evaluated.add(row.occSymbol);
    const second = takeNextFromQueue(plan.queue, first.nextOffset, 5, evaluated);
    for (const row of second.batch) evaluated.add(row.occSymbol);
    expect(first.batch).toHaveLength(5);
    expect(second.batch).toHaveLength(5);
    expect(new Set([...first.batch, ...second.batch].map((row) => row.occSymbol)).size).toBe(10);
    let offset = second.nextOffset;
    let guard = 0;
    while (evaluated.size < plan.eligibleCount && guard < 50) {
      const next = takeNextFromQueue(plan.queue, offset, 8, evaluated);
      offset = next.nextOffset;
      for (const row of next.batch) evaluated.add(row.occSymbol);
      if (next.batch.length === 0) break;
      guard += 1;
    }
    expect(evaluated.size).toBe(plan.eligibleCount);
  });

  it('ranks deeper ITM ahead of cheaper OTM under closest-to-strategy when both are under hard', () => {
    const base = {
      underlying: 'DEMO',
      rootSymbol: 'DEMO',
      optionType: 'call' as const,
      expiration: '2028-01-21',
      daysToExpiration: 463,
      multiplier: 100,
      chainType: 'Standard',
      settlementType: 'PM',
      expirationType: 'Regular',
      deliverables: [],
      standardContract: true,
      supportStatus: 'supported' as const,
      supportNote: 'ok',
      active: true,
      closingOnly: false,
    };
    const deeperItm: NestedChainContract = {
      ...base,
      occSymbol: 'DEMO  280121C00040000',
      streamerSymbol: '.DEMO280121C40',
      strike: '40.00',
    };
    const cheaperOtm: NestedChainContract = {
      ...base,
      occSymbol: 'DEMO  280121C00110000',
      streamerSymbol: '.DEMO280121C110',
      strike: '110.00',
    };
    // Observed asks keep both under the hard cap; OTM is cheaper but shallower.
    const observations: ObservedAskCost[] = [
      {
        occSymbol: deeperItm.occSymbol,
        expiration: deeperItm.expiration,
        strike: 40,
        intrinsicFloor: 6000,
        askCost: 6500,
        extrinsicPerShare: 5,
      },
      {
        occSymbol: cheaperOtm.occSymbol,
        expiration: cheaperOtm.expiration,
        strike: 110,
        intrinsicFloor: 0,
        askCost: 400,
        extrinsicPerShare: 4,
      },
    ];
    const plan = orderEligibleQueue({
      contracts: [cheaperOtm, deeperItm],
      stockPrice: '100.00',
      budgets: { idealCost: 6000, hardMaxCost: 7000 },
      priority: 'closest-to-strategy',
      observations,
    });
    expect(plan.queue.map((row) => row.strike)).toEqual(['40.00', '110.00']);
  });
});

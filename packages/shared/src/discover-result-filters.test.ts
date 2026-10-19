import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_SAVED_PROFILE, buildCvxJan2029AcceptanceCandidate, buildWmtJan2029AcceptanceCandidate } from './plan-fit-acceptance-fixtures.js';
import {
  EMPTY_DISCOVER_RESULT_FILTERS,
  countActiveDiscoverFilters,
  filterDiscoverCandidates,
} from './discover-result-filters.js';

describe('discover-result-filters (client-only)', () => {
  const wmt = buildWmtJan2029AcceptanceCandidate({ id: 'wmt' });
  const cvx = buildCvxJan2029AcceptanceCandidate({ id: 'cvx' });
  const over = buildWmtJan2029AcceptanceCandidate({
    id: 'over',
    calculations: {
      ...buildWmtJan2029AcceptanceCandidate().calculations,
      estimatedPurchaseCost: '26000.00',
    },
    meetsConfiguredNumericRequirements: false,
    outcome: 'outside-profile',
  });

  it('filters by max cost without inventing missing costs as zero', () => {
    const rows = filterDiscoverCandidates([wmt, cvx, over], ACCEPTANCE_SAVED_PROFILE, {
      ...EMPTY_DISCOVER_RESULT_FILTERS,
      maxCost: 6000,
    });
    expect(rows.map((r) => r.id)).toEqual(['wmt']);
  });

  it('filters by ticker search and eligibility', () => {
    const byTicker = filterDiscoverCandidates([wmt, cvx], ACCEPTANCE_SAVED_PROFILE, {
      ...EMPTY_DISCOVER_RESULT_FILTERS,
      search: 'cvx',
    });
    expect(byTicker.map((r) => r.id)).toEqual(['cvx']);

    const eligible = filterDiscoverCandidates([wmt, over], ACCEPTANCE_SAVED_PROFILE, {
      ...EMPTY_DISCOVER_RESULT_FILTERS,
      eligibility: 'eligible',
    });
    expect(eligible.map((r) => r.id)).toEqual(['wmt']);
  });

  it('does not mutate the input array', () => {
    const input = [wmt, cvx];
    const copy = [...input];
    filterDiscoverCandidates(input, ACCEPTANCE_SAVED_PROFILE, {
      ...EMPTY_DISCOVER_RESULT_FILTERS,
      maxCost: 7000,
    });
    expect(input).toEqual(copy);
  });

  it('counts active filters', () => {
    expect(countActiveDiscoverFilters(EMPTY_DISCOVER_RESULT_FILTERS)).toBe(0);
    expect(
      countActiveDiscoverFilters({
        ...EMPTY_DISCOVER_RESULT_FILTERS,
        maxCost: 5000,
        eligibility: 'eligible',
      }),
    ).toBe(2);
  });
});

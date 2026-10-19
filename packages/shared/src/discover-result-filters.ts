/**
 * Client-side Discover result filters (display-only).
 * Never triggers brokerage calls or mutates strategy profiles.
 */

import type { FinderCandidate } from './finder.js';
import { buildPlanFitSummary, type StrategyEligibility } from './plan-fit.js';
import type { StrategyProfile } from './strategy-profile.js';

export type DiscoverDataFreshnessFilter = 'any' | 'Live' | 'Previous Session' | 'Cached' | 'Older' | 'Partial';

export type DiscoverPrefsFilter = 'any' | 'all-met' | 'some-missed';

export type DiscoverMissingDataFilter = 'any' | 'has-missing' | 'fully-assessed';

export interface DiscoverResultFilters {
  search: string;
  tickers: string[];
  minCost: number | null;
  maxCost: number | null;
  minDelta: number | null;
  minIntrinsicPercent: number | null;
  minDte: number | null;
  maxDte: number | null;
  maxSpreadPercent: number | null;
  eligibility: 'any' | StrategyEligibility;
  prefs: DiscoverPrefsFilter;
  missingData: DiscoverMissingDataFilter;
  freshness: DiscoverDataFreshnessFilter;
  savedOnly: boolean;
}

export const EMPTY_DISCOVER_RESULT_FILTERS: DiscoverResultFilters = {
  search: '',
  tickers: [],
  minCost: null,
  maxCost: null,
  minDelta: null,
  minIntrinsicPercent: null,
  minDte: null,
  maxDte: null,
  maxSpreadPercent: null,
  eligibility: 'any',
  prefs: 'any',
  missingData: 'any',
  freshness: 'any',
  savedOnly: false,
};

function num(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function countActiveDiscoverFilters(filters: DiscoverResultFilters): number {
  let n = 0;
  if (filters.search.trim()) n += 1;
  if (filters.tickers.length > 0) n += 1;
  if (filters.minCost != null) n += 1;
  if (filters.maxCost != null) n += 1;
  if (filters.minDelta != null) n += 1;
  if (filters.minIntrinsicPercent != null) n += 1;
  if (filters.minDte != null) n += 1;
  if (filters.maxDte != null) n += 1;
  if (filters.maxSpreadPercent != null) n += 1;
  if (filters.eligibility !== 'any') n += 1;
  if (filters.prefs !== 'any') n += 1;
  if (filters.missingData !== 'any') n += 1;
  if (filters.freshness !== 'any') n += 1;
  if (filters.savedOnly) n += 1;
  return n;
}

export function describeActiveDiscoverFilters(filters: DiscoverResultFilters): string[] {
  const chips: string[] = [];
  if (filters.search.trim()) chips.push(`Search: ${filters.search.trim()}`);
  if (filters.tickers.length > 0) chips.push(`Tickers: ${filters.tickers.join(', ')}`);
  if (filters.minCost != null) chips.push(`Min cost $${filters.minCost.toLocaleString('en-US')}`);
  if (filters.maxCost != null) chips.push(`Max cost $${filters.maxCost.toLocaleString('en-US')}`);
  if (filters.minDelta != null) chips.push(`Min delta ${filters.minDelta}`);
  if (filters.minIntrinsicPercent != null) chips.push(`Min intrinsic ${filters.minIntrinsicPercent}%`);
  if (filters.minDte != null) chips.push(`Min DTE ${filters.minDte}`);
  if (filters.maxDte != null) chips.push(`Max DTE ${filters.maxDte}`);
  if (filters.maxSpreadPercent != null) chips.push(`Max spread ${filters.maxSpreadPercent}%`);
  if (filters.eligibility !== 'any') chips.push(`Eligibility: ${filters.eligibility}`);
  if (filters.prefs === 'all-met') chips.push('All preferences met');
  if (filters.prefs === 'some-missed') chips.push('Some preferences missed');
  if (filters.missingData === 'has-missing') chips.push('Has missing data');
  if (filters.missingData === 'fully-assessed') chips.push('Fully assessed');
  if (filters.freshness !== 'any') chips.push(`Data: ${filters.freshness}`);
  if (filters.savedOnly) chips.push('Saved only');
  return chips;
}

/**
 * Filter evaluated candidates in-memory. Does not call market data or mutate inputs.
 */
export function filterDiscoverCandidates(
  candidates: readonly FinderCandidate[],
  profile: StrategyProfile,
  filters: DiscoverResultFilters,
  savedIds: ReadonlySet<string> = new Set(),
): FinderCandidate[] {
  const search = filters.search.trim().toLowerCase();
  const tickerSet = new Set(filters.tickers.map((t) => t.toUpperCase()));

  return candidates.filter((candidate) => {
    if (tickerSet.size > 0 && !tickerSet.has(candidate.underlying.toUpperCase())) return false;

    if (search) {
      const hay = `${candidate.underlying} ${candidate.occSymbol}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }

    const cost = num(candidate.calculations.estimatedPurchaseCost);
    if (filters.minCost != null) {
      if (cost == null || cost < filters.minCost) return false;
    }
    if (filters.maxCost != null) {
      if (cost == null || cost > filters.maxCost) return false;
    }

    const delta = candidate.greekVerification === 'aligned' ? num(candidate.delta) : null;
    if (filters.minDelta != null) {
      if (delta == null || delta < filters.minDelta) return false;
    }

    const intrinsic = num(candidate.calculations.intrinsicPercent);
    if (filters.minIntrinsicPercent != null) {
      if (intrinsic == null || intrinsic < filters.minIntrinsicPercent) return false;
    }

    const dte = candidate.calculations.daysToExpiration;
    if (filters.minDte != null) {
      if (dte == null || dte < filters.minDte) return false;
    }
    if (filters.maxDte != null) {
      if (dte == null || dte > filters.maxDte) return false;
    }

    const spread = num(candidate.calculations.bidAskSpreadPercent);
    if (filters.maxSpreadPercent != null) {
      if (spread == null || spread > filters.maxSpreadPercent) return false;
    }

    const fit = buildPlanFitSummary(candidate, profile);

    if (filters.eligibility !== 'any' && fit.eligibility !== filters.eligibility) return false;

    if (filters.prefs === 'all-met' && fit.matchGroup !== 'eligible-all-prefs-met') return false;
    if (filters.prefs === 'some-missed' && fit.matchGroup !== 'eligible-preference-differences') return false;

    if (filters.missingData === 'has-missing' && fit.notAssessedCount === 0 && !fit.notEnoughData) return false;
    if (filters.missingData === 'fully-assessed' && (fit.notAssessedCount > 0 || fit.notEnoughData)) return false;

    if (filters.freshness !== 'any' && fit.dataConfidenceLabel !== filters.freshness) return false;

    if (filters.savedOnly && !savedIds.has(candidate.id)) return false;

    return true;
  });
}

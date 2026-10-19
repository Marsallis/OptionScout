/**
 * Display-only and exploratory Finder filters.
 * Changing these never silently rewrites a saved strategy profile.
 * Filters that only affect displayed rows must not trigger brokerage requests.
 */

import { z } from 'zod';
import type { FinderCandidate } from './finder.js';

const moneyText = z.string().regex(/^\d+\.\d{2}$/);
const percentText = z.string().regex(/^\d+(\.\d{1,2})?$/);
const decimalText = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const SCAN_MORE_PRIORITIES = [
  'closest-to-strategy',
  'within-budget',
  'higher-delta',
  'higher-intrinsic',
  'broader-exploration',
] as const;

export type ScanMorePriority = (typeof SCAN_MORE_PRIORITIES)[number];

export const SCAN_MORE_PRIORITY_LABELS: Record<ScanMorePriority, { label: string; explanation: string }> = {
  'closest-to-strategy': {
    label: 'Closest to my saved strategy',
    explanation: 'Next checks prioritize contracts whose estimated cost and moneyness are nearest your saved hard/preferred targets. Not a quality score.',
  },
  'within-budget': {
    label: 'Within my budget',
    explanation: 'Next checks prioritize unevaluated contracts more likely to sit under your hard maximum cost, using observed asks when available.',
  },
  'higher-delta': {
    label: 'Higher delta',
    explanation: 'Next checks prioritize deeper in-the-money strikes (higher expected delta). Actual Greeks still come from the provider.',
  },
  'higher-intrinsic': {
    label: 'Higher intrinsic percentage',
    explanation: 'Next checks prioritize deeper intrinsic floors relative to estimated premium. Not a recommendation.',
  },
  'broader-exploration': {
    label: 'Broader exploration',
    explanation: 'Next checks spread across expirations and moneyness bands, including off-profile contracts for learning.',
  },
};

/** Session display filters — do not persist into the strategy profile. */
export const finderDisplayFilterSchema = z
  .object({
    minContractCost: moneyText.nullable(),
    maxContractCost: moneyText.nullable(),
    minDelta: decimalText.nullable(),
    minIntrinsicPercent: percentText.nullable(),
    minDaysToExpiration: z.number().int().positive().nullable(),
    maxDaysToExpiration: z.number().int().positive().nullable(),
    maxBidAskSpreadPercent: percentText.nullable(),
    maxExtrinsicDollars: moneyText.nullable(),
    maxExtrinsicPercent: percentText.nullable(),
    maxStrikeDistancePercent: percentText.nullable(),
    outcomes: z.array(z.enum(['exact', 'near', 'outside-profile', 'incomplete'])).nullable(),
    requireUsableQuote: z.boolean(),
    requireProviderGreeks: z.boolean(),
  })
  .strict();

export type FinderDisplayFilter = z.infer<typeof finderDisplayFilterSchema>;

export const EMPTY_DISPLAY_FILTER: FinderDisplayFilter = {
  minContractCost: null,
  maxContractCost: null,
  minDelta: null,
  minIntrinsicPercent: null,
  minDaysToExpiration: null,
  maxDaysToExpiration: null,
  maxBidAskSpreadPercent: null,
  maxExtrinsicDollars: null,
  maxExtrinsicPercent: null,
  maxStrikeDistancePercent: null,
  outcomes: null,
  requireUsableQuote: false,
  requireProviderGreeks: false,
};

export type FilterAvailability = 'assessable' | 'unassessed' | 'not-available-yet' | 'missing-on-row';

export interface FilterAvailabilityNote {
  key: string;
  label: string;
  availability: FilterAvailability;
  text: string;
}

export function metricAvailabilityNotes(candidates: readonly FinderCandidate[]): FilterAvailabilityNote[] {
  const supported = candidates.filter((row) => row.supportStatus === 'supported');
  const notes: FilterAvailabilityNote[] = [];
  const oiPresent = supported.some((row) => row.openInterest != null);
  const volPresent = supported.some((row) => row.volume != null);
  notes.push({
    key: 'openInterest',
    label: 'Open interest',
    availability: oiPresent ? 'assessable' : 'not-available-yet',
    text: oiPresent
      ? 'Open interest is present on at least one evaluated row.'
      : 'Open interest is not available yet from the current Finder quote path — shown as Unassessed, not as a pass.',
  });
  notes.push({
    key: 'volume',
    label: 'Trading volume',
    availability: volPresent ? 'assessable' : 'not-available-yet',
    text: volPresent
      ? 'Volume is present on at least one evaluated row.'
      : 'Volume is often missing or sparse after hours — Unassessed when blank.',
  });
  const greekMissing = supported.filter((row) => row.flags.missingGreeks).length;
  if (greekMissing > 0) {
    notes.push({
      key: 'greeks',
      label: 'Provider Greeks',
      availability: 'missing-on-row',
      text: `${greekMissing} evaluated contract(s) lack provider Greeks. Missing deltas stay incomplete — not invented.`,
    });
  }
  return notes;
}

function num(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Client-side filter of already-evaluated candidates. Never triggers brokerage I/O. */
export function applyDisplayFilters(
  candidates: readonly FinderCandidate[],
  filter: FinderDisplayFilter,
): FinderCandidate[] {
  return candidates.filter((row) => {
    if (filter.outcomes && filter.outcomes.length > 0 && !filter.outcomes.includes(row.outcome)) return false;
    if (filter.requireUsableQuote && (row.ask == null || row.dataQuality !== 'usable')) return false;
    if (filter.requireProviderGreeks && row.flags.missingGreeks) return false;

    const cost = num(row.calculations.estimatedPurchaseCost);
    const minCost = num(filter.minContractCost);
    const maxCost = num(filter.maxContractCost);
    if (minCost != null && (cost == null || cost < minCost)) return false;
    if (maxCost != null && (cost == null || cost > maxCost)) return false;

    const delta = num(row.delta);
    const minDelta = num(filter.minDelta);
    if (minDelta != null && (delta == null || delta < minDelta)) return false;

    const intrinsic = num(row.calculations.intrinsicPercent);
    const minIntrinsic = num(filter.minIntrinsicPercent);
    if (minIntrinsic != null && (intrinsic == null || intrinsic < minIntrinsic)) return false;

    const dte = row.calculations.daysToExpiration;
    if (filter.minDaysToExpiration != null && (dte == null || dte < filter.minDaysToExpiration)) return false;
    if (filter.maxDaysToExpiration != null && (dte == null || dte > filter.maxDaysToExpiration)) return false;

    const spread = num(row.calculations.bidAskSpreadPercent);
    const maxSpread = num(filter.maxBidAskSpreadPercent);
    if (maxSpread != null && (spread == null || spread < 0 || spread > maxSpread)) return false;

    const extrinsic = num(row.calculations.extrinsicValue);
    const maxExt = num(filter.maxExtrinsicDollars);
    if (maxExt != null && (extrinsic == null || extrinsic > maxExt)) return false;

    return true;
  });
}

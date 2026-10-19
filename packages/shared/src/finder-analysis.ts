/**
 * Beginner-first analysis helpers for contract review and comparison.
 * Deterministic templates only — no AI scoring or buy recommendations.
 */

import type { FinderCandidate } from './finder.js';
import { estimatedPurchaseCost, expirationBreakEven, extrinsicValue, intrinsicPercent, intrinsicValue } from './finder-math.js';
import type { StrategyProfile } from './strategy-profile.js';

export type StrategyFitStatus = 'pass' | 'preferred-miss' | 'hard-fail' | 'not-assessed';

export interface StrategyFitRow {
  id: string;
  requirement: string;
  yourTarget: string;
  thisContract: string;
  status: StrategyFitStatus;
  explanation: string;
}

export interface PremiumBreakdown {
  askPerShare: string | null;
  costPerContract: string | null;
  intrinsicPerShare: string | null;
  intrinsicPerContract: string | null;
  extrinsicPerShare: string | null;
  extrinsicPerContract: string | null;
  intrinsicPercent: string | null;
  intrinsicShareOfPremium: number | null;
  extrinsicShareOfPremium: number | null;
}

export interface ExpirationPayoffPoint {
  label: string;
  stockPrice: string;
  callValuePerShare: string;
  profitPerContract: string;
  kind: 'downside' | 'spot' | 'upside' | 'breakeven' | 'custom';
}

export interface QuoteStatusCopy {
  label: string;
  detail: string;
}

/** Progress chip tooltips — count meanings (not investment recommendations). */
export const FINDER_PROGRESS_CHIP_TOOLTIPS = {
  examined:
    'Examined: contracts we attempted to measure this session.',
  fullyEvaluated:
    'Fully evaluated: enough measurements to classify fit — not a buy recommendation.',
  partiallyEvaluated:
    'Partially evaluated: required measurements missing or stale — not pass, not confirmed fail.',
  incomplete:
    'Incomplete: required measurements missing or stale — not pass, not confirmed fail.',
  meetAssessableRules:
    'Meet assessable rules: valid aligned measurements that satisfy configured hard/numeric rules.',
  withinBudget: 'Within budget: estimated purchase cost under hard max.',
  stillUnexplored: 'Still unexplored: eligible but not yet evaluated.',
  nearMatches: 'Near matches: evaluated contracts that miss a preference while passing hard rules (or staying close).',
  verifiedMatches:
    'Verified matches: Greeks aligned with the quote and configured hard/numeric rules are met. Not a buy recommendation.',
  unverifiedCandidates:
    'Unverified candidates: Greeks historical/unverified, unavailable, or data incomplete — fit is not confirmed.',
} as const;

export function observationFreshnessLabel(
  value: FinderCandidate['observationFreshness'],
): string {
  if (value === 'current-session') return 'Current session';
  if (value === 'previous-session') return 'Previous session';
  if (value === 'older') return 'Older observation';
  return 'Freshness unavailable';
}

export function greekVerificationLabel(value: FinderCandidate['greekVerification']): string {
  if (value === 'aligned') return 'Greeks aligned';
  if (value === 'historical-unverified') return 'Greeks historical/unverified';
  return 'Greeks unavailable';
}

/** Verified match: aligned Greeks + meets configured hard/numeric rules. */
export function isVerifiedConfiguredMatch(candidate: FinderCandidate): boolean {
  return candidate.greekVerification === 'aligned' && candidate.meetsConfiguredNumericRequirements;
}

/** Unverified / incomplete for UI grouping — not a confirmed strategy fit. */
export function isUnverifiedOrIncompleteCandidate(candidate: FinderCandidate): boolean {
  return (
    candidate.greekVerification === 'historical-unverified' ||
    candidate.greekVerification === 'unavailable' ||
    candidate.outcome === 'incomplete'
  );
}

function num(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number): string {
  return value.toFixed(2);
}

function multiplyMoney(perShare: string | null, multiplier: number): string | null {
  const value = num(perShare);
  if (value == null) return null;
  return money(value * multiplier);
}

export function buildPremiumBreakdown(candidate: FinderCandidate): PremiumBreakdown {
  const intrinsicShare = candidate.calculations.intrinsicValue;
  const extrinsicShare = candidate.calculations.extrinsicValue;
  const cost = candidate.calculations.estimatedPurchaseCost;
  const ask = candidate.ask;
  const intrinsicPct = candidate.calculations.intrinsicPercent;
  const costN = num(cost);
  const intrinsicContract = multiplyMoney(intrinsicShare, candidate.multiplier);
  const extrinsicContract = multiplyMoney(extrinsicShare, candidate.multiplier);
  const intrinsicN = num(intrinsicContract);
  const extrinsicN = num(extrinsicContract);
  let intrinsicShareOfPremium: number | null = null;
  let extrinsicShareOfPremium: number | null = null;
  if (costN != null && costN > 0 && intrinsicN != null && extrinsicN != null) {
    intrinsicShareOfPremium = Math.max(0, Math.min(1, intrinsicN / costN));
    extrinsicShareOfPremium = Math.max(0, Math.min(1, extrinsicN / costN));
  }
  return {
    askPerShare: ask,
    costPerContract: cost,
    intrinsicPerShare: intrinsicShare,
    intrinsicPerContract: intrinsicContract,
    extrinsicPerShare: extrinsicShare,
    extrinsicPerContract: extrinsicContract,
    intrinsicPercent: intrinsicPct,
    intrinsicShareOfPremium,
    extrinsicShareOfPremium,
  };
}

export function buildLeapsPlainSummary(candidate: FinderCandidate): string {
  const title = `${candidate.underlying} — $${Number(candidate.strike).toFixed(0)} Call — ${formatLongDate(candidate.expiration)}`;
  const cost = candidate.calculations.estimatedPurchaseCost;
  const stock = candidate.underlyingPrice;
  const parts = [
    `${title}.`,
    stock != null ? `The stock was last shown near $${stock}.` : 'The underlying stock price was unavailable for this row.',
    cost != null
      ? `Buying one contract at the displayed ask would require about $${Number(cost).toLocaleString('en-US')} (ask × ${candidate.multiplier}), excluding fees. That is an estimate, not a guaranteed fill.`
      : 'Purchase cost could not be estimated because a valid ask was missing.',
    `This call gives you the right, but not the obligation, to buy ${candidate.multiplier} ${candidate.underlying} shares at $${candidate.strike} per share before expiration. Purchasing the call does not mean you own those shares yet.`,
  ];
  return parts.join(' ');
}

function formatLongDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(`${iso}T12:00:00.000Z`);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function buildStrategyFitRows(candidate: FinderCandidate, profile: StrategyProfile): StrategyFitRow[] {
  const cost = num(candidate.calculations.estimatedPurchaseCost);
  const ideal = num(profile.preferences.idealContractCost);
  const hardMax = num(profile.hard.maxContractCost);
  const delta = num(candidate.delta);
  const minDelta = num(profile.hard.minLongDelta);
  const preferredDelta = num(profile.preferences.preferredLongDelta);
  const intrinsic = num(candidate.calculations.intrinsicPercent);
  const minIntrinsic = num(profile.preferences.minIntrinsicPercent);
  const dte = candidate.calculations.daysToExpiration;
  const minDte = profile.hard.minExpirationDays;
  const rows: StrategyFitRow[] = [];

  rows.push({
    id: 'ideal-cost',
    requirement: 'Ideal investment',
    yourTarget: ideal != null ? `Below $${ideal.toLocaleString('en-US')}` : 'Not set',
    thisContract: cost != null ? `$${cost.toLocaleString('en-US')}` : 'Missing ask cost',
    status: cost == null || ideal == null ? 'not-assessed' : cost < ideal ? 'pass' : 'preferred-miss',
    explanation:
      cost == null || ideal == null
        ? 'Ideal budget could not be compared because cost or the target is missing.'
        : cost < ideal
          ? `Your ideal budget is below $${ideal.toLocaleString('en-US')}. This contract’s ask-based cost is $${cost.toLocaleString('en-US')}, so it is under your ideal.`
          : `This option costs $${(cost - ideal).toLocaleString('en-US')} more than your ideal budget of $${ideal.toLocaleString('en-US')}, but the ideal is a preference — not an automatic reject.`,
  });

  rows.push({
    id: 'hard-max-cost',
    requirement: 'Hard maximum investment',
    yourTarget: hardMax != null ? `At most $${hardMax.toLocaleString('en-US')}` : 'Not set',
    thisContract: cost != null ? `$${cost.toLocaleString('en-US')}` : 'Missing ask cost',
    status: cost == null || hardMax == null ? 'not-assessed' : cost <= hardMax ? 'pass' : 'hard-fail',
    explanation:
      cost == null || hardMax == null
        ? 'Hard maximum could not be checked without a valid ask-based cost.'
        : cost <= hardMax
          ? `Your hard maximum is $${hardMax.toLocaleString('en-US')}. This contract’s estimated cost is $${cost.toLocaleString('en-US')}, so it stays within the hard cap.`
          : `This contract’s estimated cost ($${cost.toLocaleString('en-US')}) is above your hard maximum of $${hardMax.toLocaleString('en-US')}.`,
  });

  const greeksAligned = candidate.greekVerification === 'aligned';
  const greekNotAssessedReason =
    candidate.greekVerification === 'historical-unverified'
      ? 'Provider Greeks are not time-aligned with this quote. Delta hard/preferred rules stay not-assessed until Greeks are aligned.'
      : 'Provider delta/Greeks are unavailable. Delta hard/preferred rules stay not-assessed.';

  rows.push({
    id: 'min-delta',
    requirement: 'Minimum delta',
    yourTarget: minDelta != null ? `At least ${minDelta}` : 'Not set',
    thisContract: delta != null ? String(delta) : 'Missing provider delta',
    status:
      !greeksAligned || delta == null || minDelta == null
        ? 'not-assessed'
        : delta >= minDelta
          ? 'pass'
          : 'hard-fail',
    explanation: !greeksAligned
      ? greekNotAssessedReason
      : delta == null
        ? 'Provider delta is missing. Missing Greeks stay incomplete — they are not invented.'
        : minDelta == null
          ? 'No hard minimum delta is configured.'
          : delta >= minDelta
            ? `Your minimum delta is ${minDelta}. This contract’s delta is ${delta}, so it meets the hard floor.`
            : `Your minimum delta is ${minDelta}. This contract’s delta is ${delta}, so it fails the hard delta rule.`,
  });

  rows.push({
    id: 'preferred-delta',
    requirement: 'Preferred delta',
    yourTarget: preferredDelta != null ? `${preferredDelta}+` : 'Not set',
    thisContract: delta != null ? String(delta) : 'Missing provider delta',
    status:
      !greeksAligned || delta == null || preferredDelta == null
        ? 'not-assessed'
        : delta >= preferredDelta
          ? 'pass'
          : 'preferred-miss',
    explanation: !greeksAligned
      ? greekNotAssessedReason
      : delta == null || preferredDelta == null
        ? 'Preferred delta could not be fully assessed.'
        : delta >= preferredDelta
          ? `Your preferred delta is ${preferredDelta} or higher. This contract’s delta is ${delta}, so it exceeds your preferred target.`
          : `Your preferred delta is ${preferredDelta} or higher. This contract’s delta is ${delta}, so it misses the preference while remaining visible for exploration.`,
  });

  rows.push({
    id: 'intrinsic',
    requirement: 'Preferred intrinsic %',
    yourTarget: minIntrinsic != null ? `${minIntrinsic}%+` : 'Not set',
    thisContract: intrinsic != null ? `${intrinsic}%` : 'Missing',
    status: intrinsic == null || minIntrinsic == null ? 'not-assessed' : intrinsic >= minIntrinsic ? 'pass' : 'preferred-miss',
    explanation:
      intrinsic == null || minIntrinsic == null
        ? 'Intrinsic percentage could not be compared.'
        : intrinsic >= minIntrinsic
          ? `Your preferred intrinsic share is ${minIntrinsic}%+. This contract is about ${intrinsic}%.`
          : `Your preferred intrinsic share is ${minIntrinsic}%+. This contract is about ${intrinsic}%, so more of the premium is extrinsic.`,
  });

  rows.push({
    id: 'expiration',
    requirement: 'Minimum expiration',
    yourTarget: `About ${minDte} days (~${Math.round(minDte / 30)} months)`,
    thisContract: dte != null ? `${dte} days` : 'Missing',
    status: dte == null ? 'not-assessed' : dte >= minDte ? 'pass' : 'hard-fail',
    explanation:
      dte == null
        ? 'Days to expiration were missing.'
        : dte >= minDte
          ? `Your strategy wants at least ${minDte} days. This contract has ${dte} days remaining.`
          : `This contract has ${dte} days left, below your ${minDte}-day hard floor.`,
  });

  rows.push({
    id: 'spread',
    requirement: 'Bid/ask spread limit',
    yourTarget:
      profile.preferences.maxBidAskSpreadPercent == null
        ? 'Unconfigured (Unassessed)'
        : `At most ${profile.preferences.maxBidAskSpreadPercent}%`,
    thisContract: candidate.calculations.bidAskSpreadPercent ?? 'Missing / invalid',
    status:
      profile.preferences.maxBidAskSpreadPercent == null
        ? 'not-assessed'
        : candidate.calculations.bidAskSpreadPercent == null || candidate.flags.crossedMarket
          ? 'not-assessed'
          : num(candidate.calculations.bidAskSpreadPercent)! <= num(profile.preferences.maxBidAskSpreadPercent)!
            ? 'pass'
            : 'preferred-miss',
    explanation:
      profile.preferences.maxBidAskSpreadPercent == null
        ? 'Spread limit is not configured on the saved strategy. Unconfigured liquidity is never treated as passed.'
        : candidate.calculations.bidAskSpreadPercent == null
          ? 'A valid bid/ask spread was not available for this row.'
          : 'Compared using the configured maximum bid/ask spread percent.',
  });

  const minOi = profile.preferences.minOpenInterest;
  const oi = candidate.openInterest;
  rows.push({
    id: 'open-interest',
    requirement: 'Minimum open interest',
    yourTarget: minOi == null ? 'Unconfigured (Unassessed)' : String(minOi),
    thisContract: oi == null ? 'Not available yet' : String(oi),
    status: minOi == null || oi == null ? 'not-assessed' : oi >= minOi ? 'pass' : 'preferred-miss',
    explanation:
      minOi == null
        ? 'Open-interest minimum is unconfigured. When blank, OptionScout does not treat liquidity as passed.'
        : oi == null
          ? 'Open interest is not available yet from the current Finder quote path — shown as Unassessed.'
          : oi >= minOi
            ? `Open interest is ${oi}, at or above your configured minimum of ${minOi}.`
            : `Open interest is ${oi}, below your configured minimum of ${minOi}.`,
  });

  const minVol = profile.preferences.minVolume;
  const vol = candidate.volume;
  rows.push({
    id: 'volume',
    requirement: 'Minimum volume',
    yourTarget: minVol == null ? 'Unconfigured (Unassessed)' : String(minVol),
    thisContract: vol == null ? 'Not available / sparse' : String(vol),
    status: minVol == null || vol == null ? 'not-assessed' : vol >= minVol ? 'pass' : 'preferred-miss',
    explanation:
      minVol == null
        ? 'Volume minimum is unconfigured and remains Unassessed.'
        : vol == null
          ? 'Volume was not supplied for this snapshot.'
          : vol >= minVol
            ? `Volume is ${vol}, at or above your configured minimum of ${minVol}.`
            : `Volume is ${vol}, below your configured minimum of ${minVol}.`,
  });

  return rows;
}

export function quoteStatusCopy(candidate: FinderCandidate): QuoteStatusCopy {
  const freshness = candidate.observationFreshness;
  const greek = candidate.greekVerification;
  const fromCache = candidate.flags.fromCache === true;
  const cacheNote = fromCache ? ' Shown from last-known observation cache.' : '';
  const freshnessText = observationFreshnessLabel(freshness);
  const greekText = greekVerificationLabel(greek);
  const closedOrAfterHours =
    candidate.marketSession === 'closed' || candidate.flags.afterHoursSnapshot || freshness === 'previous-session';

  if (greek !== 'aligned') {
    return {
      label: `${freshnessText} · ${greekText}${fromCache ? ' · cached' : ''}`,
      detail:
        (greek === 'historical-unverified'
          ? 'Provider Greeks are not time-aligned with this quote snapshot. Delta hard/preferred rules stay not-assessed.'
          : 'Provider Greeks are missing or unverified. Delta hard/preferred rules stay not-assessed.') +
        (closedOrAfterHours ? ' Closed-session or previous-session quotes are research-only.' : '') +
        cacheNote,
    };
  }

  if (freshness === 'current-session') {
    return {
      label: `Current-session observation · Greeks aligned${fromCache ? ' · cached' : ''}`,
      detail:
        'Observation is from the current session with time-aligned Greeks. OptionScout does not verify that an order would fill at these prices.' +
        cacheNote,
    };
  }

  if (freshness === 'previous-session' || closedOrAfterHours) {
    return {
      label: `Previous-session snapshot · Greeks aligned${fromCache ? ' · cached' : ''}`,
      detail:
        'Quote is from a previous session (including after the regular close). Greeks are aligned to that snapshot. Not a verified live execution.' +
        cacheNote,
    };
  }

  if (freshness === 'older' || candidate.flags.staleInputs || candidate.dataQuality === 'stale') {
    return {
      label: `Older observation · Greeks aligned${fromCache ? ' · cached' : ''}`,
      detail: 'Observation is older than the recent-session window. Treat as research-only.' + cacheNote,
    };
  }

  return {
    label: `Observation freshness unavailable · Greeks aligned${fromCache ? ' · cached' : ''}`,
    detail:
      'Greek verification is aligned, but observation freshness could not be classified. Missing timestamps keep this research-only.' +
      cacheNote,
  };
}

/** Expiration P/L for a long call: (max(S−K,0) − premiumPerShare) × multiplier. */
export function expirationPayoffScenarios(candidate: FinderCandidate): ExpirationPayoffPoint[] {
  const stock = num(candidate.underlyingPrice);
  const strike = num(candidate.strike);
  const ask = num(candidate.ask);
  if (stock == null || strike == null || ask == null) return [];
  const be = num(expirationBreakEven(candidate.strike, candidate.ask));
  const moves: Array<{ label: string; price: number; kind: ExpirationPayoffPoint['kind'] }> = [
    { label: '−30% stock', price: stock * 0.7, kind: 'downside' },
    { label: '−20% stock', price: stock * 0.8, kind: 'downside' },
    { label: '−15% stock', price: stock * 0.85, kind: 'downside' },
    { label: 'Current stock', price: stock, kind: 'spot' },
    { label: '+10% stock', price: stock * 1.1, kind: 'upside' },
    { label: '+20% stock', price: stock * 1.2, kind: 'upside' },
    { label: '+30% stock', price: stock * 1.3, kind: 'upside' },
  ];
  if (be != null) moves.push({ label: 'Expiration break-even', price: be, kind: 'breakeven' });
  return moves.map((row) => {
    const callValue = Math.max(row.price - strike, 0);
    const profit = (callValue - ask) * candidate.multiplier;
    return {
      label: row.label,
      stockPrice: money(row.price),
      callValuePerShare: money(callValue),
      profitPerContract: money(profit),
      kind: row.kind,
    };
  });
}

export type ComparisonPriority =
  | 'lowest-cost'
  | 'highest-delta'
  | 'highest-intrinsic'
  | 'lowest-extrinsic'
  | 'tightest-spread'
  | 'longest-expiration'
  | 'best-downside';

export const COMPARISON_PRIORITY_LABELS: Record<ComparisonPriority, string> = {
  'lowest-cost': 'Lowest purchase cost',
  'highest-delta': 'Highest delta',
  'highest-intrinsic': 'Highest intrinsic %',
  'lowest-extrinsic': 'Lowest extrinsic premium',
  'tightest-spread': 'Tightest valid spread',
  'longest-expiration': 'Longest expiration',
  'best-downside': 'Strongest downside moneyness (15%)',
};

export interface ComparisonMetricLeader {
  metric: string;
  leaderId: string;
  leaderLabel: string;
  badge: string;
}

function pickLeader(
  candidates: readonly FinderCandidate[],
  read: (row: FinderCandidate) => number | null,
  higherBetter: boolean,
): FinderCandidate | null {
  let best: FinderCandidate | null = null;
  let bestValue: number | null = null;
  for (const row of candidates) {
    // Inconsistent/invalid quotes (e.g. intrinsic > ask) must not win metric leadership.
    if (row.dataQuality === 'inconsistent' || row.dataQuality === 'invalid') continue;
    const value = read(row);
    if (value == null) continue;
    if (bestValue == null || (higherBetter ? value > bestValue : value < bestValue)) {
      best = row;
      bestValue = value;
    }
  }
  return best;
}

export function comparisonLeaders(candidates: readonly FinderCandidate[]): ComparisonMetricLeader[] {
  const leaders: ComparisonMetricLeader[] = [];
  const cost = pickLeader(candidates, (row) => num(row.calculations.estimatedPurchaseCost), false);
  if (cost) {
    leaders.push({
      metric: 'purchaseCost',
      leaderId: cost.id,
      leaderLabel: `${cost.underlying} $${cost.strike} ${cost.expiration}`,
      badge: 'Lowest Cost',
    });
  }
  const delta = pickLeader(candidates, (row) => num(row.delta), true);
  if (delta) {
    leaders.push({
      metric: 'delta',
      leaderId: delta.id,
      leaderLabel: `${delta.underlying} $${delta.strike} ${delta.expiration}`,
      badge: 'Highest Delta',
    });
  }
  const intrinsic = pickLeader(candidates, (row) => num(row.calculations.intrinsicPercent), true);
  if (intrinsic) {
    leaders.push({
      metric: 'intrinsicPercent',
      leaderId: intrinsic.id,
      leaderLabel: `${intrinsic.underlying} $${intrinsic.strike} ${intrinsic.expiration}`,
      badge: 'Highest Intrinsic %',
    });
  }
  const extrinsic = pickLeader(candidates, (row) => num(row.calculations.extrinsicValue), false);
  if (extrinsic) {
    leaders.push({
      metric: 'extrinsicValue',
      leaderId: extrinsic.id,
      leaderLabel: `${extrinsic.underlying} $${extrinsic.strike} ${extrinsic.expiration}`,
      badge: 'Lowest Extrinsic',
    });
  }
  const spread = pickLeader(
    candidates,
    (row) => (row.flags.crossedMarket || row.flags.invalidPrice ? null : num(row.calculations.bidAskSpreadPercent)),
    false,
  );
  if (spread) {
    leaders.push({
      metric: 'bidAskSpread',
      leaderId: spread.id,
      leaderLabel: `${spread.underlying} $${spread.strike} ${spread.expiration}`,
      badge: 'Tightest Spread',
    });
  }
  const dte = pickLeader(candidates, (row) => row.calculations.daysToExpiration, true);
  if (dte) {
    leaders.push({
      metric: 'dte',
      leaderId: dte.id,
      leaderLabel: `${dte.underlying} $${dte.strike} ${dte.expiration}`,
      badge: 'Longest Expiration',
    });
  }
  return leaders;
}

/** Deterministic 2–4 contract comparison blurb from actual numbers. */
export function buildComparisonSummary(candidates: readonly FinderCandidate[]): string {
  if (candidates.length < 2) return 'Select at least two contracts to compare.';
  const [a, b] = candidates;
  if (!a || !b) return 'Select at least two contracts to compare.';
  const costA = num(a.calculations.estimatedPurchaseCost);
  const costB = num(b.calculations.estimatedPurchaseCost);
  const deltaA = num(a.delta);
  const deltaB = num(b.delta);
  const intA = num(a.calculations.intrinsicPercent);
  const intB = num(b.calculations.intrinsicPercent);
  const label = (row: FinderCandidate) => `${row.underlying} $${row.strike} ${row.expiration}`;
  const parts: string[] = [];
  if (costA != null && costB != null) {
    const diff = Math.abs(costA - costB);
    if (costA < costB) parts.push(`${label(a)} requires $${diff.toLocaleString('en-US')} less capital than ${label(b)}.`);
    else if (costB < costA) parts.push(`${label(b)} requires $${diff.toLocaleString('en-US')} less capital than ${label(a)}.`);
    else parts.push(`${label(a)} and ${label(b)} have the same ask-based purchase cost.`);
  }
  if (deltaA != null && deltaB != null && intA != null && intB != null) {
    if (deltaB > deltaA && intB > intA && costB != null && costA != null && costB > costA) {
      parts.push(
        `${label(b)} has higher delta and a greater intrinsic-value percentage, but costs more.`,
      );
    } else if (deltaA > deltaB && intA > intB && costA != null && costB != null && costA > costB) {
      parts.push(
        `${label(a)} has higher delta and a greater intrinsic-value percentage, but costs more.`,
      );
    }
  }
  if (candidates.length > 2) {
    parts.push(`${candidates.length} contracts are in this comparison. Missing values never win metric leadership.`);
  }
  parts.push('These statements are factual differences only — not buy recommendations or safety ratings.');
  return parts.join(' ');
}

export function sortCandidatesByPriority(
  candidates: readonly FinderCandidate[],
  priority: ComparisonPriority,
): FinderCandidate[] {
  const read = (row: FinderCandidate): number | null => {
    switch (priority) {
      case 'lowest-cost':
        return num(row.calculations.estimatedPurchaseCost);
      case 'highest-delta':
        return num(row.delta);
      case 'highest-intrinsic':
        return num(row.calculations.intrinsicPercent);
      case 'lowest-extrinsic':
        return num(row.calculations.extrinsicValue);
      case 'tightest-spread':
        return row.flags.crossedMarket ? null : num(row.calculations.bidAskSpreadPercent);
      case 'longest-expiration':
        return row.calculations.daysToExpiration;
      case 'best-downside':
        return num(row.calculations.downsideMoneyness15);
      default:
        return null;
    }
  };
  const lowerBetter =
    priority === 'lowest-cost' || priority === 'lowest-extrinsic' || priority === 'tightest-spread';
  return [...candidates].sort((left, right) => {
    const a = read(left);
    const b = read(right);
    if (a == null && b == null) return left.id.localeCompare(right.id);
    if (a == null) return 1;
    if (b == null) return -1;
    const cmp = lowerBetter ? a - b : b - a;
    return cmp === 0 ? left.id.localeCompare(right.id) : cmp;
  });
}

/** Rebuild breakdown fields from raw quote inputs (for fixtures / tests). */
export function computePremiumFromQuote(input: {
  stockPrice: string;
  strike: string;
  ask: string;
  multiplier: number;
}): PremiumBreakdown {
  const intrinsicShare = intrinsicValue(input.stockPrice, input.strike);
  const extrinsicShare = extrinsicValue(input.ask, intrinsicShare);
  const cost = estimatedPurchaseCost(input.ask, input.multiplier);
  const pct = intrinsicPercent(intrinsicShare, input.ask);
  return buildPremiumBreakdown({
    id: 'computed',
    underlying: 'X',
    occSymbol: 'X',
    streamerSymbol: null,
    optionType: 'call',
    strike: input.strike,
    expiration: '2099-01-01',
    multiplier: input.multiplier,
    chainType: 'Standard',
    standardContract: true,
    supportStatus: 'supported',
    supportNote: '',
    active: null,
    closingOnly: null,
    underlyingPrice: input.stockPrice,
    bid: null,
    ask: input.ask,
    mark: null,
    delta: null,
    theta: null,
    gamma: null,
    vega: null,
    impliedVolatility: null,
    volume: null,
    openInterest: null,
    providerEventAt: null,
    receivedAt: null,
    marketSession: 'closed',
    dataQuality: 'usable',
    flags: {
      crossedMarket: false,
      missingBid: true,
      missingAsk: false,
      invalidPrice: false,
      staleInputs: false,
      missingProviderTimestamp: true,
      quoteGreekMismatch: false,
      missingGreeks: true,
      unverifiedGreeks: false,
      afterHoursSnapshot: true,
      fromCache: false,
      actionable: false,
    },
    calculations: {
      intrinsicValue: intrinsicShare,
      estimatedPurchaseCost: cost,
      extrinsicValue: extrinsicShare,
      intrinsicPercent: pct,
      bidAskSpreadDollars: null,
      bidAskSpreadPercent: null,
      expirationBreakEven: expirationBreakEven(input.strike, input.ask),
      daysToExpiration: null,
      strikeDistance: null,
      downsideMoneyness15: null,
      downsideMoneyness20: null,
      downsideMoneyness30: null,
      deltaCapitalExposure: null,
      midpoint: null,
      quoteSourceLabel: 'computed',
    },
    outcome: 'incomplete',
    label: 'Incomplete Data',
    visible: true,
    usableForComparison: false,
    withinExploration: false,
    reasons: [],
    metrics: {
      purchaseCost: num(cost),
      delta: null,
      intrinsicPercent: num(pct),
      extrinsicValue: num(extrinsicShare),
      bidAskSpread: null,
      liquidity: null,
      dte: null,
      theta: null,
      downsideMoneyness: null,
      pmccCompatibility: null,
    },
    pmccReason: null,
    meetsConfiguredNumericRequirements: false,
    liquidityUnassessed: true,
    observationFreshness: 'unavailable',
    greekVerification: 'unavailable',
    greekProviderEventAt: null,
    validationIssues: [],
  } as FinderCandidate);
}

/**
 * Plain-language assessment labels for Discover Opportunities / Finder cards.
 * Separates market-data validity, observation freshness, strategy fit, and liquidity.
 * Deterministic templates only — not investment advice.
 */

import { isImpossibleStandardCallIntrinsic } from './finder-math.js';
import type { FinderCandidate } from './finder.js';
import type { ValidationIssue } from './market-data-validation.js';

export type MarketDataValidityLabel = 'Valid' | 'Missing' | 'Invalid' | 'Inconsistent';
export type ObservationFreshnessAssessmentLabel = 'Current session' | 'Previous session' | 'Older';
export type StrategyFitAssessmentLabel =
  | 'Meets hard requirements'
  | 'Preference gap'
  | 'Hard rule failed'
  | 'Cannot verify required values';
export type LiquidityAssessmentLabel = 'Assessed' | 'Unassessed' | 'Failed threshold';

export interface CandidateAssessment {
  marketDataValidity: MarketDataValidityLabel;
  observationFreshness: ObservationFreshnessAssessmentLabel | 'Unavailable';
  strategyFit: StrategyFitAssessmentLabel;
  liquidity: LiquidityAssessmentLabel;
  /** Compact plain-language line for cards. */
  plainSummary: string;
  /** True only for current-session, valid, compatible, aligned Greeks, numeric hard rules met. */
  isVerifiedCurrentMatch: boolean;
  /** True when previous-session (or closed) historical numerical fit is allowed to be stated. */
  isHistoricalNumericalFit: boolean;
  /** Underlying/spot vs option ask is economically incompatible (e.g. impossible intrinsic). */
  underlyingIncompatible: boolean;
}

function rejectIssues(candidate: FinderCandidate): ValidationIssue[] {
  return (candidate.validationIssues ?? []).filter((issue) => issue.severity === 'reject');
}

function primaryRejectCode(candidate: FinderCandidate): string | null {
  return rejectIssues(candidate)[0]?.code ?? null;
}

export function marketDataValidityLabel(
  dataQuality: FinderCandidate['dataQuality'],
): MarketDataValidityLabel {
  if (dataQuality === 'missing') return 'Missing';
  if (dataQuality === 'invalid') return 'Invalid';
  if (dataQuality === 'inconsistent') return 'Inconsistent';
  // usable and stale are mathematically usable; freshness is tracked separately.
  return 'Valid';
}

export function observationFreshnessAssessmentLabel(
  value: FinderCandidate['observationFreshness'],
): ObservationFreshnessAssessmentLabel | 'Unavailable' {
  if (value === 'current-session') return 'Current session';
  if (value === 'previous-session') return 'Previous session';
  if (value === 'older') return 'Older';
  return 'Unavailable';
}

export function underlyingSpotIncompatible(candidate: FinderCandidate): boolean {
  if (
    (candidate.validationIssues ?? []).some(
      (issue) => issue.code === 'option_ask_below_intrinsic' || issue.code === 'stock_option_session_mismatch',
    )
  ) {
    return true;
  }
  if (candidate.dataQuality === 'inconsistent' || candidate.dataQuality === 'invalid') {
    // Only treat as underlying-incompatible when intrinsic is impossible or reject codes say so.
    const rejects = rejectIssues(candidate);
    if (rejects.some((issue) => issue.code === 'option_ask_below_intrinsic')) return true;
    if (rejects.some((issue) => issue.code === 'crossed_option_market' || issue.code === 'invalid_option_price')) {
      return true;
    }
  }
  return isImpossibleStandardCallIntrinsic({
    optionType: candidate.optionType,
    standardContract: candidate.standardContract,
    supportStatus: candidate.supportStatus,
    intrinsicPerShare: candidate.calculations.intrinsicValue,
    ask: candidate.ask,
    intrinsicPercent: candidate.calculations.intrinsicPercent,
  });
}

function hardRuleFailed(candidate: FinderCandidate): boolean {
  return candidate.reasons.some((reason) => reason.kind === 'hard' && !reason.passed);
}

function preferenceGap(candidate: FinderCandidate): boolean {
  return candidate.reasons.some((reason) => reason.kind === 'preference' && !reason.passed);
}

function cannotVerifyRequiredValues(candidate: FinderCandidate): boolean {
  if (rejectIssues(candidate).length > 0) return true;
  if (candidate.dataQuality === 'missing') return true;
  // Missing/unverified Greeks block confirming delta hard/preferred rules.
  if (candidate.delta == null || candidate.greekVerification !== 'aligned') return true;
  if (candidate.outcome === 'incomplete' && !candidate.meetsConfiguredNumericRequirements) return true;
  return candidate.reasons.some(
    (reason) => reason.kind === 'hard' && !reason.passed && (reason.actual == null || reason.actual === ''),
  );
}

export function strategyFitAssessmentLabel(candidate: FinderCandidate): StrategyFitAssessmentLabel {
  // True market-data rejects are not strategy hard-rule failures — they cannot be assessed.
  if (
    underlyingSpotIncompatible(candidate) ||
    rejectIssues(candidate).length > 0 ||
    candidate.dataQuality === 'invalid'
  ) {
    return 'Cannot verify required values';
  }
  if (cannotVerifyRequiredValues(candidate) && !candidate.meetsConfiguredNumericRequirements) {
    // Prefer explicit hard failures when present and Greeks are aligned enough to judge.
    if (hardRuleFailed(candidate) && candidate.greekVerification === 'aligned') {
      return 'Hard rule failed';
    }
    return 'Cannot verify required values';
  }
  if (hardRuleFailed(candidate) && !candidate.meetsConfiguredNumericRequirements) {
    return 'Hard rule failed';
  }
  if (candidate.meetsConfiguredNumericRequirements) {
    // Near Match from unassessed liquidity alone is not a preference gap.
    if (preferenceGap(candidate)) {
      return 'Preference gap';
    }
    return 'Meets hard requirements';
  }
  if (preferenceGap(candidate) && !hardRuleFailed(candidate)) {
    return 'Preference gap';
  }
  if (hardRuleFailed(candidate)) return 'Hard rule failed';
  return 'Cannot verify required values';
}

export function liquidityAssessmentLabel(candidate: FinderCandidate): LiquidityAssessmentLabel {
  if (candidate.liquidityUnassessed || (candidate.openInterest == null && candidate.volume == null)) {
    return 'Unassessed';
  }
  const liquidityFail = candidate.reasons.some(
    (reason) =>
      (reason.metric === 'openInterest' || reason.metric === 'volume' || reason.metric === 'bidAskSpread' || reason.metric === 'liquidity') &&
      !reason.passed &&
      (reason.kind === 'hard' || reason.kind === 'preference'),
  );
  if (liquidityFail) return 'Failed threshold';
  return 'Assessed';
}

/** Verified CURRENT match — never when data is inconsistent/invalid or underlying incompatible. */
export function isVerifiedCurrentMatch(candidate: FinderCandidate): boolean {
  if (rejectIssues(candidate).length > 0) return false;
  if (candidate.dataQuality === 'inconsistent' || candidate.dataQuality === 'invalid') return false;
  if (underlyingSpotIncompatible(candidate)) return false;
  if (candidate.observationFreshness !== 'current-session') return false;
  if (candidate.greekVerification !== 'aligned') return false;
  return candidate.meetsConfiguredNumericRequirements;
}

/**
 * Historical numerical fit: previous-session (or closed-market research), valid/compatible,
 * aligned Greeks, meets numeric hard rules. Allowed when the market is closed — not a live fill.
 * Research clock-gap warnings do not disqualify when prices are arithmetically consistent.
 */
export function isHistoricalNumericalFit(candidate: FinderCandidate): boolean {
  if (rejectIssues(candidate).length > 0) return false;
  if (candidate.dataQuality === 'inconsistent' || candidate.dataQuality === 'invalid' || candidate.dataQuality === 'missing') {
    return false;
  }
  if (underlyingSpotIncompatible(candidate)) return false;
  if (candidate.greekVerification !== 'aligned') return false;
  if (!candidate.meetsConfiguredNumericRequirements) return false;
  return (
    candidate.observationFreshness === 'previous-session' ||
    candidate.observationFreshness === 'older' ||
    (candidate.observationFreshness === 'current-session' && candidate.marketSession === 'closed')
  );
}

function deltaNotVerifiedNote(candidate: FinderCandidate): string | null {
  if (candidate.delta == null) return 'Delta requirement not verified.';
  if (candidate.greekVerification === 'unavailable') return 'Delta requirement not verified.';
  if (candidate.greekVerification === 'historical-unverified') {
    return 'Delta requirement not verified (Greeks not time-aligned with this quote).';
  }
  return null;
}

function rejectSummary(candidate: FinderCandidate): string | null {
  const code = primaryRejectCode(candidate);
  if (code === 'option_ask_below_intrinsic') {
    return 'Rejected from valid mathematical comparisons — option ask is below computed intrinsic (code: option_ask_below_intrinsic).';
  }
  if (code === 'crossed_option_market') {
    return 'Rejected — crossed option market (code: crossed_option_market).';
  }
  if (code === 'stock_option_live_skew') {
    return 'Rejected — live regular-session stock/option quote times are too far apart (code: stock_option_live_skew).';
  }
  if (code === 'stock_option_session_mismatch') {
    return 'Unverified — the stock price and option quote come from different trading sessions (code: stock_option_session_mismatch).';
  }
  if (code === 'invalid_option_price') {
    return 'Rejected — invalid option price (code: invalid_option_price).';
  }
  if (code === 'unsupported_contract') {
    return 'Rejected — unsupported contract (code: unsupported_contract).';
  }
  if (code === 'missing_option_ask' || code === 'missing_essential_fields') {
    return `Required market values are missing (code: ${code}).`;
  }
  if (code) {
    return `Rejected from valid mathematical comparisons (code: ${code}).`;
  }
  return null;
}

export function buildCandidateAssessmentPlainSummary(candidate: FinderCandidate): string {
  const validity = marketDataValidityLabel(candidate.dataQuality);
  const freshness = observationFreshnessAssessmentLabel(candidate.observationFreshness);
  const incompatible = underlyingSpotIncompatible(candidate);
  const rejectText = rejectSummary(candidate);

  if (rejectText) return rejectText;
  if (validity === 'Inconsistent' || incompatible) {
    return 'Rejected from valid mathematical comparisons — underlying price and option premium are inconsistent or invalid.';
  }
  if (validity === 'Invalid') {
    return 'Market data is invalid for strategy comparison.';
  }
  if (validity === 'Missing') {
    const deltaNote = deltaNotVerifiedNote(candidate);
    return deltaNote ?? 'Required market values are missing, so strategy fit cannot be verified.';
  }

  const deltaNote = deltaNotVerifiedNote(candidate);
  if (deltaNote && !candidate.meetsConfiguredNumericRequirements) {
    return deltaNote;
  }

  if (isVerifiedCurrentMatch(candidate)) {
    return 'Meets numerical strategy requirements as of the current session. Execution not verified.';
  }

  if (
    candidate.meetsConfiguredNumericRequirements &&
    candidate.greekVerification === 'aligned' &&
    (freshness === 'Previous session' || freshness === 'Older' || candidate.marketSession === 'closed')
  ) {
    const when = freshness === 'Older' ? 'an older observation' : 'the previous session';
    const clockGap = (candidate.validationIssues ?? []).some((issue) => issue.code === 'stock_option_research_clock_gap');
    const gapNote = clockGap ? ' Research clock gap noted (warning only).' : '';
    if (preferenceGap(candidate)) {
      return `Meets hard numerical requirements with a preference gap as of ${when}. Execution not verified.${gapNote}`;
    }
    return `Meets numerical strategy requirements as of ${when}. Execution not verified.${gapNote}`;
  }

  const fit = strategyFitAssessmentLabel(candidate);
  if (fit === 'Preference gap') {
    return `Passes hard requirements with a preference gap (${freshness === 'Unavailable' ? 'observation time unavailable' : freshness.toLowerCase()}). Execution not verified.`;
  }
  if (fit === 'Hard rule failed') {
    return 'Does not meet one or more hard strategy requirements.';
  }
  return deltaNote ?? 'Cannot verify required values for a strategy comparison.';
}

export function assessCandidate(candidate: FinderCandidate): CandidateAssessment {
  const underlyingIncompatible = underlyingSpotIncompatible(candidate);
  return {
    marketDataValidity: marketDataValidityLabel(candidate.dataQuality),
    observationFreshness: observationFreshnessAssessmentLabel(candidate.observationFreshness),
    strategyFit: strategyFitAssessmentLabel(candidate),
    liquidity: liquidityAssessmentLabel(candidate),
    plainSummary: buildCandidateAssessmentPlainSummary(candidate),
    isVerifiedCurrentMatch: isVerifiedCurrentMatch(candidate),
    isHistoricalNumericalFit: isHistoricalNumericalFit(candidate),
    underlyingIncompatible,
  };
}

/**
 * Beginner default discovery order (deterministic, not an AI score):
 * 1. Verified current numerical matches
 * 2. Historical numerical matches (previous-session / closed research)
 * 3. Near matches / preference gaps with valid data
 * 4. Known hard-rule failures with valid data
 * 5. Unverified / incomplete (missing required measurements)
 * 6. Invalid / inconsistent market-data combinations (last)
 * Within a bucket: prefer deeper ITM hints via lower strike when costs are similar; then cost.
 */
export function sortCandidatesClosestToStrategy(candidates: readonly FinderCandidate[]): FinderCandidate[] {
  function bucket(candidate: FinderCandidate): number {
    if (
      underlyingSpotIncompatible(candidate) ||
      rejectIssues(candidate).length > 0 ||
      candidate.dataQuality === 'inconsistent' ||
      candidate.dataQuality === 'invalid'
    ) {
      return 6;
    }
    if (isVerifiedCurrentMatch(candidate)) return 1;
    if (isHistoricalNumericalFit(candidate)) return 2;
    if (candidate.outcome === 'near' || (preferenceGap(candidate) && !hardRuleFailed(candidate))) return 3;
    if (hardRuleFailed(candidate) && candidate.greekVerification === 'aligned') return 4;
    if (candidate.outcome === 'incomplete' || cannotVerifyRequiredValues(candidate)) return 5;
    if (candidate.outcome === 'exact' || candidate.meetsConfiguredNumericRequirements) return 2;
    if (candidate.outcome === 'outside-profile') return 4;
    return 5;
  }
  return [...candidates].sort((left, right) => {
    const bucketCmp = bucket(left) - bucket(right);
    if (bucketCmp !== 0) return bucketCmp;
    const strikeL = Number(left.strike);
    const strikeR = Number(right.strike);
    // Deeper ITM (lower strike for calls) before mere cheapness within the same bucket.
    if (Number.isFinite(strikeL) && Number.isFinite(strikeR) && strikeL !== strikeR) return strikeL - strikeR;
    const costL = left.calculations.estimatedPurchaseCost == null ? null : Number(left.calculations.estimatedPurchaseCost);
    const costR = right.calculations.estimatedPurchaseCost == null ? null : Number(right.calculations.estimatedPurchaseCost);
    if (costL != null && costR != null && costL !== costR) return costL - costR;
    return left.id.localeCompare(right.id);
  });
}

export function formatObservationDate(candidate: FinderCandidate): string {
  const raw = candidate.providerEventAt ?? candidate.receivedAt;
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

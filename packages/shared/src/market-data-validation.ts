/**
 * Machine-readable market-data validation reason codes for Finder / Smart Scan.
 * Reject codes hard-block strategy assessment; warning/info codes stay assessable.
 */

import { isImpossibleStandardCallIntrinsic } from './finder-math.js';

export const MARKET_DATA_VALIDATION_CODES = [
  'option_ask_below_intrinsic',
  'crossed_option_market',
  'invalid_option_price',
  'missing_option_ask',
  'missing_essential_fields',
  'stock_option_live_skew',
  'stock_option_research_clock_gap',
  'stock_option_session_mismatch',
  'quote_greek_mismatch',
  'greek_unaligned',
  'missing_greeks',
  'underlying_nbbo_wide',
  'unsupported_contract',
] as const;

export type MarketDataValidationCode = (typeof MARKET_DATA_VALIDATION_CODES)[number];

export type ValidationIssueSeverity = 'reject' | 'warning' | 'info';

export interface ValidationIssue {
  code: MarketDataValidationCode;
  severity: ValidationIssueSeverity;
  message: string;
  details?: Record<string, string | number | null>;
}

/** Same wide-NBBO thresholds as selectEquitySpotPrice (2% of mid or $2). */
export function isUnderlyingNbboWide(bid: string | null, ask: string | null): boolean {
  if (bid == null || ask == null) return false;
  const bidN = Number(bid);
  const askN = Number(ask);
  if (!Number.isFinite(bidN) || !Number.isFinite(askN) || bidN <= 0 || askN <= 0) return false;
  if (askN < bidN) return true;
  const mid = (bidN + askN) / 2;
  const spread = askN - bidN;
  return spread > mid * 0.02 || spread > 2;
}

/**
 * Pair underlying vs option timestamps with intrinsic sanity.
 * Live regular-session skew beyond the screening window is a hard reject.
 * Closed / previous-session research skew is a warning when intrinsic is possible.
 */
export function assessUnderlyingOptionPairing(input: {
  marketSession: 'regular' | 'closed';
  observationFreshness: 'current-session' | 'previous-session' | 'older' | 'unavailable';
  quoteSkewSeconds: number | null;
  screeningFreshnessSeconds: number;
  impossibleIntrinsic: boolean;
  underlyingQuoteAt?: string | null;
  optionQuoteAt?: string | null;
  underlyingPrice?: string | null;
  strike?: string | null;
  ask?: string | null;
  intrinsicPerShare?: string | null;
  intrinsicPercent?: string | null;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const details: Record<string, string | number | null> = {
    underlyingQuoteAt: input.underlyingQuoteAt ?? null,
    optionQuoteAt: input.optionQuoteAt ?? null,
    quoteSkewSeconds:
      input.quoteSkewSeconds == null ? null : Math.round(input.quoteSkewSeconds),
    screeningFreshnessSeconds: input.screeningFreshnessSeconds,
    marketSession: input.marketSession,
    observationFreshness: input.observationFreshness,
  };

  if (input.impossibleIntrinsic) {
    issues.push({
      code: 'option_ask_below_intrinsic',
      severity: 'reject',
      message:
        'Impossible premium for a standard call: computed intrinsic exceeds the ask (or intrinsic % is above 100).',
      details: {
        ...details,
        underlyingPrice: input.underlyingPrice ?? null,
        strike: input.strike ?? null,
        ask: input.ask ?? null,
        intrinsicPerShare: input.intrinsicPerShare ?? null,
        intrinsicPercent: input.intrinsicPercent ?? null,
      },
    });
  }

  const skewTooFar =
    input.quoteSkewSeconds != null && input.quoteSkewSeconds > input.screeningFreshnessSeconds;
  if (!skewTooFar) return issues;

  const liveRegularSync =
    input.marketSession === 'regular' && input.observationFreshness === 'current-session';

  if (liveRegularSync) {
    issues.push({
      code: 'stock_option_live_skew',
      severity: 'reject',
      message: `Underlying and option quote times differ by about ${Math.round(input.quoteSkewSeconds!)}s during a live regular session (limit ${input.screeningFreshnessSeconds}s).`,
      details,
    });
    return issues;
  }

  // Closed / previous-session / older research: clock gap is informational when intrinsic is possible.
  if (!input.impossibleIntrinsic) {
    issues.push({
      code: 'stock_option_research_clock_gap',
      severity: 'warning',
      message: `Underlying and option observation times differ by about ${Math.round(input.quoteSkewSeconds!)}s. Suitable for closed/previous-session research when prices are arithmetically consistent — not a live synchronized quote.`,
      details,
    });
  }

  return issues;
}

export function hasRejectValidationIssue(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'reject');
}

export function countValidationRejectsByCode(
  candidates: readonly { validationIssues?: readonly ValidationIssue[] }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const issue of candidate.validationIssues ?? []) {
      if (issue.severity !== 'reject') continue;
      counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    }
  }
  return counts;
}

/** Re-export for callers that only need the intrinsic check alongside pairing. */
export function pairingImpossibleIntrinsic(input: {
  optionType: 'call' | 'put';
  standardContract: boolean;
  supportStatus: string;
  intrinsicPerShare: string | null;
  ask: string | null;
  intrinsicPercent: string | null;
}): boolean {
  return isImpossibleStandardCallIntrinsic(input);
}

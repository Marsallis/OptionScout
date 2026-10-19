/**
 * Presentation helpers for the LEAPS Finder.
 * These do not change discovery classification or saved strategy profiles.
 */

/** Configurable thresholds for preference-gap severity labels. */
export const PREFERENCE_GAP_THRESHOLDS = {
  /** Absolute delta shortfall below preferred that still counts as "small" (e.g. 0.78 vs 0.80). */
  smallDeltaShortfall: 0.05,
  /** Intrinsic % points below preferred that still count as "small" (e.g. 78 vs 80). */
  smallIntrinsicShortfallPoints: 5,
  /** Dollars above the ideal cost that still count as a "small" preference gap. */
  smallCostOverIdealDollars: 500,
} as const;

export type PreferenceGapSeverity = 'met' | 'small' | 'significant' | 'none';

export type PreferenceGapSummary = {
  severity: PreferenceGapSeverity;
  /** Chip / sublabel text, or null when no preference gap applies. */
  label: string | null;
  /** Beginner-friendly numeric explanations. */
  highlights: string[];
};

function parseNumber(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function absoluteShortfall(actual: string | null, target: string | null, higherIsBetter: boolean): number | null {
  const a = parseNumber(actual);
  const t = parseNumber(target);
  if (a == null || t == null) return null;
  return higherIsBetter ? Math.max(0, t - a) : Math.max(0, a - t);
}

type PreferenceReasonInput = {
  metric: string;
  kind: string;
  passed: boolean;
  target: string | null;
  actual: string | null;
  text: string;
};

/**
 * Summarize failed preference reasons into small vs significant gaps.
 * Hard rule failures and incomplete data are left to the existing class labels.
 */
export function summarizePreferenceGaps(
  reasons: readonly PreferenceReasonInput[],
  thresholds: typeof PREFERENCE_GAP_THRESHOLDS = PREFERENCE_GAP_THRESHOLDS,
): PreferenceGapSummary {
  const preferenceMisses = reasons.filter((reason) => reason.kind === 'preference' && !reason.passed);
  if (preferenceMisses.length === 0) {
    const preferencePasses = reasons.filter((reason) => reason.kind === 'preference' && reason.passed);
    if (preferencePasses.length === 0) return { severity: 'none', label: null, highlights: [] };
    return { severity: 'met', label: null, highlights: ['Configured preference targets are met for the metrics that were assessed.'] };
  }

  let significant = false;
  const highlights: string[] = [];

  for (const reason of preferenceMisses) {
    if (reason.metric === 'delta') {
      const gap = absoluteShortfall(reason.actual, reason.target, true);
      if (gap != null) {
        highlights.push(`Delta ${reason.actual} vs preferred ${reason.target} (shortfall ${gap.toFixed(2)}).`);
        if (gap > thresholds.smallDeltaShortfall) significant = true;
      } else {
        highlights.push(reason.text);
        significant = true;
      }
    } else if (reason.metric === 'intrinsicPercent') {
      const gap = absoluteShortfall(reason.actual, reason.target, true);
      if (gap != null) {
        highlights.push(`Intrinsic ${reason.actual}% vs preferred ${reason.target}% (shortfall ${gap.toFixed(1)} points).`);
        if (gap > thresholds.smallIntrinsicShortfallPoints) significant = true;
      } else {
        highlights.push(reason.text);
        significant = true;
      }
    } else if (reason.metric === 'purchaseCost') {
      const gap = absoluteShortfall(reason.actual, reason.target, false);
      if (gap != null) {
        highlights.push(`Ask cost $${Number(reason.actual).toLocaleString('en-US', { minimumFractionDigits: 2 })} vs ideal $${Number(reason.target).toLocaleString('en-US', { minimumFractionDigits: 2 })}.`);
        if (gap > thresholds.smallCostOverIdealDollars) significant = true;
      } else {
        highlights.push(reason.text);
        significant = true;
      }
    } else {
      highlights.push(reason.text);
      significant = true;
    }
  }

  return {
    severity: significant ? 'significant' : 'small',
    label: significant ? 'Significant preference gap' : 'Small preference gap',
    highlights,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Human-readable contract line: QCOM • $40 Call • Dec 15, 2028 */
export function formatContractDisplay(input: {
  underlying: string;
  strike: string;
  optionType: 'call' | 'put';
  expiration: string;
}): string {
  const strikeNumber = Number(input.strike);
  const strikeLabel = Number.isFinite(strikeNumber)
    ? `$${strikeNumber % 1 === 0 ? String(Math.trunc(strikeNumber)) : strikeNumber.toFixed(2)}`
    : `$${input.strike}`;
  const right = input.optionType === 'call' ? 'Call' : 'Put';
  let expirationLabel = input.expiration;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.expiration);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const monthName = MONTHS[month - 1];
    if (monthName && day >= 1 && day <= 31) {
      expirationLabel = `${monthName} ${day}, ${year}`;
    }
  }
  return `${input.underlying.trim().toUpperCase()} • ${strikeLabel} ${right} • ${expirationLabel}`;
}

export function formatUsd(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numeric);
}

export function formatPercentMetric(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function formatDelta(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/**
 * Same factual cutoff already used for the wide-spread research note.
 * A warning at this width does not change strategy classification.
 */
export const WIDE_BID_ASK_SPREAD_PERCENT = 5;

/** Quote-width warning. Null when the spread is missing or inside the cutoff. */
export function bidAskSpreadWarning(input: {
  bidAskSpreadPercent: string | null | undefined;
  crossedMarket?: boolean;
  invalidPrice?: boolean;
}): string | null {
  if (input.crossedMarket || input.invalidPrice) {
    return 'Bid and ask are crossed or invalid. This quote warning is separate from strategy fit.';
  }
  if (input.bidAskSpreadPercent == null || input.bidAskSpreadPercent === '') return null;
  const numeric = Number(input.bidAskSpreadPercent);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 'Bid and ask are crossed or invalid. This quote warning is separate from strategy fit.';
  }
  if (numeric >= WIDE_BID_ASK_SPREAD_PERCENT) {
    return `Wide bid/ask spread: ${formatPercentMetric(numeric)}. This is the quote width, separate from strategy fit.`;
  }
  return null;
}

/** Spread cell: never show a negative crossed spread as an ordinary comparable metric. */
export function formatSpreadDisplay(input: {
  crossedMarket: boolean;
  invalidPrice: boolean;
  bidAskSpreadPercent: string | null;
}): { text: string; invalid: boolean } {
  if (input.crossedMarket || input.invalidPrice) {
    return { text: 'Crossed/invalid market', invalid: true };
  }
  if (input.bidAskSpreadPercent == null) return { text: '—', invalid: false };
  const numeric = Number(input.bidAskSpreadPercent);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { text: 'Crossed/invalid market', invalid: true };
  }
  return { text: formatPercentMetric(input.bidAskSpreadPercent), invalid: false };
}

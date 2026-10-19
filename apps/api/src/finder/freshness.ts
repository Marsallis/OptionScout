import { isRegularUsEquitySession } from '../brokerage/market-hours.js';

export type ScreeningFreshness = 'fresh' | 'stale' | 'missing-provider-timestamp' | 'after-hours';

export interface ScreeningAssessment {
  freshness: ScreeningFreshness;
  marketSession: 'regular' | 'closed';
  afterHoursSnapshot: boolean;
  actionable: boolean;
  staleInputs: boolean;
  missingProviderTimestamp: boolean;
  quoteGreekMismatch: boolean;
}

/**
 * Screening freshness is stricter than the portfolio 15-minute classifier.
 * A quote without a provider timestamp is never treated as provider-confirmed fresh
 * merely because it was recently received locally.
 */
export function assessScreeningFreshness(input: {
  providerEventAt: string | null;
  greekEventAt: string | null;
  receivedAt: string;
  now: Date;
  screeningFreshnessSeconds: number;
}): ScreeningAssessment {
  const marketSession = isRegularUsEquitySession(input.now) ? 'regular' : 'closed';
  const afterHoursSnapshot = marketSession === 'closed';
  const windowMs = input.screeningFreshnessSeconds * 1000;

  if (!input.providerEventAt) {
    return {
      freshness: 'missing-provider-timestamp',
      marketSession,
      afterHoursSnapshot,
      actionable: false,
      staleInputs: true,
      missingProviderTimestamp: true,
      quoteGreekMismatch: false,
    };
  }

  const providerMs = Date.parse(input.providerEventAt);
  if (Number.isNaN(providerMs)) {
    return {
      freshness: 'missing-provider-timestamp',
      marketSession,
      afterHoursSnapshot,
      actionable: false,
      staleInputs: true,
      missingProviderTimestamp: true,
      quoteGreekMismatch: false,
    };
  }

  let quoteGreekMismatch = false;
  if (input.greekEventAt) {
    const greekMs = Date.parse(input.greekEventAt);
    if (!Number.isNaN(greekMs) && Math.abs(greekMs - providerMs) > windowMs) {
      quoteGreekMismatch = true;
    }
  }

  const ageMs = input.now.getTime() - providerMs;
  const staleInputs = ageMs > windowMs || quoteGreekMismatch;

  if (afterHoursSnapshot) {
    return {
      freshness: 'after-hours',
      marketSession,
      afterHoursSnapshot: true,
      actionable: false,
      staleInputs,
      missingProviderTimestamp: false,
      quoteGreekMismatch,
    };
  }

  return {
    freshness: staleInputs ? 'stale' : 'fresh',
    marketSession,
    afterHoursSnapshot: false,
    actionable: !staleInputs && !quoteGreekMismatch,
    staleInputs,
    missingProviderTimestamp: false,
    quoteGreekMismatch,
  };
}

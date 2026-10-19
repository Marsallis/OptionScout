import { describe, expect, it } from 'vitest';
import {
  assessUnderlyingOptionPairing,
  buildCandidateValidationCounters,
  isUnderlyingNbboWide,
} from './index.js';

describe('market-data-validation (synthetic / replay fixtures)', () => {
  it('A-helper: impossible intrinsic → reject option_ask_below_intrinsic', () => {
    const issues = assessUnderlyingOptionPairing({
      marketSession: 'closed',
      observationFreshness: 'previous-session',
      quoteSkewSeconds: 40_000,
      screeningFreshnessSeconds: 60,
      impossibleIntrinsic: true,
      underlyingPrice: '80.00',
      strike: '40.00',
      ask: '12.00',
      intrinsicPerShare: '40.00',
      intrinsicPercent: '333.33',
    });
    expect(issues.some((issue) => issue.code === 'option_ask_below_intrinsic' && issue.severity === 'reject')).toBe(
      true,
    );
    expect(issues.some((issue) => issue.code === 'stock_option_research_clock_gap')).toBe(false);
  });

  it('B-helper: research clock gap is warning when intrinsic is possible', () => {
    const issues = assessUnderlyingOptionPairing({
      marketSession: 'closed',
      observationFreshness: 'previous-session',
      quoteSkewSeconds: 39_000,
      screeningFreshnessSeconds: 60,
      impossibleIntrinsic: false,
      underlyingQuoteAt: '2026-10-17T10:33:00.000Z',
      optionQuoteAt: '2026-10-16T23:36:00.000Z',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('stock_option_research_clock_gap');
    expect(issues[0]?.severity).toBe('warning');
  });

  it('F-helper: live regular-session skew → stock_option_live_skew reject', () => {
    const issues = assessUnderlyingOptionPairing({
      marketSession: 'regular',
      observationFreshness: 'current-session',
      quoteSkewSeconds: 480,
      screeningFreshnessSeconds: 60,
      impossibleIntrinsic: false,
    });
    expect(issues.some((issue) => issue.code === 'stock_option_live_skew' && issue.severity === 'reject')).toBe(true);
  });

  it('G-helper: wide underlying NBBO is detectable without auto-reject', () => {
    expect(isUnderlyingNbboWide('50.00', '80.00')).toBe(true);
    expect(isUnderlyingNbboWide('100.00', '100.20')).toBe(false);
  });

  it('I-helper: progress counters / rejection breakdown', () => {
    const counters = buildCandidateValidationCounters(
      [
        {
          ask: '132.50',
          delta: '0.85',
          dataQuality: 'usable',
          greekVerification: 'aligned',
          meetsConfiguredNumericRequirements: true,
          outcome: 'near',
          validationIssues: [
            { code: 'stock_option_research_clock_gap', severity: 'warning' },
          ],
        },
        {
          ask: '12.00',
          delta: '0.86',
          dataQuality: 'inconsistent',
          greekVerification: 'aligned',
          meetsConfiguredNumericRequirements: false,
          outcome: 'incomplete',
          validationIssues: [{ code: 'option_ask_below_intrinsic', severity: 'reject' }],
        },
        {
          ask: null,
          delta: null,
          dataQuality: 'missing',
          greekVerification: 'unavailable',
          meetsConfiguredNumericRequirements: false,
          outcome: 'incomplete',
          validationIssues: [{ code: 'missing_option_ask', severity: 'reject' }],
        },
      ],
      5,
    );
    expect(counters.attempted).toBe(3);
    expect(counters.withPrices).toBe(2);
    expect(counters.withGreeks).toBe(2);
    expect(counters.validatedOk).toBe(1);
    expect(counters.meetHardNumerical).toBe(1);
    expect(counters.unevaluated).toBe(5);
    expect(counters.rejectionBreakdown.option_ask_below_intrinsic).toBe(1);
    expect(counters.rejectionBreakdown.missing_option_ask).toBe(1);
  });
});

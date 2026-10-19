import { describe, expect, it } from 'vitest';
import {
  assessCandidate,
  buildCandidateAssessmentPlainSummary,
  isHistoricalNumericalFit,
  isVerifiedCurrentMatch,
  marketDataValidityLabel,
  observationFreshnessAssessmentLabel,
  sortCandidatesClosestToStrategy,
  strategyFitAssessmentLabel,
  underlyingSpotIncompatible,
} from './finder-assessment.js';
import { buildWmtAnalysisCandidate } from './wmt-analysis-fixture.js';

describe('finder assessment labels', () => {
  it('maps dataQuality to Valid / Missing / Invalid / Inconsistent', () => {
    expect(marketDataValidityLabel('usable')).toBe('Valid');
    expect(marketDataValidityLabel('stale')).toBe('Valid');
    expect(marketDataValidityLabel('missing')).toBe('Missing');
    expect(marketDataValidityLabel('invalid')).toBe('Invalid');
    expect(marketDataValidityLabel('inconsistent')).toBe('Inconsistent');
  });

  it('maps observation freshness without implying live execution', () => {
    expect(observationFreshnessAssessmentLabel('current-session')).toBe('Current session');
    expect(observationFreshnessAssessmentLabel('previous-session')).toBe('Previous session');
    expect(observationFreshnessAssessmentLabel('older')).toBe('Older');
    expect(observationFreshnessAssessmentLabel('unavailable')).toBe('Unavailable');
  });

  it('explains valid previous-session WMT that meets hard+preferred numerically', () => {
    const candidate = buildWmtAnalysisCandidate();
    expect(candidate.observationFreshness).toBe('previous-session');
    expect(candidate.meetsConfiguredNumericRequirements).toBe(true);
    expect(isVerifiedCurrentMatch(candidate)).toBe(false);
    expect(isHistoricalNumericalFit(candidate)).toBe(true);
    expect(strategyFitAssessmentLabel(candidate)).toBe('Meets hard requirements');
    expect(buildCandidateAssessmentPlainSummary(candidate)).toMatch(
      /Meets numerical strategy requirements as of the previous session\. Execution not verified\./i,
    );
  });

  it('states delta requirement not verified when delta is missing', () => {
    const candidate = buildWmtAnalysisCandidate({
      delta: null,
      greekVerification: 'unavailable',
      meetsConfiguredNumericRequirements: false,
      outcome: 'incomplete',
      flags: {
        ...buildWmtAnalysisCandidate().flags,
        missingGreeks: true,
      },
    });
    expect(buildCandidateAssessmentPlainSummary(candidate)).toMatch(/Delta requirement not verified/i);
    expect(strategyFitAssessmentLabel(candidate)).toBe('Cannot verify required values');
  });

  it('rejects inconsistent rows from valid mathematical comparisons', () => {
    const candidate = buildWmtAnalysisCandidate({
      underlying: 'ZZTST',
      underlyingPrice: '80.00',
      strike: '40.00',
      ask: '12.00',
      dataQuality: 'inconsistent',
      calculations: {
        ...buildWmtAnalysisCandidate().calculations,
        intrinsicValue: '40.00',
        intrinsicPercent: '333.33',
        extrinsicValue: '-28.00',
        estimatedPurchaseCost: '1200.00',
      },
      meetsConfiguredNumericRequirements: false,
      outcome: 'incomplete',
    });
    expect(underlyingSpotIncompatible(candidate)).toBe(true);
    expect(isVerifiedCurrentMatch(candidate)).toBe(false);
    expect(isHistoricalNumericalFit(candidate)).toBe(false);
    expect(strategyFitAssessmentLabel(candidate)).toBe('Cannot verify required values');
    expect(buildCandidateAssessmentPlainSummary(candidate)).toMatch(/Rejected from valid mathematical comparisons/i);
  });

  it('does not call a contract a verified CURRENT match when Greeks align but data is inconsistent', () => {
    const candidate = buildWmtAnalysisCandidate({
      observationFreshness: 'current-session',
      marketSession: 'regular',
      greekVerification: 'aligned',
      dataQuality: 'inconsistent',
      meetsConfiguredNumericRequirements: true,
    });
    expect(isVerifiedCurrentMatch(candidate)).toBe(false);
    const assessment = assessCandidate(candidate);
    expect(assessment.isVerifiedCurrentMatch).toBe(false);
    expect(assessment.marketDataValidity).toBe('Inconsistent');
  });

  it('allows historical numerical fit when the market is closed', () => {
    const candidate = buildWmtAnalysisCandidate({
      observationFreshness: 'previous-session',
      marketSession: 'closed',
      greekVerification: 'aligned',
      dataQuality: 'usable',
      meetsConfiguredNumericRequirements: true,
    });
    expect(isHistoricalNumericalFit(candidate)).toBe(true);
    expect(isVerifiedCurrentMatch(candidate)).toBe(false);
  });

  it('sorts closest-to-strategy ahead of cheaper outside-profile rows', () => {
    const exact = buildWmtAnalysisCandidate({ id: 'exact', outcome: 'exact', meetsConfiguredNumericRequirements: true });
    const cheapOutside = buildWmtAnalysisCandidate({
      id: 'cheap',
      outcome: 'outside-profile',
      meetsConfiguredNumericRequirements: false,
      calculations: { ...buildWmtAnalysisCandidate().calculations, estimatedPurchaseCost: '1000.00' },
    });
    expect(sortCandidatesClosestToStrategy([cheapOutside, exact])[0]?.id).toBe('exact');
  });
});

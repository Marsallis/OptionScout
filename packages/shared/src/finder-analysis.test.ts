import { describe, expect, it } from 'vitest';
import { SAL_PMCC_DEEP_ITM } from './strategy-profile.js';
import {
  buildComparisonSummary,
  buildLeapsPlainSummary,
  buildPremiumBreakdown,
  buildStrategyFitRows,
  comparisonLeaders,
  computePremiumFromQuote,
  expirationPayoffScenarios,
  quoteStatusCopy,
  sortCandidatesByPriority,
} from './finder-analysis.js';
import { buildWmtAnalysisCandidate, WMT_ANALYSIS_FIXTURE_NOTICE, WMT_ANALYSIS_REFERENCE } from './wmt-analysis-fixture.js';

describe('WMT analysis fixture (not live market data)', () => {
  it('matches the Phase 1D.1f reference premium math', () => {
    const computed = computePremiumFromQuote({
      stockPrice: WMT_ANALYSIS_REFERENCE.stockPrice,
      strike: WMT_ANALYSIS_REFERENCE.strike,
      ask: WMT_ANALYSIS_REFERENCE.ask,
      multiplier: WMT_ANALYSIS_REFERENCE.multiplier,
    });
    expect(computed.costPerContract).toBe(WMT_ANALYSIS_REFERENCE.estimatedPurchaseCost);
    expect(computed.intrinsicPerShare).toBe(WMT_ANALYSIS_REFERENCE.intrinsicPerShare);
    expect(computed.intrinsicPerContract).toBe(WMT_ANALYSIS_REFERENCE.intrinsicPerContract);
    expect(computed.extrinsicPerShare).toBe(WMT_ANALYSIS_REFERENCE.extrinsicPerShare);
    expect(computed.extrinsicPerContract).toBe(WMT_ANALYSIS_REFERENCE.extrinsicPerContract);
    expect(computed.intrinsicPercent).toBe(WMT_ANALYSIS_REFERENCE.intrinsicPercent);
  });

  it('labels the fixture as simulated and builds a beginner plain summary', () => {
    const candidate = buildWmtAnalysisCandidate();
    expect(candidate.supportNote).toContain('NOT LIVE');
    expect(WMT_ANALYSIS_FIXTURE_NOTICE).toContain('SIMULATED');
    const summary = buildLeapsPlainSummary(candidate);
    expect(summary).toContain('WMT');
    expect(summary).toContain('80');
    expect(summary).toContain('4,445');
    expect(summary).toMatch(/right, but not the obligation/i);
    expect(summary).toMatch(/does not mean you own/i);
  });

  it('builds strategy-fit rows with pass / preferred-miss / not-assessed (never invents passes)', () => {
    const candidate = buildWmtAnalysisCandidate();
    const rows = buildStrategyFitRows(candidate, SAL_PMCC_DEEP_ITM);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    // WMT fixture cost $4,445 is below the $6,000 ideal preference → pass (not preferred-miss).
    expect(byId['ideal-cost']?.status).toBe('pass');
    expect(byId['hard-max-cost']?.status).toBe('pass');
    expect(byId['min-delta']?.status).toBe('pass');
    expect(byId['preferred-delta']?.status).toBe('pass');
    expect(byId['intrinsic']?.status).toBe('pass');
    expect(byId['expiration']?.status).toBe('pass');
    expect(byId['open-interest']?.status).toBe('not-assessed');
    expect(byId['volume']?.status).toBe('not-assessed');
    expect(byId['spread']?.status).toBe('not-assessed');
    expect(byId['preferred-delta']?.explanation).toMatch(/0\.8565/);
  });

  it('reports observation freshness and Greek verification without actionable screening language', () => {
    const copy = quoteStatusCopy(buildWmtAnalysisCandidate());
    expect(copy.label).toMatch(/previous-session/i);
    expect(copy.label).toMatch(/greeks aligned/i);
    expect(copy.label.toLowerCase()).not.toContain('actionable');
    expect(copy.detail.toLowerCase()).not.toContain('buy recommendation');
  });

  it('leaves delta hard/preferred not-assessed when Greeks are not aligned', () => {
    const candidate = buildWmtAnalysisCandidate({ greekVerification: 'historical-unverified' });
    const rows = buildStrategyFitRows(candidate, SAL_PMCC_DEEP_ITM);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId['min-delta']?.status).toBe('not-assessed');
    expect(byId['preferred-delta']?.status).toBe('not-assessed');
    expect(byId['min-delta']?.explanation).toMatch(/not-assessed/i);
  });

  it('builds expiration payoff scenarios including break-even and downside moves', () => {
    const points = expirationPayoffScenarios(buildWmtAnalysisCandidate());
    expect(points.length).toBeGreaterThanOrEqual(7);
    const breakeven = points.find((row) => row.kind === 'breakeven');
    expect(breakeven?.stockPrice).toBe(WMT_ANALYSIS_REFERENCE.expirationBreakEven);
    const down30 = points.find((row) => row.label === '−30% stock');
    expect(down30).toBeTruthy();
    expect(Number(down30!.profitPerContract)).toBeLessThan(0);
  });

  it('builds premium breakdown shares for the proportional bar', () => {
    const breakdown = buildPremiumBreakdown(buildWmtAnalysisCandidate());
    expect(breakdown.intrinsicShareOfPremium).toBeCloseTo(3870 / 4445, 4);
    expect(breakdown.extrinsicShareOfPremium).toBeCloseTo(575 / 4445, 4);
  });
});

describe('contract comparison helpers', () => {
  it('picks factual leaders and never crowns missing values', () => {
    const cheap = buildWmtAnalysisCandidate({
      id: 'a',
      strike: '85.00',
      calculations: {
        ...buildWmtAnalysisCandidate().calculations,
        estimatedPurchaseCost: '3500.00',
        intrinsicPercent: '70.00',
      },
      delta: '0.7800',
      metrics: { ...buildWmtAnalysisCandidate().metrics, purchaseCost: 3500, delta: 0.78, intrinsicPercent: 70 },
    });
    const rich = buildWmtAnalysisCandidate({ id: 'b' });
    const missing = buildWmtAnalysisCandidate({
      id: 'c',
      delta: null,
      calculations: { ...buildWmtAnalysisCandidate().calculations, estimatedPurchaseCost: null },
      metrics: { ...buildWmtAnalysisCandidate().metrics, purchaseCost: null, delta: null },
    });
    const leaders = comparisonLeaders([cheap, rich, missing]);
    expect(leaders.find((row) => row.badge === 'Lowest Cost')?.leaderId).toBe('a');
    expect(leaders.find((row) => row.badge === 'Highest Delta')?.leaderId).toBe('b');
    expect(leaders.every((row) => row.leaderId !== 'c')).toBe(true);
    const summary = buildComparisonSummary([cheap, rich]);
    expect(summary).toMatch(/less capital/i);
    expect(summary.toLowerCase()).not.toContain('best investment');
    expect(sortCandidatesByPriority([rich, cheap], 'lowest-cost')[0]?.id).toBe('a');
  });
});

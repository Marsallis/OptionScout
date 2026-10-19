import { describe, expect, it } from 'vitest';
import { SAL_PMCC_DEEP_ITM, type StrategyProfile } from './strategy-profile.js';
import {
  ACCEPTANCE_SAVED_PROFILE,
  buildCvxJan2029AcceptanceCandidate,
  buildWmtJan2029AcceptanceCandidate,
} from './plan-fit-acceptance-fixtures.js';
import {
  assignRankingBadges,
  beginnerDiscoveryGroup,
  buildBeginnerContractSummary,
  buildPlanFitSummary,
  explainContractTradeoff,
  groupCandidatesForStrategyMatch,
  markParetoEfficientEligible,
  rankCandidatesForBeginner,
  sortCandidatesByFactualMetric,
} from './plan-fit.js';
import { buildWmtAnalysisCandidate } from './wmt-analysis-fixture.js';

function profileWithLiquidity(hardMax = '7500.00'): StrategyProfile {
  return {
    ...ACCEPTANCE_SAVED_PROFILE,
    hard: { ...ACCEPTANCE_SAVED_PROFILE.hard, maxContractCost: hardMax },
    preferences: {
      ...ACCEPTANCE_SAVED_PROFILE.preferences,
      maxBidAskSpreadPercent: '2.00',
      minOpenInterest: 100,
      minVolume: 10,
    },
  };
}

describe('factual strategy matching (display-only)', () => {
  it('scores WMT Jan 2029 as eligible with all preferences met (6/6 checklist)', () => {
    const fit = buildPlanFitSummary(buildWmtJan2029AcceptanceCandidate(), ACCEPTANCE_SAVED_PROFILE);
    expect(fit.eligibility).toBe('eligible');
    expect(fit.matchGroup).toBe('eligible-all-prefs-met');
    expect(fit.passedCount).toBe(6);
    expect(fit.scoreLabel).toBe('Core Plan Fit: 6/6');
    expect(fit.checklistDisclaimer).toMatch(/checklist/i);
    expect(fit.preferenceDeviations.every((d) => d.status === 'met')).toBe(true);
  });

  it('shows exact budget magnitude for CVX 5/6 preference miss without inventing a quality score', () => {
    const fit = buildPlanFitSummary(buildCvxJan2029AcceptanceCandidate(), ACCEPTANCE_SAVED_PROFILE);
    expect(fit.eligibility).toBe('eligible');
    expect(fit.matchGroup).toBe('eligible-preference-differences');
    expect(fit.passedCount).toBe(5);
    const cost = fit.preferenceDeviations.find((d) => d.id === 'ideal-cost');
    expect(cost?.status).toBe('missed');
    expect(cost?.magnitudeLabel).toMatch(/\$1,330/);
    expect(cost?.magnitudeLabel).toMatch(/22\.2%/);
    expect(cost?.magnitudeLabel).toMatch(/\$6,000/);
    expect(JSON.stringify(fit)).not.toMatch(/alignment score|penalty|out of 100/i);
  });

  it('marks hard-max failure as Not Eligible even when preferences look strong', () => {
    const expensive = buildWmtJan2029AcceptanceCandidate({
      id: 'hard-fail-cost',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '26000.00',
      },
      metrics: { ...buildWmtJan2029AcceptanceCandidate().metrics, purchaseCost: 26000 },
      meetsConfiguredNumericRequirements: false,
      outcome: 'outside-profile',
    });
    const fit = buildPlanFitSummary(expensive, ACCEPTANCE_SAVED_PROFILE);
    expect(fit.eligibility).toBe('not-eligible');
    expect(fit.matchGroup).toBe('outside-strategy');
    expect(fit.eligibilityHardFailed).toBeGreaterThan(0);
    expect(fit.beginnerOutcomeLabel).toBe('Outside My Plan');
  });

  it('known hard failure takes precedence over missing measurements elsewhere', () => {
    const candidate = buildWmtJan2029AcceptanceCandidate({
      id: 'hard-fail-plus-missing',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '26000.00',
      },
      greekVerification: 'historical-unverified',
      meetsConfiguredNumericRequirements: false,
      outcome: 'outside-profile',
    });
    const fit = buildPlanFitSummary(candidate, ACCEPTANCE_SAVED_PROFILE);
    expect(fit.eligibility).toBe('not-eligible');
    expect(fit.matchGroup).toBe('outside-strategy');
  });

  it('missing delta yields Cannot Verify when no hard failure is known', () => {
    const candidate = buildWmtJan2029AcceptanceCandidate({
      greekVerification: 'historical-unverified',
      outcome: 'incomplete',
      meetsConfiguredNumericRequirements: false,
    });
    const fit = buildPlanFitSummary(candidate, ACCEPTANCE_SAVED_PROFILE);
    expect(fit.eligibility).toBe('cannot-verify');
    expect(fit.matchGroup).toBe('cannot-verify');
    expect(fit.checks.find((c) => c.id === 'min-delta')?.result).toBe('notAssessed');
  });

  it('invalid market data is grouped separately and excluded from verified comparisons', () => {
    const candidate = buildWmtJan2029AcceptanceCandidate({
      dataQuality: 'inconsistent',
      validationIssues: [
        { code: 'option_ask_below_intrinsic', severity: 'reject', message: 'Ask below intrinsic', details: {} },
      ],
      outcome: 'incomplete',
      meetsConfiguredNumericRequirements: false,
    });
    const fit = buildPlanFitSummary(candidate, ACCEPTANCE_SAVED_PROFILE);
    expect(fit.invalidMarketData).toBe(true);
    expect(fit.matchGroup).toBe('invalid-data');
  });

  it('maps beginner groups without changing the stored strategy group', () => {
    const best = buildPlanFitSummary(buildWmtJan2029AcceptanceCandidate(), ACCEPTANCE_SAVED_PROFILE);
    expect(beginnerDiscoveryGroup(best)).toBe('best-matches');

    const near = buildPlanFitSummary(buildCvxJan2029AcceptanceCandidate(), ACCEPTANCE_SAVED_PROFILE);
    expect(near.matchGroup).toBe('eligible-preference-differences');
    expect(beginnerDiscoveryGroup(near)).toBe('near-matches');

    const missingIntrinsic = buildWmtJan2029AcceptanceCandidate({
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        intrinsicPercent: null,
      },
    });
    const unassessed = buildPlanFitSummary(missingIntrinsic, ACCEPTANCE_SAVED_PROFILE);
    expect(unassessed.matchGroup).toBe('eligible-preference-differences');
    expect(beginnerDiscoveryGroup(unassessed)).toBe('need-more-data');

    const hardFail = buildPlanFitSummary(
      buildWmtJan2029AcceptanceCandidate({
        calculations: {
          ...buildWmtJan2029AcceptanceCandidate().calculations,
          estimatedPurchaseCost: '26000.00',
        },
        meetsConfiguredNumericRequirements: false,
        outcome: 'outside-profile',
      }),
      ACCEPTANCE_SAVED_PROFILE,
    );
    expect(beginnerDiscoveryGroup(hardFail)).toBe('outside-plan');

    const invalid = buildPlanFitSummary(
      buildWmtJan2029AcceptanceCandidate({
        dataQuality: 'inconsistent',
        validationIssues: [
          { code: 'option_ask_below_intrinsic', severity: 'reject', message: 'Ask below intrinsic', details: {} },
        ],
        outcome: 'incomplete',
        meetsConfiguredNumericRequirements: false,
      }),
      ACCEPTANCE_SAVED_PROFILE,
    );
    expect(beginnerDiscoveryGroup(invalid)).toBe('invalid-quotes');
  });

  it('keeps a configured liquidity miss as a preference in the beginner group', () => {
    const profile = profileWithLiquidity();
    const candidate = buildWmtJan2029AcceptanceCandidate({
      openInterest: 5,
      volume: 1,
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        bidAskSpreadPercent: '5.00',
      },
    });
    const fit = buildPlanFitSummary(candidate, profile);
    expect(fit.matchGroup).toBe('outside-strategy');
    expect(beginnerDiscoveryGroup(fit)).toBe('near-matches');
  });

  it('configured liquidity failure outside the six checks blocks eligibility', () => {
    const profile = profileWithLiquidity();
    const candidate = buildWmtJan2029AcceptanceCandidate({
      openInterest: 5,
      volume: 1,
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        bidAskSpreadPercent: '5.00',
      },
    });
    const fit = buildPlanFitSummary(candidate, profile);
    expect(fit.passedCount).toBe(6);
    expect(fit.eligibilityHardTotal).toBeGreaterThan(3);
    expect(fit.eligibility).toBe('not-eligible');
    expect(fit.matchGroup).toBe('outside-strategy');
  });

  it('groups Matches to My Strategy without inventing overall quality ranking', () => {
    const cheapWeak = buildWmtJan2029AcceptanceCandidate({
      id: 'cheap-weak',
      delta: '0.7600',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '5000.00',
        intrinsicPercent: '70.00',
      },
      metrics: { purchaseCost: 5000, delta: 0.76, intrinsicPercent: 70, extrinsicValue: 10, bidAskSpread: 1, liquidity: null, dte: 825, theta: -0.01, downsideMoneyness: 10, pmccCompatibility: null },
      outcome: 'near',
    });
    const richer = buildCvxJan2029AcceptanceCandidate({ id: 'richer-delta' });
    const hardFail = buildWmtJan2029AcceptanceCandidate({
      id: 'outside',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '26000.00',
      },
      metrics: { ...buildWmtJan2029AcceptanceCandidate().metrics, purchaseCost: 26000 },
      outcome: 'outside-profile',
      meetsConfiguredNumericRequirements: false,
    });

    const groups = groupCandidatesForStrategyMatch(
      [hardFail, richer, cheapWeak],
      ACCEPTANCE_SAVED_PROFILE,
      'purchaseCost',
    );
    expect(groups.map((g) => g.id)).toEqual([
      'eligible-preference-differences',
      'outside-strategy',
    ]);
    const eligible = groups.find((g) => g.id === 'eligible-preference-differences')!;
    expect(eligible.candidates.map((c) => c.id)).toEqual(['cheap-weak', 'richer-delta']);
  });

  it('sorts within a group by factual metric without declaring a universal winner', () => {
    const a = buildWmtJan2029AcceptanceCandidate({
      id: 'a-6100',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '6100.00',
      },
    });
    const b = buildCvxJan2029AcceptanceCandidate({ id: 'b-7330' });
    const byCostDistance = sortCandidatesByFactualMetric(
      [b, a],
      ACCEPTANCE_SAVED_PROFILE,
      'preferred-cost-distance',
    );
    expect(byCostDistance.map((c) => c.id)).toEqual(['a-6100', 'b-7330']);

    const byDelta = sortCandidatesByFactualMetric([a, b], ACCEPTANCE_SAVED_PROFILE, 'delta');
    expect(byDelta[0]?.id).toBe('a-6100'); // WMT 0.8721 > CVX 0.8238
  });

  it('explains tradeoffs between conflicting preferences without picking a winner', () => {
    const cheap = buildWmtJan2029AcceptanceCandidate({
      id: 'cheap',
      delta: '0.7600',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '5000.00',
        intrinsicPercent: '55.00',
      },
    });
    const rich = buildCvxJan2029AcceptanceCandidate({ id: 'rich' });
    const text = explainContractTradeoff(cheap, rich, ACCEPTANCE_SAVED_PROFILE);
    expect(text).toMatch(/costs/i);
    expect(text).toMatch(/factual tradeoff/i);
    expect(text).not.toMatch(/better investment|safer choice|buy this/i);
    expect(text).toMatch(/not a recommendation/i);
  });

  it('assigns only factual evaluated-set badges', () => {
    const good = buildWmtJan2029AcceptanceCandidate({ id: 'good' });
    const badges = assignRankingBadges([good], ACCEPTANCE_SAVED_PROFILE);
    const list = badges.get('good') ?? [];
    expect(list).toContain('Meets All Hard Requirements');
    expect(list).toContain('All Preferred Targets Met');
    expect(list).toContain('Lowest Cost Among Evaluated');
    expect(JSON.stringify(list)).not.toMatch(/Best Beginner|Best Overall|Safest|Highest Quality/i);
  });

  it('marks Pareto-efficient eligible contracts when cost/delta/intrinsic are complete', () => {
    const a = buildWmtJan2029AcceptanceCandidate({ id: 'pareto-a' });
    const dominated = buildWmtJan2029AcceptanceCandidate({
      id: 'dominated',
      delta: '0.8000',
      calculations: {
        ...buildWmtJan2029AcceptanceCandidate().calculations,
        estimatedPurchaseCost: '6500.00',
        intrinsicPercent: '80.00',
      },
    });
    const set = markParetoEfficientEligible([a, dominated], ACCEPTANCE_SAVED_PROFILE);
    expect(set.has('pareto-a')).toBe(true);
    expect(set.has('dominated')).toBe(false);
  });

  it('keeps rankings stable across repeated evaluations', () => {
    const rows = [
      buildCvxJan2029AcceptanceCandidate({ id: 'b' }),
      buildWmtJan2029AcceptanceCandidate({ id: 'a' }),
    ];
    const first = rankCandidatesForBeginner(rows, ACCEPTANCE_SAVED_PROFILE).map((c) => c.id);
    const second = rankCandidatesForBeginner(rows, ACCEPTANCE_SAVED_PROFILE).map((c) => c.id);
    expect(first).toEqual(second);
  });

  it('does not mutate the built-in template when using saved-revision fixture thresholds', () => {
    const frozen = structuredClone(SAL_PMCC_DEEP_ITM);
    const cvx = buildCvxJan2029AcceptanceCandidate();
    expect(buildPlanFitSummary(cvx, SAL_PMCC_DEEP_ITM).eligibility).toBe('not-eligible');
    expect(buildPlanFitSummary(cvx, ACCEPTANCE_SAVED_PROFILE).eligibility).toBe('eligible');
    expect(SAL_PMCC_DEEP_ITM.hard.maxContractCost).toBe(frozen.hard.maxContractCost);
    expect(SAL_PMCC_DEEP_ITM.revision).toBe(frozen.revision);
  });

  it('builds beginner summary with exact preference magnitudes', () => {
    const summary = buildBeginnerContractSummary(
      buildCvxJan2029AcceptanceCandidate(),
      ACCEPTANCE_SAVED_PROFILE,
    );
    expect(summary.cautions.some((line) => /22\.2%/.test(line))).toBe(true);
    expect(summary.cautions.some((line) => /not a buy recommendation/i.test(line))).toBe(true);
  });

  it('does not treat cost below ideal as a preference miss', () => {
    const fit = buildPlanFitSummary(
      buildWmtJan2029AcceptanceCandidate({
        calculations: {
          ...buildWmtJan2029AcceptanceCandidate().calculations,
          estimatedPurchaseCost: '4500.00',
        },
      }),
      ACCEPTANCE_SAVED_PROFILE,
    );
    expect(fit.preferenceDeviations.find((d) => d.id === 'ideal-cost')?.status).toBe('met');
  });

  it('keeps legacy WMT analysis fixture coherent', () => {
    const fit = buildPlanFitSummary(buildWmtAnalysisCandidate(), SAL_PMCC_DEEP_ITM);
    expect(fit.eligibility).toBe('eligible');
    expect(fit.passedCount).toBe(6);
  });
});

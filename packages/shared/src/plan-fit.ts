/**
 * Beginner-first Core Plan Fit + factual strategy matching (display-only).
 * Uses existing buildStrategyFitRows — does not change classification math,
 * validation, or saved strategy revisions.
 *
 * No weighted scores, penalty curves, or investment-quality ratings.
 * Hard requirements are strict gates. Preferences show exact numerical gaps.
 */

import { buildStrategyFitRows, type StrategyFitRow, type StrategyFitStatus } from './finder-analysis.js';
import type { FinderCandidate } from './finder.js';
import type { StrategyProfile } from './strategy-profile.js';

/** The six Core Plan Fit checklist checks (3 hard + 3 preference). */
export const PLAN_FIT_HARD_CHECK_IDS = ['hard-max-cost', 'min-delta', 'expiration'] as const;
export const PLAN_FIT_PREF_CHECK_IDS = ['ideal-cost', 'preferred-delta', 'intrinsic'] as const;
export const PLAN_FIT_CHECK_IDS = [...PLAN_FIT_HARD_CHECK_IDS, ...PLAN_FIT_PREF_CHECK_IDS] as const;
export const PLAN_FIT_EXTRA_ROW_IDS = ['spread', 'open-interest', 'volume'] as const;

export const PLAN_FIT_RANKING_SCOPE_NOTE =
  'Labels and groups apply only to contracts already evaluated in this session. Scan More may still leave better chain contracts unexamined.';

/**
 * Optional presentation-only gap labels. Not used for eligibility or ranking.
 * When the owner has not opted into qualitative labels, UI shows exact numbers only.
 */
export const PLAN_FIT_PRESENTATION_GAP_THRESHOLDS = {
  version: 1 as const,
  /** % above ideal cost — presentation label only when enabled. */
  majorCostOverIdealPercent: 20,
  /** Absolute delta shortfall — presentation label only when enabled. */
  majorDeltaShortfall: 0.05,
  /** Intrinsic percentage-point shortfall — presentation label only when enabled. */
  majorIntrinsicShortfallPoints: 10,
} as const;

export type PlanFitCheckId = (typeof PLAN_FIT_CHECK_IDS)[number];
export type PlanFitExtraCheckId =
  | (typeof PLAN_FIT_EXTRA_ROW_IDS)[number]
  | 'min-contract-cost'
  | 'max-expiration';
export type PlanFitCheckResult = 'passed' | 'failed' | 'notAssessed';

/** Legacy display tiers (mapped from eligibility + prefs for older UI). */
export type PlanFitTier =
  | 'great-fit'
  | 'strong-fit'
  | 'close-fit'
  | 'weak-fit'
  | 'not-a-fit'
  | 'not-enough-data';

export type StrategyEligibility = 'eligible' | 'not-eligible' | 'cannot-verify';

export type StrategyMatchGroupId =
  | 'eligible-all-prefs-met'
  | 'eligible-preference-differences'
  | 'cannot-verify'
  | 'outside-strategy'
  | 'invalid-data';

export type FactualSortMetric =
  | 'purchaseCost'
  | 'preferred-cost-distance'
  | 'delta'
  | 'intrinsicPercent'
  | 'extrinsicValue'
  | 'dte'
  | 'bidAskSpread';

export type PlanFitRankingBadge =
  | 'Lowest Cost Among Evaluated'
  | 'Highest Delta Among Evaluated'
  | 'Highest Intrinsic % Among Evaluated'
  | 'All Preferred Targets Met'
  | 'Meets All Hard Requirements';

export interface PlanFitCheck {
  id: PlanFitCheckId | PlanFitExtraCheckId;
  kind: 'hard' | 'preference' | 'liquidity' | 'extra-hard';
  result: PlanFitCheckResult;
  requirement: string;
  yourTarget: string;
  thisContract: string;
  explanation: string;
  core: boolean;
}

export interface PreferenceDeviation {
  id: 'ideal-cost' | 'preferred-delta' | 'intrinsic' | 'spread' | 'open-interest' | 'volume';
  label: string;
  target: number | null;
  actual: number | null;
  status: 'met' | 'missed' | 'notAssessed';
  /** Unfavorable absolute difference in native units (null if unassessed or met). */
  absoluteUnfavorable: number | null;
  /** Plain-English magnitude, e.g. "$1,330 (22.2%) above your $6,000 preferred budget." */
  magnitudeLabel: string;
}

export interface PlanFitSummary {
  metricName: 'Core Plan Fit';
  checks: PlanFitCheck[];
  extraChecks: PlanFitCheck[];
  /** All hard checks that count toward eligibility (core hard + configured extra hard + configured liquidity treated as hard gates when set). */
  eligibilityHardChecks: PlanFitCheck[];
  preferenceDeviations: PreferenceDeviation[];
  passedCount: number;
  failedCount: number;
  notAssessedCount: number;
  assessedCount: number;
  hardPassed: number;
  hardAssessed: number;
  hardFailed: number;
  /** Eligibility hard totals (may exceed 3 when extra hard/liquidity configured). */
  eligibilityHardPassed: number;
  eligibilityHardTotal: number;
  eligibilityHardAssessed: number;
  eligibilityHardFailed: number;
  prefPassed: number;
  prefAssessed: number;
  prefFailed: number;
  prefTotal: number;
  ringSegments: { passed: number; failed: number; notAssessed: number };
  scoreLabel: string;
  assessedDetailLabel: string;
  hardLabel: string;
  preferenceLabel: string;
  eligibility: StrategyEligibility;
  eligibilityLabel: string;
  matchGroup: StrategyMatchGroupId;
  matchGroupLabel: string;
  tier: PlanFitTier;
  tierLabel: string;
  beginnerOutcomeLabel: string;
  verdictLine: string;
  overallStrategyVerdict: string;
  whyRanksHere: string[];
  dataConfidenceLabel: 'Live' | 'Previous Session' | 'Cached' | 'Partial' | 'Older';
  executionQualityLabel: 'Unassessed' | 'Moderate' | 'Wide Spread';
  strategyFitLabel: string;
  extraHardFailed: boolean;
  extraConfiguredMiss: boolean;
  notEnoughData: boolean;
  invalidMarketData: boolean;
  rankingScopeNote: string;
  checklistDisclaimer: string;
}

export interface StrategyMatchGroup {
  id: StrategyMatchGroupId;
  label: string;
  candidates: FinderCandidate[];
}

export interface BeginnerContractSummary {
  whatItIs: string;
  whyMayFit: string[];
  cautions: string[];
}

export const STRATEGY_MATCH_GROUP_ORDER: readonly StrategyMatchGroupId[] = [
  'eligible-all-prefs-met',
  'eligible-preference-differences',
  'cannot-verify',
  'outside-strategy',
  'invalid-data',
] as const;

export const STRATEGY_MATCH_GROUP_LABELS: Record<StrategyMatchGroupId, string> = {
  'eligible-all-prefs-met': 'Eligible — All Preferences Met',
  'eligible-preference-differences': 'Eligible — Preference Differences',
  'cannot-verify': 'Cannot Verify Eligibility',
  'outside-strategy': 'Outside My Strategy — Known Hard-Rule Failures',
  'invalid-data': 'Invalid or Inconsistent Market Data',
};

export const PMCC_EXPLAINER_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'What a PMCC is trying to do',
    body:
      'A Poor Man’s Covered Call (PMCC) uses a deep in-the-money LEAPS call as a stock substitute, then optionally sells shorter-dated calls against it for premium. You are defining upside exposure with a known premium at risk — not owning 100 shares outright.',
  },
  {
    title: 'Why deep ITM LEAPS matter',
    body:
      'Higher delta and a larger intrinsic share of premium usually track the stock more closely than cheap out-of-the-money calls. That can mean more capital per contract. OptionScout compares contracts to your hard cost, delta, and expiration floors before preferences.',
  },
  {
    title: 'What Core Plan Fit checks',
    body:
      'Core Plan Fit is a six-item checklist visualization only — not an investment rating. Hard rules gate eligibility. Preferences show exact dollar, delta, and intrinsic gaps. Configured extra hard requirements (including liquidity when set) also gate eligibility outside the six-check ring.',
  },
  {
    title: 'What Core Plan Fit does not mean',
    body:
      'Passing checklist items is not a buy recommendation, fill guarantee, or proof of profit. Groups show how contracts relate to your saved rules; you judge tradeoffs from the actual measurements.',
  },
] as const;

function mapStatus(status: StrategyFitStatus): PlanFitCheckResult {
  if (status === 'pass') return 'passed';
  if (status === 'hard-fail' || status === 'preferred-miss') return 'failed';
  return 'notAssessed';
}

function num(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function hasRejectOrInconsistent(candidate: FinderCandidate): boolean {
  if (candidate.dataQuality === 'inconsistent' || candidate.dataQuality === 'invalid') return true;
  return (candidate.validationIssues ?? []).some((issue) => issue.severity === 'reject');
}

function dataConfidenceLabel(candidate: FinderCandidate): PlanFitSummary['dataConfidenceLabel'] {
  if (candidate.flags.fromCache) return 'Cached';
  if (
    candidate.dataQuality === 'missing' ||
    candidate.outcome === 'incomplete' ||
    candidate.observationFreshness === 'unavailable'
  ) {
    return 'Partial';
  }
  if (candidate.observationFreshness === 'current-session') return 'Live';
  if (candidate.observationFreshness === 'previous-session') return 'Previous Session';
  if (candidate.observationFreshness === 'older') return 'Older';
  return 'Partial';
}

function executionQualityLabel(candidate: FinderCandidate): PlanFitSummary['executionQualityLabel'] {
  const spread = num(candidate.calculations.bidAskSpreadPercent);
  if (spread == null || candidate.flags.crossedMarket || candidate.flags.invalidPrice) {
    return 'Unassessed';
  }
  if (spread >= 5) return 'Wide Spread';
  return 'Moderate';
}

function pickCoreChecks(rows: StrategyFitRow[]): PlanFitCheck[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const hardSet = new Set<string>(PLAN_FIT_HARD_CHECK_IDS);
  return PLAN_FIT_CHECK_IDS.map((id) => {
    const row = byId.get(id);
    return {
      id,
      kind: hardSet.has(id) ? ('hard' as const) : ('preference' as const),
      result: row ? mapStatus(row.status) : 'notAssessed',
      requirement: row?.requirement ?? id,
      yourTarget: row?.yourTarget ?? '—',
      thisContract: row?.thisContract ?? '—',
      explanation: row?.explanation ?? 'This check could not be assessed.',
      core: true,
    };
  });
}

/**
 * Extra hard gates outside the six-check ring.
 * Configured liquidity thresholds count toward eligibility (display gates),
 * without changing the underlying Exact/Near/Outside classifier.
 */
function buildEligibilityExtraHardChecks(
  rows: StrategyFitRow[],
  candidate: FinderCandidate,
  profile: StrategyProfile,
): PlanFitCheck[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const extras: PlanFitCheck[] = [];

  const cost = num(candidate.calculations.estimatedPurchaseCost);
  const minCost = num(profile.hard.minContractCost);
  if (minCost != null) {
    extras.push({
      id: 'min-contract-cost',
      kind: 'extra-hard',
      result: cost == null ? 'notAssessed' : cost >= minCost ? 'passed' : 'failed',
      requirement: 'Minimum contract cost',
      yourTarget: `At least ${money(minCost)}`,
      thisContract: cost != null ? money(cost) : 'Missing ask cost',
      explanation:
        cost == null
          ? 'Minimum cost could not be checked without a valid ask-based cost.'
          : cost >= minCost
            ? `Cost meets your optional minimum of ${money(minCost)}.`
            : `Cost is below your optional minimum of ${money(minCost)}.`,
      core: false,
    });
  }

  const dte = candidate.calculations.daysToExpiration;
  const maxDte = profile.hard.maxExpirationDays;
  if (maxDte != null) {
    extras.push({
      id: 'max-expiration',
      kind: 'extra-hard',
      result: dte == null ? 'notAssessed' : dte <= maxDte ? 'passed' : 'failed',
      requirement: 'Maximum expiration',
      yourTarget: `At most ${maxDte} days`,
      thisContract: dte != null ? `${dte} days` : 'Missing',
      explanation:
        dte == null
          ? 'Maximum expiration could not be checked.'
          : dte <= maxDte
            ? `Days remaining (${dte}) are within your optional ceiling of ${maxDte}.`
            : `Days remaining (${dte}) exceed your optional ceiling of ${maxDte}.`,
      core: false,
    });
  }

  // Configured liquidity → eligibility hard gates (display); unconfigured stay out.
  for (const id of PLAN_FIT_EXTRA_ROW_IDS) {
    const row = byId.get(id);
    if (!row) continue;
    if (/unconfigured/i.test(row.yourTarget)) continue;
    const result = mapStatus(row.status);
    extras.push({
      id,
      kind: 'extra-hard',
      result,
      requirement: row.requirement,
      yourTarget: row.yourTarget,
      thisContract: row.thisContract,
      explanation: row.explanation,
      core: false,
    });
  }

  return extras;
}

function buildPreferenceDeviations(
  candidate: FinderCandidate,
  profile: StrategyProfile,
  coreChecks: PlanFitCheck[],
): PreferenceDeviation[] {
  const byId = new Map(coreChecks.map((c) => [c.id, c]));
  const cost = num(candidate.calculations.estimatedPurchaseCost);
  const ideal = num(profile.preferences.idealContractCost);
  const delta = num(candidate.delta);
  const preferredDelta = num(profile.preferences.preferredLongDelta);
  const intrinsic = num(candidate.calculations.intrinsicPercent);
  const minIntrinsic = num(profile.preferences.minIntrinsicPercent);
  const greeksAligned = candidate.greekVerification === 'aligned';

  const idealCheck = byId.get('ideal-cost');
  const deltaCheck = byId.get('preferred-delta');
  const intrinsicCheck = byId.get('intrinsic');

  const deviations: PreferenceDeviation[] = [];

  // Ideal cost — only unfavorable when above preferred; below is met (not penalized).
  {
    let status: PreferenceDeviation['status'] = 'notAssessed';
    let absoluteUnfavorable: number | null = null;
    let magnitudeLabel = 'Preferred budget could not be compared (missing cost or target).';
    if (cost != null && ideal != null) {
      if (cost < ideal) {
        status = 'met';
        magnitudeLabel = `${money(cost)} is below your ${money(ideal)} preferred budget.`;
      } else if (cost === ideal) {
        status = 'met';
        magnitudeLabel = `${money(cost)} matches your ${money(ideal)} preferred budget.`;
      } else {
        status = 'missed';
        absoluteUnfavorable = cost - ideal;
        const pct = (absoluteUnfavorable / ideal) * 100;
        magnitudeLabel = `${money(absoluteUnfavorable)} (${pct.toFixed(1)}%) above your ${money(ideal)} preferred budget.`;
      }
    } else if (idealCheck?.result === 'notAssessed') {
      status = 'notAssessed';
    }
    deviations.push({
      id: 'ideal-cost',
      label: 'Preferred budget',
      target: ideal,
      actual: cost,
      status,
      absoluteUnfavorable,
      magnitudeLabel,
    });
  }

  {
    let status: PreferenceDeviation['status'] = 'notAssessed';
    let absoluteUnfavorable: number | null = null;
    let magnitudeLabel = 'Preferred delta could not be assessed (missing or unverified Greeks).';
    if (greeksAligned && delta != null && preferredDelta != null) {
      if (delta >= preferredDelta) {
        status = 'met';
        magnitudeLabel = `Delta ${delta.toFixed(4)} meets preferred ${preferredDelta}.`;
      } else {
        status = 'missed';
        absoluteUnfavorable = preferredDelta - delta;
        magnitudeLabel = `Delta ${delta.toFixed(4)} is ${absoluteUnfavorable.toFixed(4)} below preferred ${preferredDelta}.`;
      }
    } else if (deltaCheck?.result === 'failed') {
      status = 'missed';
    }
    deviations.push({
      id: 'preferred-delta',
      label: 'Preferred delta',
      target: preferredDelta,
      actual: greeksAligned ? delta : null,
      status,
      absoluteUnfavorable,
      magnitudeLabel,
    });
  }

  {
    let status: PreferenceDeviation['status'] = 'notAssessed';
    let absoluteUnfavorable: number | null = null;
    let magnitudeLabel = 'Preferred intrinsic % could not be compared.';
    if (intrinsic != null && minIntrinsic != null) {
      if (intrinsic >= minIntrinsic) {
        status = 'met';
        magnitudeLabel = `Intrinsic ${intrinsic.toFixed(2)}% meets preferred ${minIntrinsic}%+.`;
      } else {
        status = 'missed';
        absoluteUnfavorable = minIntrinsic - intrinsic;
        magnitudeLabel = `Intrinsic ${intrinsic.toFixed(2)}% is ${absoluteUnfavorable.toFixed(1)} percentage points below preferred ${minIntrinsic}%.`;
      }
    } else if (intrinsicCheck?.result === 'notAssessed') {
      status = 'notAssessed';
    }
    deviations.push({
      id: 'intrinsic',
      label: 'Preferred intrinsic %',
      target: minIntrinsic,
      actual: intrinsic,
      status,
      absoluteUnfavorable,
      magnitudeLabel,
    });
  }

  return deviations;
}

function computeEligibility(input: {
  invalidMarketData: boolean;
  eligibilityHardFailed: number;
  eligibilityHardAssessed: number;
  eligibilityHardTotal: number;
}): StrategyEligibility {
  // Known hard failure takes precedence over missing measurements elsewhere.
  if (input.eligibilityHardFailed > 0) return 'not-eligible';
  if (input.invalidMarketData) return 'cannot-verify';
  if (input.eligibilityHardAssessed < input.eligibilityHardTotal) return 'cannot-verify';
  return 'eligible';
}

function computeMatchGroup(input: {
  invalidMarketData: boolean;
  eligibility: StrategyEligibility;
  prefMissed: number;
  prefNotAssessed: number;
}): StrategyMatchGroupId {
  if (input.invalidMarketData) return 'invalid-data';
  if (input.eligibility === 'not-eligible') return 'outside-strategy';
  if (input.eligibility === 'cannot-verify') return 'cannot-verify';
  if (input.prefMissed > 0 || input.prefNotAssessed > 0) return 'eligible-preference-differences';
  return 'eligible-all-prefs-met';
}

function tierFromGroup(group: StrategyMatchGroupId, prefMissed: number): PlanFitTier {
  if (group === 'invalid-data' || group === 'cannot-verify') return 'not-enough-data';
  if (group === 'outside-strategy') return 'not-a-fit';
  if (group === 'eligible-all-prefs-met') return 'great-fit';
  if (prefMissed <= 1) return 'strong-fit';
  return 'close-fit';
}

function eligibilityLabelFor(eligibility: StrategyEligibility): string {
  if (eligibility === 'eligible') return 'Eligible';
  if (eligibility === 'not-eligible') return 'Not Eligible Under My Strategy';
  return 'Cannot Verify Eligibility';
}

function buildVerdictLine(summary: {
  eligibility: StrategyEligibility;
  matchGroup: StrategyMatchGroupId;
  preferenceDeviations: PreferenceDeviation[];
  eligibilityHardPassed: number;
  eligibilityHardTotal: number;
  prefPassed: number;
  prefAssessed: number;
  prefTotal: number;
  invalidMarketData: boolean;
}): string {
  if (summary.invalidMarketData) {
    return 'Invalid or inconsistent market data — excluded from verified strategy comparisons.';
  }
  if (summary.eligibility === 'not-eligible') {
    const hardCost = summary.preferenceDeviations.find((d) => d.id === 'ideal-cost');
    return `Not Eligible Under My Strategy — at least one configured hard requirement failed. Hard rules ${summary.eligibilityHardPassed}/${summary.eligibilityHardTotal}.`;
  }
  if (summary.eligibility === 'cannot-verify') {
    return 'Cannot Verify Eligibility — a required hard measurement is missing or incompatible (missing is not a pass or fail).';
  }
  const misses = summary.preferenceDeviations.filter((d) => d.status === 'missed');
  const unassessed = summary.preferenceDeviations.filter((d) => d.status === 'notAssessed');
  const hardPart = `Hard rules ${summary.eligibilityHardPassed}/${summary.eligibilityHardTotal} passed.`;
  const prefPart = `Preferences ${summary.prefPassed} of ${summary.prefAssessed} assessed passed (${summary.prefTotal} configured).`;
  if (misses.length === 0 && unassessed.length === 0) {
    return `${hardPart} All assessed preferences met.`;
  }
  const missText = misses.map((m) => m.magnitudeLabel).join(' ');
  const missingText =
    unassessed.length > 0 ? ` ${unassessed.length} preference measurement(s) not assessed.` : '';
  return `${hardPart} ${prefPart} ${missText}${missingText}`.trim();
}

/** Build display-only Core Plan Fit + factual eligibility summary. */
export function buildPlanFitSummary(candidate: FinderCandidate, profile: StrategyProfile): PlanFitSummary {
  const rows = buildStrategyFitRows(candidate, profile);
  const checks = pickCoreChecks(rows);
  const extraHard = buildEligibilityExtraHardChecks(rows, candidate, profile);
  const coreHard = checks.filter((c) => c.kind === 'hard');
  const eligibilityHardChecks = [...coreHard, ...extraHard];
  const preferenceDeviations = buildPreferenceDeviations(candidate, profile, checks);

  let passedCount = 0;
  let failedCount = 0;
  let notAssessedCount = 0;
  let hardPassed = 0;
  let hardAssessed = 0;
  let hardFailed = 0;
  let prefPassed = 0;
  let prefAssessed = 0;
  let prefFailed = 0;

  for (const check of checks) {
    if (check.result === 'passed') {
      passedCount += 1;
      if (check.kind === 'hard') {
        hardPassed += 1;
        hardAssessed += 1;
      } else {
        prefPassed += 1;
        prefAssessed += 1;
      }
    } else if (check.result === 'failed') {
      failedCount += 1;
      if (check.kind === 'hard') {
        hardFailed += 1;
        hardAssessed += 1;
      } else {
        prefFailed += 1;
        prefAssessed += 1;
      }
    } else {
      notAssessedCount += 1;
    }
  }

  let eligibilityHardPassed = 0;
  let eligibilityHardAssessed = 0;
  let eligibilityHardFailed = 0;
  for (const check of eligibilityHardChecks) {
    if (check.result === 'passed') {
      eligibilityHardPassed += 1;
      eligibilityHardAssessed += 1;
    } else if (check.result === 'failed') {
      eligibilityHardFailed += 1;
      eligibilityHardAssessed += 1;
    }
  }
  const eligibilityHardTotal = eligibilityHardChecks.length;

  const prefMissed = preferenceDeviations.filter((d) => d.status === 'missed').length;
  const prefNotAssessed = preferenceDeviations.filter((d) => d.status === 'notAssessed').length;
  const prefMet = preferenceDeviations.filter((d) => d.status === 'met').length;
  const prefTotal = preferenceDeviations.length;

  const invalidMarketData = hasRejectOrInconsistent(candidate);
  const eligibility = computeEligibility({
    invalidMarketData,
    eligibilityHardFailed,
    eligibilityHardAssessed,
    eligibilityHardTotal,
  });
  const matchGroup = computeMatchGroup({
    invalidMarketData,
    eligibility,
    prefMissed,
    prefNotAssessed,
  });

  const assessedCount = passedCount + failedCount;
  const tier = tierFromGroup(matchGroup, prefMissed);
  const tierLabel =
    matchGroup === 'invalid-data'
      ? 'Invalid Data'
      : matchGroup === 'outside-strategy'
        ? 'Not Eligible'
        : matchGroup === 'cannot-verify'
          ? 'Cannot Verify'
          : matchGroup === 'eligible-all-prefs-met'
            ? 'All Preferences Met'
            : 'Preference Differences';

  const eligibilityLabel = eligibilityLabelFor(eligibility);
  const beginnerOutcomeLabel = STRATEGY_MATCH_GROUP_LABELS[matchGroup];

  const scoreLabel = `Core Plan Fit: ${passedCount}/6`;
  const assessedDetailLabel =
    notAssessedCount > 0
      ? `${passedCount} of ${assessedCount} assessed checklist items passed · ${notAssessedCount} not assessed`
      : `${passedCount} of 6 checklist items passed`;

  const extraHardFailed = eligibilityHardFailed > 0 && extraHard.some((c) => c.result === 'failed');
  const extraConfiguredMiss = extraHard.some((c) => c.result === 'failed');

  const draft: PlanFitSummary = {
    metricName: 'Core Plan Fit',
    checks,
    extraChecks: extraHard,
    eligibilityHardChecks,
    preferenceDeviations,
    passedCount,
    failedCount,
    notAssessedCount,
    assessedCount,
    hardPassed,
    hardAssessed,
    hardFailed,
    eligibilityHardPassed,
    eligibilityHardTotal,
    eligibilityHardAssessed,
    eligibilityHardFailed,
    prefPassed: prefMet,
    prefAssessed: prefMet + prefMissed,
    prefFailed: prefMissed,
    prefTotal,
    ringSegments: {
      passed: passedCount,
      failed: failedCount,
      notAssessed: notAssessedCount,
    },
    scoreLabel,
    assessedDetailLabel,
    hardLabel: `Hard Rules: ${eligibilityHardPassed}/${eligibilityHardTotal}`,
    preferenceLabel: `Preferences: ${prefMet}/${prefMet + prefMissed} assessed (${prefNotAssessed} unassessed)`,
    eligibility,
    eligibilityLabel,
    matchGroup,
    matchGroupLabel: STRATEGY_MATCH_GROUP_LABELS[matchGroup],
    tier,
    tierLabel,
    beginnerOutcomeLabel,
    verdictLine: '',
    overallStrategyVerdict: '',
    whyRanksHere: [],
    dataConfidenceLabel: dataConfidenceLabel(candidate),
    executionQualityLabel: executionQualityLabel(candidate),
    strategyFitLabel: `${eligibilityLabel} · ${scoreLabel}`,
    extraHardFailed,
    extraConfiguredMiss,
    notEnoughData: eligibility === 'cannot-verify' || matchGroup === 'cannot-verify',
    invalidMarketData,
    rankingScopeNote: PLAN_FIT_RANKING_SCOPE_NOTE,
    checklistDisclaimer:
      'Core Plan Fit is a checklist visualization of six display checks — not an investment rating or probability of profit.',
  };

  draft.beginnerOutcomeLabel = BEGINNER_DISCOVERY_GROUP_LABELS[beginnerDiscoveryGroup(draft)];
  draft.verdictLine = buildVerdictLine(draft);
  draft.overallStrategyVerdict = [
    draft.eligibilityLabel,
    draft.hardLabel,
    draft.preferenceLabel,
    `Data: ${draft.dataConfidenceLabel}`,
    `Execution: ${draft.executionQualityLabel}`,
    PLAN_FIT_RANKING_SCOPE_NOTE,
  ].join(' · ');
  draft.whyRanksHere = buildWhyInGroup(draft, candidate);
  return draft;
}

function buildWhyInGroup(summary: PlanFitSummary, candidate: FinderCandidate): string[] {
  const bullets: string[] = [];
  bullets.push(summary.matchGroupLabel);
  bullets.push(summary.hardLabel);
  bullets.push(summary.preferenceLabel);
  for (const miss of summary.preferenceDeviations.filter((d) => d.status === 'missed')) {
    bullets.push(miss.magnitudeLabel);
  }
  for (const open of summary.preferenceDeviations.filter((d) => d.status === 'notAssessed')) {
    bullets.push(`${open.label}: not assessed.`);
  }
  if (summary.eligibility === 'not-eligible') {
    for (const check of summary.eligibilityHardChecks.filter((c) => c.result === 'failed').slice(0, 2)) {
      bullets.push(`Hard fail: ${check.requirement} (${check.thisContract} vs ${check.yourTarget}).`);
    }
  }
  bullets.push(`Data confidence: ${summary.dataConfidenceLabel}. Execution: ${summary.executionQualityLabel}.`);
  bullets.push(PLAN_FIT_RANKING_SCOPE_NOTE);
  return bullets.slice(0, 7);
}

function sortValue(
  candidate: FinderCandidate,
  profile: StrategyProfile,
  metric: FactualSortMetric,
): number | null {
  if (metric === 'purchaseCost') return num(candidate.calculations.estimatedPurchaseCost);
  if (metric === 'preferred-cost-distance') {
    const cost = num(candidate.calculations.estimatedPurchaseCost);
    const ideal = num(profile.preferences.idealContractCost);
    if (cost == null || ideal == null || ideal === 0) return null;
    // Favorable (at/under ideal) sorts as 0 distance; overages use % above ideal.
    return cost <= ideal ? 0 : ((cost - ideal) / ideal) * 100;
  }
  if (metric === 'delta') {
    return candidate.greekVerification === 'aligned' ? num(candidate.delta) : null;
  }
  if (metric === 'intrinsicPercent') return num(candidate.calculations.intrinsicPercent);
  if (metric === 'extrinsicValue') return num(candidate.calculations.extrinsicValue);
  if (metric === 'dte') return candidate.calculations.daysToExpiration;
  if (metric === 'bidAskSpread') return num(candidate.calculations.bidAskSpreadPercent);
  return null;
}

function lowerIsBetter(metric: FactualSortMetric): boolean {
  return (
    metric === 'purchaseCost' ||
    metric === 'preferred-cost-distance' ||
    metric === 'extrinsicValue' ||
    metric === 'bidAskSpread'
  );
}

/** Sort within a list by one factual metric; nulls last; stable by id. */
export function sortCandidatesByFactualMetric(
  candidates: readonly FinderCandidate[],
  profile: StrategyProfile,
  metric: FactualSortMetric,
  direction?: 'higher' | 'lower',
): FinderCandidate[] {
  const lower = direction != null ? direction === 'lower' : lowerIsBetter(metric);
  return [...candidates].sort((a, b) => {
    const av = sortValue(a, profile, metric);
    const bv = sortValue(b, profile, metric);
    if (av == null && bv == null) return a.id.localeCompare(b.id);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return lower ? av - bv : bv - av;
    return a.id.localeCompare(b.id);
  });
}

export const BEGINNER_DISCOVERY_GROUPS = [
  'best-matches',
  'near-matches',
  'need-more-data',
  'outside-plan',
  'invalid-quotes',
] as const;

export type BeginnerDiscoveryGroup = (typeof BEGINNER_DISCOVERY_GROUPS)[number];

export const BEGINNER_DISCOVERY_GROUP_LABELS: Record<BeginnerDiscoveryGroup, string> = {
  'best-matches': 'Best Matches',
  'near-matches': 'Near Matches',
  'need-more-data': 'Need More Data',
  'outside-plan': 'Outside My Plan',
  'invalid-quotes': 'Invalid/Inconsistent Quotes',
};

const BEGINNER_LIQUIDITY_PREFERENCE_IDS = new Set(['spread', 'open-interest', 'volume']);
const BEGINNER_EXTRA_HARD_IDS = new Set(['min-contract-cost', 'max-expiration']);

/**
 * Beginner filter over an existing plan-fit summary.
 * Does not change classifyLongCall or the stored match group.
 * A configured rule that was not assessed is Need More Data, even when every assessed rule passed.
 * Configured spread, open interest, and volume stay preferences, matching the saved profile.
 */
export function beginnerDiscoveryGroup(summary: PlanFitSummary): BeginnerDiscoveryGroup {
  if (summary.invalidMarketData) return 'invalid-quotes';
  const hard = [
    ...summary.checks.filter((check) => check.kind === 'hard'),
    ...summary.extraChecks.filter((check) => BEGINNER_EXTRA_HARD_IDS.has(check.id)),
  ];
  const preferences = [
    ...summary.preferenceDeviations.map((deviation) => ({
      result:
        deviation.status === 'met' ? ('passed' as const) : deviation.status === 'missed' ? ('failed' as const) : ('notAssessed' as const),
    })),
    ...summary.extraChecks.filter((check) => BEGINNER_LIQUIDITY_PREFERENCE_IDS.has(check.id)),
  ];
  if (hard.some((check) => check.result === 'failed')) return 'outside-plan';
  if (hard.some((check) => check.result === 'notAssessed') || preferences.some((check) => check.result === 'notAssessed')) {
    return 'need-more-data';
  }
  if (preferences.some((check) => check.result === 'failed')) return 'near-matches';
  return 'best-matches';
}

export function beginnerDiscoveryGroupForCandidate(
  candidate: FinderCandidate,
  profile: StrategyProfile,
): BeginnerDiscoveryGroup {
  return beginnerDiscoveryGroup(buildPlanFitSummary(candidate, profile));
}

/** Group evaluated contracts for the Matches to My Strategy view. */
export function groupCandidatesForStrategyMatch(
  candidates: readonly FinderCandidate[],
  profile: StrategyProfile,
  sortMetric: FactualSortMetric = 'purchaseCost',
): StrategyMatchGroup[] {
  const buckets = new Map<StrategyMatchGroupId, FinderCandidate[]>();
  for (const id of STRATEGY_MATCH_GROUP_ORDER) buckets.set(id, []);

  for (const candidate of candidates) {
    const fit = buildPlanFitSummary(candidate, profile);
    buckets.get(fit.matchGroup)!.push(candidate);
  }

  return STRATEGY_MATCH_GROUP_ORDER.map((id) => ({
    id,
    label: STRATEGY_MATCH_GROUP_LABELS[id],
    candidates: sortCandidatesByFactualMetric(buckets.get(id) ?? [], profile, sortMetric),
  })).filter((group) => group.candidates.length > 0);
}

/**
 * Flatten Matches-to-Strategy groups (A→E). Not an invented overall quality ranking —
 * order is group membership, then the selected factual metric within each group.
 */
export function rankCandidatesForBeginner(
  candidates: readonly FinderCandidate[],
  profile: StrategyProfile,
  sortMetric: FactualSortMetric = 'purchaseCost',
): FinderCandidate[] {
  return groupCandidatesForStrategyMatch(candidates, profile, sortMetric).flatMap((g) => g.candidates);
}

/** Preference magnitude for a selected focus metric (never cross-unit "biggest"). */
export function focusPreferenceDeviation(
  summary: PlanFitSummary,
  focus: FactualSortMetric,
): PreferenceDeviation | null {
  if (focus === 'purchaseCost' || focus === 'preferred-cost-distance') {
    return summary.preferenceDeviations.find((d) => d.id === 'ideal-cost') ?? null;
  }
  if (focus === 'delta') {
    return summary.preferenceDeviations.find((d) => d.id === 'preferred-delta') ?? null;
  }
  if (focus === 'intrinsicPercent') {
    return summary.preferenceDeviations.find((d) => d.id === 'intrinsic') ?? null;
  }
  return null;
}

/** Pareto-efficient among eligible candidates with complete cost+delta+intrinsic. */
export function markParetoEfficientEligible(
  candidates: readonly FinderCandidate[],
  profile: StrategyProfile,
): Set<string> {
  const eligible = candidates.filter((c) => {
    const fit = buildPlanFitSummary(c, profile);
    if (fit.eligibility !== 'eligible' || fit.invalidMarketData) return false;
    const cost = num(c.calculations.estimatedPurchaseCost);
    const delta = c.greekVerification === 'aligned' ? num(c.delta) : null;
    const intrinsic = num(c.calculations.intrinsicPercent);
    return cost != null && delta != null && intrinsic != null;
  });

  const efficient = new Set<string>();
  for (const a of eligible) {
    const aCost = num(a.calculations.estimatedPurchaseCost)!;
    const aDelta = num(a.delta)!;
    const aIntr = num(a.calculations.intrinsicPercent)!;
    const dominated = eligible.some((b) => {
      if (a.id === b.id) return false;
      const bCost = num(b.calculations.estimatedPurchaseCost)!;
      const bDelta = num(b.delta)!;
      const bIntr = num(b.calculations.intrinsicPercent)!;
      const betterOrEqual =
        bCost <= aCost && bDelta >= aDelta && bIntr >= aIntr;
      const strictlyBetter = bCost < aCost || bDelta > aDelta || bIntr > aIntr;
      return betterOrEqual && strictlyBetter;
    });
    if (!dominated) efficient.add(a.id);
  }
  return efficient;
}

/** Factual badges within the evaluated set only. */
export function assignRankingBadges(
  candidates: readonly FinderCandidate[],
  profile: StrategyProfile,
): Map<string, PlanFitRankingBadge[]> {
  const map = new Map<string, PlanFitRankingBadge[]>();
  if (candidates.length === 0) return map;

  const push = (id: string, badge: PlanFitRankingBadge) => {
    const list = map.get(id) ?? [];
    if (!list.includes(badge)) list.push(badge);
    map.set(id, list);
  };

  const scored = candidates.map((candidate) => ({
    candidate,
    fit: buildPlanFitSummary(candidate, profile),
  }));

  for (const row of scored) {
    if (row.fit.eligibility === 'eligible') {
      push(row.candidate.id, 'Meets All Hard Requirements');
    }
    if (row.fit.matchGroup === 'eligible-all-prefs-met') {
      push(row.candidate.id, 'All Preferred Targets Met');
    }
  }

  const comparable = scored.filter((row) => !row.fit.invalidMarketData);

  const pick = (
    read: (row: (typeof scored)[number]) => number | null,
    lowerBetter: boolean,
    badge: PlanFitRankingBadge,
  ) => {
    let best: (typeof scored)[number] | null = null;
    let bestValue: number | null = null;
    for (const row of comparable) {
      const value = read(row);
      if (value == null) continue;
      if (bestValue == null || (lowerBetter ? value < bestValue : value > bestValue)) {
        best = row;
        bestValue = value;
      }
    }
    if (best) push(best.candidate.id, badge);
  };

  pick((row) => num(row.candidate.calculations.estimatedPurchaseCost), true, 'Lowest Cost Among Evaluated');
  pick(
    (row) => (row.candidate.greekVerification === 'aligned' ? num(row.candidate.delta) : null),
    false,
    'Highest Delta Among Evaluated',
  );
  pick((row) => num(row.candidate.calculations.intrinsicPercent), false, 'Highest Intrinsic % Among Evaluated');

  return map;
}

/** Side-by-side factual tradeoff explanation (no winner declaration). */
export function explainContractTradeoff(
  left: FinderCandidate,
  right: FinderCandidate,
  profile: StrategyProfile,
): string {
  const leftFit = buildPlanFitSummary(left, profile);
  const rightFit = buildPlanFitSummary(right, profile);
  if (leftFit.invalidMarketData || rightFit.invalidMarketData) {
    return 'Cannot compare: at least one contract has invalid or inconsistent market data.';
  }
  if (
    left.greekVerification !== 'aligned' ||
    right.greekVerification !== 'aligned'
  ) {
    // Still allow cost/intrinsic if present; note Greek caveat.
  }

  const leftName = `${left.underlying}`;
  const rightName = `${right.underlying}`;
  const clauses: string[] = [];

  const lCost = num(left.calculations.estimatedPurchaseCost);
  const rCost = num(right.calculations.estimatedPurchaseCost);
  if (lCost != null && rCost != null && rCost !== lCost) {
    const diff = rCost - lCost;
    clauses.push(
      `${rightName} costs ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${leftName}`,
    );
  }

  const lDelta = left.greekVerification === 'aligned' ? num(left.delta) : null;
  const rDelta = right.greekVerification === 'aligned' ? num(right.delta) : null;
  if (lDelta != null && rDelta != null && rDelta !== lDelta) {
    const diff = rDelta - lDelta;
    clauses.push(
      `${Math.abs(diff).toFixed(4)} ${diff > 0 ? 'higher' : 'lower'} delta`,
    );
  } else if (lDelta == null || rDelta == null) {
    clauses.push('delta not fully comparable (missing or unverified Greeks)');
  }

  const lIntr = num(left.calculations.intrinsicPercent);
  const rIntr = num(right.calculations.intrinsicPercent);
  if (lIntr != null && rIntr != null && rIntr !== lIntr) {
    const diff = rIntr - lIntr;
    clauses.push(
      `${Math.abs(diff).toFixed(1)} ${diff > 0 ? 'additional' : 'fewer'} intrinsic percentage points`,
    );
  }

  if (clauses.length === 0) {
    return 'No material measured differences among cost, delta, and intrinsic % on comparable fields.';
  }

  const head = clauses[0]!;
  const rest = clauses.slice(1);
  const body =
    rest.length === 0
      ? head
      : `${head}, but has ${rest.join(' and ')}`;
  return `${body}. This is a factual tradeoff — not a recommendation of which contract is better.`;
}

export function buildPlanFitSummaryWithPeers(
  candidate: FinderCandidate,
  profile: StrategyProfile,
  peers: readonly FinderCandidate[],
): PlanFitSummary {
  const summary = buildPlanFitSummary(candidate, profile);
  if (peers.length >= 2) {
    const sorted = peers.filter((p) => p.id !== candidate.id);
    const other = sorted[0];
    if (other) {
      summary.whyRanksHere = [
        explainContractTradeoff(candidate, other, profile),
        ...summary.whyRanksHere,
      ].slice(0, 7);
    }
  }
  return summary;
}

/** Plain-language beginner summary for the review panel. */
export function buildBeginnerContractSummary(
  candidate: FinderCandidate,
  profile: StrategyProfile,
): BeginnerContractSummary {
  const fit = buildPlanFitSummary(candidate, profile);
  const cost = candidate.calculations.estimatedPurchaseCost;
  const dte = candidate.calculations.daysToExpiration;
  const strike = Number(candidate.strike);

  const whatItIs = [
    `${candidate.underlying} $${Number.isFinite(strike) ? strike.toFixed(0) : candidate.strike} call expiring ${candidate.expiration}.`,
    cost != null
      ? `About $${Number(cost).toLocaleString('en-US')} at the displayed ask for one contract (×${candidate.multiplier}), before fees.`
      : 'Purchase cost could not be estimated from the ask.',
    dte != null ? `About ${dte} days remain until expiration.` : 'Days to expiration were unavailable.',
  ].join(' ');

  const whyMayFit: string[] = [];
  for (const check of fit.eligibilityHardChecks) {
    if (check.result === 'passed') {
      whyMayFit.push(`${check.requirement}: ${check.thisContract} meets ${check.yourTarget}.`);
    }
  }
  for (const pref of fit.preferenceDeviations) {
    if (pref.status === 'met') whyMayFit.push(pref.magnitudeLabel);
  }
  if (whyMayFit.length === 0) {
    whyMayFit.push('No assessed hard rules or preferences passed yet.');
  }

  const cautions: string[] = [];
  if (fit.invalidMarketData) {
    cautions.push('Invalid or inconsistent market data — not used for verified comparisons.');
  }
  if (fit.eligibility === 'not-eligible') {
    cautions.push('Not Eligible Under My Strategy — at least one configured hard requirement failed.');
  }
  if (fit.eligibility === 'cannot-verify') {
    cautions.push('Cannot Verify Eligibility — required hard measurements are missing or incompatible.');
  }
  for (const pref of fit.preferenceDeviations) {
    if (pref.status === 'missed') cautions.push(pref.magnitudeLabel);
    if (pref.status === 'notAssessed') cautions.push(`${pref.label} not assessed.`);
  }
  if (fit.dataConfidenceLabel !== 'Live') {
    cautions.push(`Observation confidence is ${fit.dataConfidenceLabel}, not a verified live fill.`);
  }
  if (fit.executionQualityLabel === 'Wide Spread') {
    cautions.push('Bid/ask spread looks wide — trading friction may be higher.');
  }
  cautions.push(
    'Core Plan Fit is a checklist only. Matching your rules is not a buy recommendation. A long call can lose its entire premium.',
  );

  return {
    whatItIs,
    whyMayFit: whyMayFit.slice(0, 5),
    cautions: cautions.slice(0, 8),
  };
}

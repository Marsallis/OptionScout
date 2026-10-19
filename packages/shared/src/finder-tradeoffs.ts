/**
 * Numerical tradeoff explorer for evaluated Finder candidates.
 * Does not edit saved strategy profiles or produce buy recommendations.
 */

export type TradeoffCriterion =
  | 'best-within-budget'
  | 'highest-delta'
  | 'highest-intrinsic-percent'
  | 'lowest-extrinsic'
  | 'tightest-spread'
  | 'longest-expiration'
  | 'best-downside-moneyness';

export const TRADEOFF_CRITERION_LABELS: Record<TradeoffCriterion, string> = {
  'best-within-budget': 'Best within budget (ask cost)',
  'highest-delta': 'Highest available delta',
  'highest-intrinsic-percent': 'Highest intrinsic %',
  'lowest-extrinsic': 'Lowest extrinsic premium',
  'tightest-spread': 'Tightest valid bid/ask spread',
  'longest-expiration': 'Longest expiration',
  'best-downside-moneyness': 'Best downside moneyness',
};

export interface TradeoffCandidateView {
  id: string;
  label: string;
  outcome: string;
  askCost: number | null;
  delta: number | null;
  intrinsicPercent: number | null;
  extrinsicPerShare: number | null;
  spreadPercent: number | null;
  daysToExpiration: number | null;
  downsideMoneyness: number | null;
  crossedOrInvalidSpread: boolean;
  missingGreeks: boolean;
}

export interface TradeoffFilterDraft {
  maxContractCost: number | null;
  minLongDelta: number | null;
}

export interface TradeoffConflict {
  code: string;
  text: string;
}

export interface TradeoffExplorerResult {
  ranked: TradeoffCandidateView[];
  conflicts: TradeoffConflict[];
  matchedCount: number;
  evaluatedCount: number;
}

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function toTradeoffView(candidate: {
  id: string;
  label: string;
  outcome: string;
  delta: string | null;
  flags: { crossedMarket: boolean; invalidPrice: boolean; missingGreeks: boolean };
  calculations: {
    estimatedPurchaseCost: string | null;
    intrinsicPercent: string | null;
    extrinsicValue: string | null;
    bidAskSpreadPercent: string | null;
    daysToExpiration: number | null;
    downsideMoneyness15: string | null;
  };
}): TradeoffCandidateView {
  const spread = num(candidate.calculations.bidAskSpreadPercent);
  return {
    id: candidate.id,
    label: candidate.label,
    outcome: candidate.outcome,
    askCost: num(candidate.calculations.estimatedPurchaseCost),
    delta: num(candidate.delta),
    intrinsicPercent: num(candidate.calculations.intrinsicPercent),
    extrinsicPerShare: num(candidate.calculations.extrinsicValue),
    spreadPercent: spread != null && spread >= 0 ? spread : null,
    daysToExpiration: candidate.calculations.daysToExpiration,
    downsideMoneyness: num(candidate.calculations.downsideMoneyness15),
    crossedOrInvalidSpread: candidate.flags.crossedMarket || candidate.flags.invalidPrice || (spread != null && spread < 0),
    missingGreeks: candidate.flags.missingGreeks,
  };
}

function passesDraft(row: TradeoffCandidateView, draft: TradeoffFilterDraft): boolean {
  if (draft.maxContractCost != null) {
    if (row.askCost == null || row.askCost > draft.maxContractCost) return false;
  }
  if (draft.minLongDelta != null) {
    if (row.delta == null || row.delta < draft.minLongDelta) return false;
  }
  return true;
}

function compareBy(criterion: TradeoffCriterion, left: TradeoffCandidateView, right: TradeoffCandidateView): number {
  const pick = (row: TradeoffCandidateView): number | null => {
    switch (criterion) {
      case 'best-within-budget':
        return row.askCost;
      case 'highest-delta':
        return row.delta;
      case 'highest-intrinsic-percent':
        return row.intrinsicPercent;
      case 'lowest-extrinsic':
        return row.extrinsicPerShare;
      case 'tightest-spread':
        return row.crossedOrInvalidSpread ? null : row.spreadPercent;
      case 'longest-expiration':
        return row.daysToExpiration;
      case 'best-downside-moneyness':
        return row.downsideMoneyness;
      default:
        return null;
    }
  };
  const a = pick(left);
  const b = pick(right);
  if (a == null && b == null) return left.id.localeCompare(right.id);
  if (a == null) return 1;
  if (b == null) return -1;
  const lowerBetter =
    criterion === 'best-within-budget' || criterion === 'lowest-extrinsic' || criterion === 'tightest-spread';
  const comparison = lowerBetter ? a - b : b - a;
  return comparison === 0 ? left.id.localeCompare(right.id) : comparison;
}

export function exploreTradeoffs(
  candidates: readonly TradeoffCandidateView[],
  criteria: readonly TradeoffCriterion[],
  draft: TradeoffFilterDraft,
  options?: { remainingUnevaluated?: number; hardMaxBudget?: number; hardMinDelta?: number },
): TradeoffExplorerResult {
  const usable = candidates.filter((row) => row.outcome !== 'incomplete');
  const matched = usable.filter((row) => passesDraft(row, draft));
  const primary = criteria[0] ?? 'best-within-budget';
  const ranked = [...matched].sort((left, right) => {
    for (const criterion of criteria.length > 0 ? criteria : [primary]) {
      const comparison = compareBy(criterion, left, right);
      if (comparison !== 0) return comparison;
    }
    return left.id.localeCompare(right.id);
  });

  const conflicts: TradeoffConflict[] = [];
  const hardMax = options?.hardMaxBudget ?? 7000;
  const hardMinDelta = options?.hardMinDelta ?? 0.75;
  const remaining = options?.remainingUnevaluated ?? 0;

  const inBudget = usable.filter((row) => row.askCost != null && row.askCost <= hardMax);
  const withDelta = usable.filter((row) => row.delta != null && row.delta >= hardMinDelta);
  const both = usable.filter(
    (row) => row.askCost != null && row.askCost <= hardMax && row.delta != null && row.delta >= hardMinDelta,
  );

  if (usable.length > 0 && both.length === 0 && inBudget.length > 0 && withDelta.length > 0) {
    conflicts.push({
      code: 'budget-delta-conflict',
      text: `No evaluated contract meets both the $${hardMax.toLocaleString('en-US')} budget and the ${hardMinDelta} minimum delta. More contracts remain unexamined.`
        .replace('More contracts remain unexamined.', remaining > 0 ? `${remaining} contracts remain unexamined.` : 'No further eligible contracts remain in this scan.'),
    });
  } else if (usable.length > 0 && inBudget.length === 0) {
    conflicts.push({
      code: 'none-in-budget-among-evaluated',
      text:
        remaining > 0
          ? `No evaluated contract is within the $${hardMax.toLocaleString('en-US')} hard maximum. ${remaining} eligible contracts remain unexamined.`
          : `No evaluated contract is within the $${hardMax.toLocaleString('en-US')} hard maximum among the examined set.`,
    });
  }

  if (draft.maxContractCost != null && draft.minLongDelta != null && matched.length === 0 && usable.length > 0) {
    conflicts.push({
      code: 'explorer-filter-empty',
      text: `No evaluated contract matches the explorer draft (max cost $${draft.maxContractCost.toLocaleString('en-US')}, min delta ${draft.minLongDelta}). This does not change the saved strategy profile.`,
    });
  }

  const missingGreeks = candidates.filter((row) => row.missingGreeks).length;
  if (missingGreeks > 0 && missingGreeks >= Math.ceil(candidates.length * 0.5)) {
    conflicts.push({
      code: 'missing-greeks-common',
      text: `${missingGreeks} of ${candidates.length} evaluated rows are missing provider Greeks. Missing deltas stay null and incomplete — they are not fabricated.`,
    });
  }

  return {
    ranked,
    conflicts,
    matchedCount: matched.length,
    evaluatedCount: candidates.length,
  };
}

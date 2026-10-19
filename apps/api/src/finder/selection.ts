import type { ScanMorePriority } from '@optionscout/shared';
import type { NestedChainContract } from './chain.js';

export interface SelectionBudgets {
  /** Preferred capital target in dollars (e.g. 6000). */
  idealCost: number;
  /** Hard maximum capital in dollars (e.g. 7000). */
  hardMaxCost: number;
  /** Hard minimum delta from the saved strategy (search preference only until quotes arrive). */
  minDelta?: number;
  /** Preferred delta from the saved strategy. */
  preferredDelta?: number;
  /** Preferred expiration days. */
  preferredExpirationDays?: number;
  minLeapsDays?: number;
  maxLeapsDays?: number | null;
}

export type PreselectionBand = 'near-ideal' | 'under-ideal' | 'just-over' | 'deep-over' | 'low-intrinsic' | 'representative';

export interface RankedCandidate {
  contract: NestedChainContract;
  band: PreselectionBand;
  /** Intrinsic-only floor = max(stock−strike,0) × multiplier. Prioritization only — never actual purchase cost. */
  estimatedFloorCost: number;
  /** Optional adaptive estimate = floor + observed extrinsic hint × multiplier. Never displayed as a price. */
  estimatedAskCostHint: number | null;
  distanceToIdeal: number;
  daysToExpiration: number;
}

export interface ObservedAskCost {
  occSymbol: string;
  expiration: string;
  strike: number;
  intrinsicFloor: number;
  /** Actual ask × multiplier from a provider quote. */
  askCost: number;
  /** ask − intrinsic per share (actual). */
  extrinsicPerShare: number;
  delta?: number | null;
  intrinsicPercent?: number | null;
}

export interface SelectionPlan {
  /** Full deterministic queue of eligible LEAPS (or all supported calls if none). Not truncated. */
  queue: NestedChainContract[];
  ranked: RankedCandidate[];
  eligibleCount: number;
  algorithm: string;
  expirationsEligible: number;
  priority: ScanMorePriority;
}

export interface OrderCandidatesInput {
  contracts: readonly NestedChainContract[];
  stockPrice: string | null;
  budgets: SelectionBudgets;
  /** Same priority for Start Search and Scan More. */
  priority: ScanMorePriority;
  /** When present (Scan More / mid-scan reprioritize), refine hints from actual asks. */
  observations?: readonly ObservedAskCost[];
  /** Already-evaluated OCC symbols stay out of the ordered remainder but remain in the universe. */
  alreadyEvaluated?: ReadonlySet<string>;
}

const ALGORITHM_BASE =
  'Unified candidate-selection engine (Start Search and Scan More). ' +
  'Search preferences only decide evaluation order; hard/preferred rules classify after quotes; ' +
  'display filters never reorder this queue. ' +
  'Stage A: deterministic priority ordering across expirations and moneyness with optional observed-extrinsic hints. ' +
  'Stage B: real ask×multiplier from provider quotes. ' +
  'Hints are never shown as prices. Every eligible supported LEAPS stays in the universe.';

function daysOf(contract: NestedChainContract): number {
  if (contract.daysToExpiration != null) return contract.daysToExpiration;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contract.expiration)) return 0;
  const today = new Date();
  const asOf = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const end = Date.UTC(
    Number(contract.expiration.slice(0, 4)),
    Number(contract.expiration.slice(5, 7)) - 1,
    Number(contract.expiration.slice(8, 10)),
  );
  return Math.round((end - asOf) / 86_400_000);
}

export function floorCost(stockPrice: number, contract: NestedChainContract): number {
  const intrinsic = Math.max(stockPrice - Number(contract.strike), 0);
  return Math.round(intrinsic * contract.multiplier * 100) / 100;
}

function classifyFloorBand(floor: number, ideal: number, hardMax: number): PreselectionBand {
  const nearLow = ideal * 0.75;
  if (floor >= nearLow && floor <= hardMax) return 'near-ideal';
  if (floor > hardMax && floor <= hardMax * 1.25) return 'just-over';
  if (floor > hardMax * 1.25) return 'deep-over';
  if (floor >= ideal * 0.4 && floor < nearLow) return 'under-ideal';
  return 'low-intrinsic';
}

function eligiblePool(contracts: readonly NestedChainContract[], minDays: number, maxDays: number | null | undefined): NestedChainContract[] {
  const eligible = contracts.filter(
    (row) => row.optionType === 'call' && row.supportStatus === 'supported' && row.streamerSymbol,
  );
  const leaps = eligible.filter((row) => {
    const dte = daysOf(row);
    if (dte < minDays) return false;
    if (maxDays != null && dte > maxDays) return false;
    return true;
  });
  return leaps.length > 0 ? leaps : eligible;
}

function pickIndices(length: number, fractions: readonly number[]): number[] {
  if (length <= 0) return [];
  const picks = new Set<number>();
  for (const fraction of fractions) {
    picks.add(Math.min(length - 1, Math.max(0, Math.round((length - 1) * fraction))));
  }
  return [...picks].sort((a, b) => a - b);
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function observationMaps(observations: readonly ObservedAskCost[]): {
  medianExtrinsicByExpiration: Record<string, number>;
  globalMedianExtrinsic: number | null;
  byOcc: Map<string, ObservedAskCost>;
} {
  const extrinsicByExpiration = new Map<string, number[]>();
  const byOcc = new Map<string, ObservedAskCost>();
  for (const row of observations) {
    byOcc.set(row.occSymbol, row);
    if (!Number.isFinite(row.extrinsicPerShare) || row.extrinsicPerShare < 0) continue;
    const list = extrinsicByExpiration.get(row.expiration) ?? [];
    list.push(row.extrinsicPerShare);
    extrinsicByExpiration.set(row.expiration, list);
  }
  const medianExtrinsicByExpiration: Record<string, number> = {};
  for (const [expiration, values] of extrinsicByExpiration) {
    const median = medianOf(values);
    if (median != null) medianExtrinsicByExpiration[expiration] = median;
  }
  const globalValues = observations.map((row) => row.extrinsicPerShare).filter((value) => Number.isFinite(value) && value >= 0);
  return {
    medianExtrinsicByExpiration,
    globalMedianExtrinsic: medianOf(globalValues),
    byOcc,
  };
}

interface ScoredRow {
  contract: NestedChainContract;
  hint: number | null;
  floor: number | null;
  distanceToIdeal: number;
  underHard: boolean;
  dte: number;
  strike: number;
  deeperItm: number;
  intrinsicShareHint: number;
  explorationBucket: number;
}

function scoreContract(
  contract: NestedChainContract,
  stock: number | null,
  budgets: SelectionBudgets,
  medianExtrinsicByExpiration: Record<string, number>,
  globalMedianExtrinsic: number | null,
  byOcc: Map<string, ObservedAskCost>,
): ScoredRow {
  const ideal = budgets.idealCost;
  const hardMax = budgets.hardMaxCost;
  const floor = stock == null ? null : floorCost(stock, contract);
  const observed = byOcc.get(contract.occSymbol);
  const extrinsicHint = medianExtrinsicByExpiration[contract.expiration] ?? globalMedianExtrinsic;
  const hint =
    observed != null
      ? observed.askCost
      : floor == null || extrinsicHint == null
        ? null
        : Math.round((floor / contract.multiplier + extrinsicHint) * contract.multiplier * 100) / 100;
  const distanceToIdeal =
    hint != null ? Math.abs(hint - ideal) : floor != null ? Math.abs(floor - ideal) : Number(contract.strike);
  const underHard = hint != null ? hint <= hardMax : floor != null ? floor <= hardMax : false;
  const dte = daysOf(contract);
  const strike = Number(contract.strike);
  const deeperItm = stock == null ? 0 : Math.max(0, stock - strike);
  const intrinsicShareHint =
    hint != null && hint > 0 && floor != null ? floor / hint : floor != null && stock != null ? deeperItm / Math.max(stock, 1) : 0;
  // Exploration bucket: mix expiration hash + strike percentile for diversified round-robin feel.
  const explorationBucket = (dte % 7) * 1000 + Math.round(strike * 10) % 97;
  return {
    contract,
    hint,
    floor,
    distanceToIdeal,
    underHard,
    dte,
    strike,
    deeperItm,
    intrinsicShareHint,
    explorationBucket,
  };
}

function compareByPriority(priority: ScanMorePriority, left: ScoredRow, right: ScoredRow, budgets: SelectionBudgets): number {
  const preferredDte = budgets.preferredExpirationDays ?? 365;
  switch (priority) {
    case 'within-budget': {
      if (left.underHard !== right.underHard) return left.underHard ? -1 : 1;
      if (left.distanceToIdeal !== right.distanceToIdeal) return left.distanceToIdeal - right.distanceToIdeal;
      break;
    }
    case 'higher-delta': {
      // Deeper ITM first as a pre-quote proxy; never invents delta.
      if (left.deeperItm !== right.deeperItm) return right.deeperItm - left.deeperItm;
      if (left.underHard !== right.underHard) return left.underHard ? -1 : 1;
      break;
    }
    case 'higher-intrinsic': {
      if (left.intrinsicShareHint !== right.intrinsicShareHint) return right.intrinsicShareHint - left.intrinsicShareHint;
      if (left.deeperItm !== right.deeperItm) return right.deeperItm - left.deeperItm;
      break;
    }
    case 'broader-exploration': {
      if (left.explorationBucket !== right.explorationBucket) return left.explorationBucket - right.explorationBucket;
      break;
    }
    case 'closest-to-strategy':
    default: {
      // Structural Deep-ITM fit before mere cheapness: under hard budget, then deeper ITM /
      // intrinsic-share hints, then distance to ideal cost, then preferred DTE.
      if (left.underHard !== right.underHard) return left.underHard ? -1 : 1;
      if (left.deeperItm !== right.deeperItm) return right.deeperItm - left.deeperItm;
      if (left.intrinsicShareHint !== right.intrinsicShareHint) return right.intrinsicShareHint - left.intrinsicShareHint;
      if (left.distanceToIdeal !== right.distanceToIdeal) return left.distanceToIdeal - right.distanceToIdeal;
      const leftDteGap = Math.abs(left.dte - preferredDte);
      const rightDteGap = Math.abs(right.dte - preferredDte);
      if (leftDteGap !== rightDteGap) return leftDteGap - rightDteGap;
      break;
    }
  }
  if (left.dte !== right.dte) return right.dte - left.dte;
  if (left.strike !== right.strike) return left.strike - right.strike;
  return left.contract.occSymbol.localeCompare(right.contract.occSymbol);
}

/**
 * Interleave scored contracts by expiration so one expiration cannot monopolize early batches.
 * Preserves relative priority order within each expiration.
 */
function diversifyByExpiration(scored: readonly ScoredRow[]): NestedChainContract[] {
  const byExpiration = new Map<string, ScoredRow[]>();
  for (const row of scored) {
    const list = byExpiration.get(row.contract.expiration) ?? [];
    list.push(row);
    byExpiration.set(row.contract.expiration, list);
  }
  const expirations = [...byExpiration.keys()].sort((a, b) => b.localeCompare(a));
  const cursors = new Map(expirations.map((expiration) => [expiration, 0]));
  const out: NestedChainContract[] = [];
  for (;;) {
    let progressed = false;
    for (const expiration of expirations) {
      const list = byExpiration.get(expiration)!;
      const cursor = cursors.get(expiration) ?? 0;
      if (cursor >= list.length) continue;
      out.push(list[cursor]!.contract);
      cursors.set(expiration, cursor + 1);
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}

/**
 * Unified ordering for Start Search and Scan More.
 * Never removes eligible contracts; only decides evaluation order.
 */
export function orderEligibleQueue(input: OrderCandidatesInput): SelectionPlan {
  const stock = input.stockPrice == null || !/^\d+(\.\d+)?$/.test(input.stockPrice) ? null : Number(input.stockPrice);
  const minDays = input.budgets.minLeapsDays ?? 365;
  const pool = eligiblePool(input.contracts, minDays, input.budgets.maxLeapsDays);
  const evaluated = input.alreadyEvaluated ?? new Set<string>();
  const remaining = pool.filter((row) => !evaluated.has(row.occSymbol));
  const observations = input.observations ?? [];
  const maps = observationMaps(observations);

  const scored = remaining.map((contract) =>
    scoreContract(
      contract,
      stock != null && Number.isFinite(stock) && stock > 0 ? stock : null,
      input.budgets,
      maps.medianExtrinsicByExpiration,
      maps.globalMedianExtrinsic,
      maps.byOcc,
    ),
  );
  scored.sort((left, right) => compareByPriority(input.priority, left, right, input.budgets));

  // Seed first slots with representative moneyness picks when no observations yet (initial search).
  let queue: NestedChainContract[];
  if (observations.length === 0) {
    const seeded = seedRepresentativeThenPriority(
      remaining,
      stock != null && Number.isFinite(stock) && stock > 0 ? stock : null,
      input.budgets,
      scored,
    );
    queue = seeded;
  } else {
    queue = diversifyByExpiration(scored);
  }

  const ranked: RankedCandidate[] = queue.map((contract) => {
    const floor = stock == null ? 0 : floorCost(stock, contract);
    const scoredRow = scored.find((row) => row.contract.occSymbol === contract.occSymbol);
    return {
      contract,
      band: stock == null ? 'representative' : classifyFloorBand(floor, input.budgets.idealCost, input.budgets.hardMaxCost),
      estimatedFloorCost: floor,
      estimatedAskCostHint: scoredRow?.hint ?? null,
      distanceToIdeal: scoredRow?.distanceToIdeal ?? Math.abs(floor - input.budgets.idealCost),
      daysToExpiration: daysOf(contract),
    };
  });

  const observedNote =
    observations.length > 0
      ? ` Refined with ${observations.length} observed ask(s) (hints only).`
      : ' No observed asks yet — representative + priority seed.';
  return {
    queue,
    ranked,
    eligibleCount: pool.length,
    algorithm: `${ALGORITHM_BASE} Priority: ${input.priority}.${observedNote}`,
    expirationsEligible: new Set(pool.map((row) => row.expiration)).size,
    priority: input.priority,
  };
}

function seedRepresentativeThenPriority(
  pool: readonly NestedChainContract[],
  stock: number | null,
  budgets: SelectionBudgets,
  scored: readonly ScoredRow[],
): NestedChainContract[] {
  const byExpiration = new Map<string, NestedChainContract[]>();
  for (const row of pool) {
    const list = byExpiration.get(row.expiration) ?? [];
    list.push(row);
    byExpiration.set(row.expiration, list);
  }
  const expirations = [...byExpiration.keys()].sort((a, b) => b.localeCompare(a));
  for (const expiration of expirations) {
    byExpiration.get(expiration)!.sort((a, b) => Number(a.strike) - Number(b.strike) || a.occSymbol.localeCompare(b.occSymbol));
  }

  const selected = new Set<string>();
  const head: NestedChainContract[] = [];
  const push = (contract: NestedChainContract) => {
    if (selected.has(contract.occSymbol)) return;
    selected.add(contract.occSymbol);
    head.push(contract);
  };

  for (const expiration of expirations) {
    const list = byExpiration.get(expiration)!;
    for (const index of pickIndices(list.length, [0.12, 0.3, 0.5, 0.7, 0.85, 0.95])) {
      push(list[index]!);
    }
    if (stock != null) {
      const underCap = list.filter((row) => floorCost(stock, row) <= budgets.hardMaxCost);
      if (underCap.length > 0) {
        const closest = [...underCap].sort(
          (a, b) =>
            Math.abs(floorCost(stock, a) - budgets.idealCost) - Math.abs(floorCost(stock, b) - budgets.idealCost) ||
            Number(a.strike) - Number(b.strike),
        )[0]!;
        push(closest);
      }
      const roomForExtrinsic = list.filter((row) => {
        const floor = floorCost(stock, row);
        return floor >= budgets.idealCost * 0.45 && floor <= budgets.idealCost * 0.85;
      });
      if (roomForExtrinsic.length > 0) {
        const mid = [...roomForExtrinsic].sort(
          (a, b) =>
            Math.abs(floorCost(stock, a) - budgets.idealCost * 0.7) - Math.abs(floorCost(stock, b) - budgets.idealCost * 0.7) ||
            Number(a.strike) - Number(b.strike),
        )[0]!;
        push(mid);
      }
    }
  }

  const rest = scored.map((row) => row.contract).filter((row) => !selected.has(row.occSymbol));
  return [...head, ...rest];
}

/** @deprecated Prefer orderEligibleQueue — kept as a thin wrapper for existing call sites. */
export function buildBudgetAwareQueue(
  contracts: readonly NestedChainContract[],
  stockPrice: string | null,
  budgets: SelectionBudgets,
  priority: ScanMorePriority = 'closest-to-strategy',
): SelectionPlan {
  return orderEligibleQueue({ contracts, stockPrice, budgets, priority });
}

/** @deprecated Prefer orderEligibleQueue with observations — kept for existing Scan More call sites. */
export function refineRemainingQueue(
  remaining: readonly NestedChainContract[],
  stockPrice: string | null,
  observations: readonly ObservedAskCost[],
  budgets: SelectionBudgets,
  priority: ScanMorePriority = 'within-budget',
): { queue: NestedChainContract[]; algorithmNote: string; medianExtrinsicByExpiration: Record<string, number> } {
  const plan = orderEligibleQueue({
    contracts: remaining,
    stockPrice,
    budgets,
    priority,
    observations,
  });
  const maps = observationMaps(observations);
  return {
    queue: plan.queue,
    algorithmNote: `Unified reorder (${priority}) using observed extrinsic hints (prioritization only).`,
    medianExtrinsicByExpiration: maps.medianExtrinsicByExpiration,
  };
}

export function observationsFromCandidates(
  candidates: readonly {
    occSymbol: string;
    expiration: string;
    strike: string;
    ask: string | null;
    delta: string | null;
    multiplier: number;
    underlyingPrice: string | null;
    calculations: { intrinsicValue: string | null; estimatedPurchaseCost: string | null; intrinsicPercent: string | null };
  }[],
): ObservedAskCost[] {
  const out: ObservedAskCost[] = [];
  for (const row of candidates) {
    if (row.ask == null || row.calculations.estimatedPurchaseCost == null) continue;
    const askCost = Number(row.calculations.estimatedPurchaseCost);
    const intrinsic = row.calculations.intrinsicValue == null ? 0 : Number(row.calculations.intrinsicValue);
    const ask = Number(row.ask);
    if (!Number.isFinite(askCost) || !Number.isFinite(ask)) continue;
    const stock = row.underlyingPrice == null ? null : Number(row.underlyingPrice);
    const floor =
      stock != null && Number.isFinite(stock)
        ? Math.round(Math.max(stock - Number(row.strike), 0) * row.multiplier * 100) / 100
        : Math.round(intrinsic * row.multiplier * 100) / 100;
    out.push({
      occSymbol: row.occSymbol,
      expiration: row.expiration,
      strike: Number(row.strike),
      intrinsicFloor: floor,
      askCost,
      extrinsicPerShare: Math.max(0, ask - (Number.isFinite(intrinsic) ? intrinsic : 0)),
      delta: row.delta == null ? null : Number(row.delta),
      intrinsicPercent: row.calculations.intrinsicPercent == null ? null : Number(row.calculations.intrinsicPercent),
    });
  }
  return out;
}

export function selectCallableContracts(
  contracts: readonly NestedChainContract[],
  budget: number,
  minLeapsDays = 365,
  stockPrice: string | null = null,
  idealCost = 6000,
  hardMaxCost = 7000,
  priority: ScanMorePriority = 'closest-to-strategy',
): NestedChainContract[] {
  const plan = orderEligibleQueue({
    contracts,
    stockPrice,
    budgets: { idealCost, hardMaxCost, minLeapsDays },
    priority,
  });
  return plan.queue.slice(0, budget);
}

export function takeNextFromQueue(
  queue: readonly NestedChainContract[],
  offset: number,
  limit: number,
  alreadyEvaluated: ReadonlySet<string>,
): { batch: NestedChainContract[]; nextOffset: number } {
  const batch: NestedChainContract[] = [];
  let index = offset;
  while (index < queue.length && batch.length < limit) {
    const contract = queue[index]!;
    index += 1;
    if (alreadyEvaluated.has(contract.occSymbol)) continue;
    batch.push(contract);
  }
  return { batch, nextOffset: index };
}

export function countExpirations(contracts: readonly NestedChainContract[]): number {
  return new Set(contracts.map((row) => row.expiration)).size;
}

export function budgetsFromProfile(profile: {
  hard: { maxContractCost: string; minLongDelta: string; minExpirationDays: number; maxExpirationDays?: number | null };
  preferences: { idealContractCost: string; preferredLongDelta: string; preferredExpirationDays: number };
}): SelectionBudgets {
  return {
    idealCost: Number(profile.preferences.idealContractCost),
    hardMaxCost: Number(profile.hard.maxContractCost),
    minDelta: Number(profile.hard.minLongDelta),
    preferredDelta: Number(profile.preferences.preferredLongDelta),
    preferredExpirationDays: profile.preferences.preferredExpirationDays,
    minLeapsDays: profile.hard.minExpirationDays,
    maxLeapsDays: profile.hard.maxExpirationDays ?? null,
  };
}

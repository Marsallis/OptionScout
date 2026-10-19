import { z } from 'zod';
import { classifyLongCall, type StrategyProfile } from './strategy-profile.js';

/**
 * Phase 1D discovery rules. Tolerances never rewrite the saved strategy profile.
 * None of these results is a profit prediction.
 */

const decimalText = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
const percentText = z.string().regex(/^\d+(\.\d{1,2})?$/);
const moneyText = z.string().regex(/^\d+\.\d{2}$/);

/**
 * Normalize exploratory delta text. Accepts `.80` and `0.80`.
 * Empty input → null (inclusive default). Invalid → error message.
 */
export function normalizeExploratoryDelta(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const normalized = trimmed.startsWith('.') ? `0${trimmed}` : trimmed.startsWith('-.') ? `-0${trimmed.slice(1)}` : trimmed;
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) {
    return { ok: false, error: 'Enter a delta such as 0.65, 0.75, or 0.80 (or leave blank).' };
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return { ok: false, error: 'Exploratory delta must be a number between 0 and 1.' };
  }
  return { ok: true, value: normalized };
}

const exploratoryDeltaSchema = z
  .union([z.string(), z.null()])
  .transform((value, ctx) => {
    const result = normalizeExploratoryDelta(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
      return z.NEVER;
    }
    return result.value;
  });

export const discoveryToleranceSchema = z
  .object({
    name: z.string().min(1),
    note: z.string().min(1),
    loosensSavedProfile: z.literal(false),
    minLongDelta: exploratoryDeltaSchema,
    maxContractCost: moneyText.nullable(),
    minExpirationDays: z.number().int().positive().nullable(),
    minIntrinsicPercent: percentText.nullable(),
    maxBidAskSpreadPercent: percentText.nullable(),
    minOpenInterest: z.number().int().nonnegative().nullable(),
    minVolume: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type DiscoveryTolerances = z.infer<typeof discoveryToleranceSchema>;

export const SHOW_PROFILE_MISSES: DiscoveryTolerances = {
  name: 'Show profile misses',
  note: 'Exploratory window only. It does not change the saved strategy profile.',
  loosensSavedProfile: false,
  minLongDelta: null,
  maxContractCost: null,
  minExpirationDays: null,
  minIntrinsicPercent: null,
  maxBidAskSpreadPercent: null,
  minOpenInterest: null,
  minVolume: null,
};

export const DISCOVERY_METRICS = [
  'purchaseCost',
  'delta',
  'intrinsicPercent',
  'extrinsicValue',
  'bidAskSpread',
  'liquidity',
  'dte',
  'theta',
  'downsideMoneyness',
  'pmccCompatibility',
] as const;

export type DiscoveryMetric = (typeof DISCOVERY_METRICS)[number];

export type DiscoveryOutcome = 'exact' | 'near' | 'outside-profile' | 'incomplete';

export const DISCOVERY_OUTCOME_LABELS: Record<DiscoveryOutcome, string> = {
  exact: 'Exact Match',
  near: 'Near Match',
  'outside-profile': 'Outside Profile',
  incomplete: 'Incomplete Data',
};

export type MarketDataQuality = 'usable' | 'stale' | 'missing' | 'inconsistent' | 'invalid';

export interface DiscoveryShortCandidate {
  underlying: string;
  expirationDays: number;
  quantity: number;
  multiplier: number;
}

export interface DiscoveryContract {
  id: string;
  underlying: string;
  symbol: string;
  contractCost: string | null;
  delta: string | null;
  intrinsicPercent: string | null;
  extrinsicValue: string | null;
  bid: string | null;
  ask: string | null;
  bidAskSpreadPercent: string | null;
  openInterest: number | null;
  volume: number | null;
  expirationDays: number | null;
  theta: string | null;
  underlyingPrice: string | null;
  strike: string | null;
  downsidePercent: string | null;
  quantity: number | null;
  multiplier: number | null;
  dataQuality: MarketDataQuality;
  shortCandidate: DiscoveryShortCandidate | null;
}

export interface DiscoveryReason {
  metric: DiscoveryMetric | 'data';
  kind: 'hard' | 'preference' | 'unconfigured' | 'exploration' | 'data';
  passed: boolean;
  target: string | null;
  actual: string | null;
  difference: string | null;
  text: string;
}

export interface DiscoveryRow {
  id: string;
  underlying: string;
  symbol: string;
  outcome: DiscoveryOutcome;
  label: string;
  visible: true;
  usableForComparison: boolean;
  withinExploration: boolean;
  reasons: DiscoveryReason[];
  metrics: Record<DiscoveryMetric, number | null>;
  pmccReason: string;
}

export interface MetricObjective {
  metric: DiscoveryMetric;
  direction: 'higher' | 'lower';
}

export interface DiscoveryFilter {
  outcomes?: readonly DiscoveryOutcome[];
  underlying?: string;
  minDelta?: string;
  maxDelta?: string;
  maxCost?: string;
  withinExplorationOnly?: boolean;
}

function cents(value: string | null): number | null {
  if (value == null || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split('.');
  return Number(whole) * 100 + Number(fraction);
}

function scaled(value: string | null, places: number, signed = false): number | null {
  if (value == null) return null;
  const pattern = signed ? /^-?\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,4})?$/;
  const suppliedFraction = value.split('.')[1];
  if (!pattern.test(value) || (suppliedFraction != null && suppliedFraction.length > places)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const factor = 10 ** places;
  const parsed = Number(whole) * factor + Number(fraction.padEnd(places, '0'));
  if (!Number.isSafeInteger(parsed)) return null;
  return negative ? -parsed : parsed;
}

function formatScaled(value: number, places: number): string {
  const sign = value < 0 ? '-' : '';
  const factor = 10 ** places;
  const absolute = Math.abs(value);
  const whole = Math.trunc(absolute / factor);
  const fraction = String(absolute % factor).padStart(places, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

function money(centsValue: number): string {
  const sign = centsValue < 0 ? '-' : '';
  const absolute = Math.abs(centsValue);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function difference(actual: number | null, target: number | null, places: number): string | null {
  if (actual == null || target == null) return null;
  return formatScaled(actual - target, places);
}

function spreadPercent(bid: string | null, ask: string | null, supplied: string | null): { value: string | null; inconsistent: boolean } {
  const bidCents = cents(bid);
  const askCents = cents(ask);
  if (bidCents == null || askCents == null) return { value: supplied, inconsistent: false };
  if (bidCents > askCents) return { value: null, inconsistent: true };
  const width = askCents - bidCents;
  const midpoint = bidCents + askCents;
  if (midpoint === 0) return { value: supplied, inconsistent: false };
  const percent = Math.round((width * 2 * 10000) / midpoint) / 100;
  return { value: supplied ?? percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''), inconsistent: false };
}

function extrinsicCents(cost: string | null, intrinsicPercent: string | null, supplied: string | null): { cents: number | null; inconsistent: boolean } {
  const costCents = cents(cost);
  const intrinsic = scaled(intrinsicPercent, 2);
  const suppliedCents = cents(supplied);
  if (costCents == null || intrinsic == null) return { cents: suppliedCents, inconsistent: false };
  const expected = Math.round((costCents * (10000 - intrinsic)) / 10000);
  if (suppliedCents != null && Math.abs(suppliedCents - expected) > 1) return { cents: null, inconsistent: true };
  return { cents: suppliedCents ?? expected, inconsistent: false };
}

export function downsideMoneyness(underlyingPrice: string | null, strike: string | null, percent: string | null): number | null {
  const price = cents(underlyingPrice);
  const strikeCents = cents(strike);
  const portion = scaled(percent, 2);
  if (price == null || strikeCents == null || portion == null) return null;
  const downside = Math.round((price * (10000 - portion)) / 10000);
  if (downside <= 0) return null;
  return Math.round(((downside - strikeCents) * 10000) / downside) / 100;
}

export function pmccCompatibility(contract: DiscoveryContract): { compatible: boolean | null; reason: string } {
  const short = contract.shortCandidate;
  if (!short) return { compatible: null, reason: 'No short call was supplied for comparison.' };
  if (short.underlying !== contract.underlying) return { compatible: false, reason: 'The short call uses a different underlying.' };
  if (contract.expirationDays == null) return { compatible: null, reason: 'The long expiration is missing.' };
  if (contract.expirationDays <= short.expirationDays) {
    return { compatible: false, reason: `The long expiration is ${short.expirationDays - contract.expirationDays} days short of expiring after the short call.` };
  }
  if (contract.quantity == null) return { compatible: null, reason: 'The long quantity is missing.' };
  if (contract.quantity < short.quantity) {
    return { compatible: false, reason: `The long quantity is ${short.quantity - contract.quantity} contract short of covering the short call.` };
  }
  if (contract.multiplier != null && contract.multiplier !== short.multiplier) {
    return { compatible: false, reason: 'The long and short multipliers differ.' };
  }
  return { compatible: true, reason: 'The long call expires later, matches the underlying, and has enough quantity. This is not a profit estimate.' };
}

function liquidity(contract: DiscoveryContract): number | null {
  if (contract.openInterest == null && contract.volume == null) return null;
  return (contract.openInterest ?? 0) * 1_000_000 + (contract.volume ?? 0);
}

function within(contract: DiscoveryContract, tolerances: DiscoveryTolerances, spread: string | null): { accepted: boolean; reasons: DiscoveryReason[] } {
  const reasons: DiscoveryReason[] = [];
  let accepted = true;
  const check = (passed: boolean, reason: DiscoveryReason) => {
    reasons.push(reason);
    if (!passed) accepted = false;
  };
  if (tolerances.minLongDelta != null) {
    const actual = scaled(contract.delta, 4);
    const target = scaled(tolerances.minLongDelta, 4);
    const passed = actual != null && target != null && actual >= target;
    check(passed, {
      metric: 'delta',
      kind: 'exploration',
      passed,
      target: tolerances.minLongDelta,
      actual: contract.delta,
      difference: difference(actual, target, 4),
      text: passed
        ? `Delta is inside the exploratory floor ${tolerances.minLongDelta}. The saved profile is unchanged.`
        : `Delta is outside the exploratory floor ${tolerances.minLongDelta}. The saved profile is unchanged.`,
    });
  }
  if (tolerances.maxContractCost != null) {
    const actual = cents(contract.contractCost);
    const target = cents(tolerances.maxContractCost);
    const passed = actual != null && target != null && actual <= target;
    check(passed, {
      metric: 'purchaseCost',
      kind: 'exploration',
      passed,
      target: tolerances.maxContractCost,
      actual: contract.contractCost,
      difference: actual != null && target != null ? money(actual - target) : null,
      text: `Exploratory cost ceiling is ${tolerances.maxContractCost}. The saved profile is unchanged.`,
    });
  }
  if (tolerances.minExpirationDays != null) {
    const passed = contract.expirationDays != null && contract.expirationDays >= tolerances.minExpirationDays;
    check(passed, {
      metric: 'dte',
      kind: 'exploration',
      passed,
      target: String(tolerances.minExpirationDays),
      actual: contract.expirationDays == null ? null : String(contract.expirationDays),
      difference: contract.expirationDays == null ? null : String(contract.expirationDays - tolerances.minExpirationDays),
      text: `Exploratory expiration floor is ${tolerances.minExpirationDays} days. The saved profile is unchanged.`,
    });
  }
  if (tolerances.minIntrinsicPercent != null) {
    const actual = scaled(contract.intrinsicPercent, 2);
    const target = scaled(tolerances.minIntrinsicPercent, 2);
    const passed = actual != null && target != null && actual >= target;
    check(passed, {
      metric: 'intrinsicPercent',
      kind: 'exploration',
      passed,
      target: tolerances.minIntrinsicPercent,
      actual: contract.intrinsicPercent,
      difference: difference(actual, target, 2),
      text: `Exploratory intrinsic floor is ${tolerances.minIntrinsicPercent} percent. The saved profile is unchanged.`,
    });
  }
  if (tolerances.maxBidAskSpreadPercent != null) {
    const actual = scaled(spread, 2);
    const target = scaled(tolerances.maxBidAskSpreadPercent, 2);
    const passed = actual != null && target != null && actual <= target;
    check(passed, {
      metric: 'bidAskSpread',
      kind: 'exploration',
      passed,
      target: tolerances.maxBidAskSpreadPercent,
      actual: spread,
      difference: difference(actual, target, 2),
      text: `Exploratory spread ceiling is ${tolerances.maxBidAskSpreadPercent} percent. The saved profile is unchanged.`,
    });
  }
  if (tolerances.minOpenInterest != null) {
    const passed = contract.openInterest != null && contract.openInterest >= tolerances.minOpenInterest;
    check(passed, {
      metric: 'liquidity',
      kind: 'exploration',
      passed,
      target: String(tolerances.minOpenInterest),
      actual: contract.openInterest == null ? null : String(contract.openInterest),
      difference: contract.openInterest == null ? null : String(contract.openInterest - tolerances.minOpenInterest),
      text: `Exploratory open-interest floor is ${tolerances.minOpenInterest}. The saved profile is unchanged.`,
    });
  }
  if (tolerances.minVolume != null) {
    const passed = contract.volume != null && contract.volume >= tolerances.minVolume;
    check(passed, {
      metric: 'liquidity',
      kind: 'exploration',
      passed,
      target: String(tolerances.minVolume),
      actual: contract.volume == null ? null : String(contract.volume),
      difference: contract.volume == null ? null : String(contract.volume - tolerances.minVolume),
      text: `Exploratory volume floor is ${tolerances.minVolume}. The saved profile is unchanged.`,
    });
  }
  return { accepted, reasons };
}

function profileReasons(profile: StrategyProfile, contract: DiscoveryContract, spread: string | null): DiscoveryReason[] {
  const reasons: DiscoveryReason[] = [];
  const cost = cents(contract.contractCost);
  const maxCost = cents(profile.hard.maxContractCost);
  const ideal = cents(profile.preferences.idealContractCost);
  const delta = scaled(contract.delta, 4);
  const minDelta = scaled(profile.hard.minLongDelta, 4);
  const preferredDelta = scaled(profile.preferences.preferredLongDelta, 4);
  const intrinsic = scaled(contract.intrinsicPercent, 2);
  const minIntrinsic = scaled(profile.preferences.minIntrinsicPercent, 2);
  if (cost != null && maxCost != null) {
    const passed = cost <= maxCost;
    reasons.push({
      metric: 'purchaseCost',
      kind: 'hard',
      passed,
      target: profile.hard.maxContractCost,
      actual: contract.contractCost,
      difference: money(cost - maxCost),
      text: passed
        ? `Purchase cost is within the ${profile.hard.maxContractCost} hard maximum.`
        : `Purchase cost is ${money(cost - maxCost)} above the ${profile.hard.maxContractCost} hard maximum.`,
    });
  }
  if (cost != null && ideal != null && (maxCost == null || cost <= maxCost)) {
    const passed = cost < ideal;
    reasons.push({
      metric: 'purchaseCost',
      kind: 'preference',
      passed,
      target: profile.preferences.idealContractCost,
      actual: contract.contractCost,
      difference: money(cost - ideal),
      text: passed
        ? `Purchase cost is below the ${profile.preferences.idealContractCost} preferred target.`
        : `Purchase cost is ${money(cost - ideal)} above the ${profile.preferences.idealContractCost} preferred target.`,
    });
  }
  if (delta != null && minDelta != null) {
    const passed = delta >= minDelta;
    reasons.push({
      metric: 'delta',
      kind: 'hard',
      passed,
      target: profile.hard.minLongDelta,
      actual: contract.delta,
      difference: difference(delta, minDelta, 4),
      text: passed
        ? `Delta meets the ${profile.hard.minLongDelta} hard minimum.`
        : `Delta is ${formatScaled(minDelta - delta, 4)} below the ${profile.hard.minLongDelta} hard minimum.`,
    });
  }
  if (delta != null && preferredDelta != null && (minDelta == null || delta >= minDelta)) {
    const passed = delta >= preferredDelta;
    reasons.push({
      metric: 'delta',
      kind: 'preference',
      passed,
      target: profile.preferences.preferredLongDelta,
      actual: contract.delta,
      difference: difference(delta, preferredDelta, 4),
      text: passed
        ? `Delta meets the ${profile.preferences.preferredLongDelta} preferred target.`
        : `Delta is ${formatScaled(preferredDelta - delta, 4)} below the ${profile.preferences.preferredLongDelta} preferred target.`,
    });
  }
  if (contract.expirationDays != null) {
    const passed = contract.expirationDays >= profile.hard.minExpirationDays;
    reasons.push({
      metric: 'dte',
      kind: 'hard',
      passed,
      target: String(profile.hard.minExpirationDays),
      actual: String(contract.expirationDays),
      difference: String(contract.expirationDays - profile.hard.minExpirationDays),
      text: passed
        ? `Expiration meets the ${profile.hard.minExpirationDays}-day hard minimum.`
        : `Expiration is ${profile.hard.minExpirationDays - contract.expirationDays} days below the hard minimum.`,
    });
  }
  if (intrinsic != null && minIntrinsic != null) {
    const passed = intrinsic >= minIntrinsic;
    reasons.push({
      metric: 'intrinsicPercent',
      kind: 'preference',
      passed,
      target: profile.preferences.minIntrinsicPercent,
      actual: contract.intrinsicPercent,
      difference: difference(intrinsic, minIntrinsic, 2),
      text: passed
        ? `Intrinsic percentage meets the ${profile.preferences.minIntrinsicPercent} percent preferred target.`
        : `Intrinsic percentage is ${formatScaled(minIntrinsic - intrinsic, 2)} points below the ${profile.preferences.minIntrinsicPercent} percent preferred target.`,
    });
  }
  if (profile.preferences.maxBidAskSpreadPercent == null) {
    reasons.push({
      metric: 'bidAskSpread',
      kind: 'unconfigured',
      passed: false,
      target: null,
      actual: spread,
      difference: null,
      text: 'Bid/ask spread limit is not configured, so this cannot be an exact match.',
    });
  } else if (spread != null) {
    const actual = scaled(spread, 2);
    const target = scaled(profile.preferences.maxBidAskSpreadPercent, 2);
    const passed = actual != null && target != null && actual <= target;
    reasons.push({
      metric: 'bidAskSpread',
      kind: 'preference',
      passed,
      target: profile.preferences.maxBidAskSpreadPercent,
      actual: spread,
      difference: difference(actual, target, 2),
      text: passed ? 'Bid/ask spread is within the configured limit.' : 'Bid/ask spread is wider than the configured limit.',
    });
  }
  if (profile.preferences.minOpenInterest == null) {
    reasons.push({
      metric: 'liquidity',
      kind: 'unconfigured',
      passed: false,
      target: null,
      actual: contract.openInterest == null ? null : String(contract.openInterest),
      difference: null,
      text: 'Open-interest minimum is not configured, so this cannot be an exact match.',
    });
  }
  if (profile.preferences.minVolume == null) {
    reasons.push({
      metric: 'liquidity',
      kind: 'unconfigured',
      passed: false,
      target: null,
      actual: contract.volume == null ? null : String(contract.volume),
      difference: null,
      text: 'Volume minimum is not configured, so this cannot be an exact match.',
    });
  }
  return reasons;
}

function metricsOf(
  contract: DiscoveryContract,
  spread: string | null,
  extrinsic: number | null,
  pmcc: boolean | null,
  options?: { excludeSpreadFromRanking?: boolean },
): Record<DiscoveryMetric, number | null> {
  const percent = contract.downsidePercent ?? '15';
  const spreadMetric = options?.excludeSpreadFromRanking ? null : scaled(spread, 2);
  // Negative or missing spreads never participate in liquidity/Pareto-style ranking via bidAskSpread.
  const safeSpread = spreadMetric != null && spreadMetric >= 0 ? spreadMetric : null;
  return {
    purchaseCost: cents(contract.contractCost),
    delta: scaled(contract.delta, 4),
    intrinsicPercent: scaled(contract.intrinsicPercent, 2),
    extrinsicValue: extrinsic,
    bidAskSpread: safeSpread,
    liquidity: liquidity(contract),
    dte: contract.expirationDays,
    theta: scaled(contract.theta, 4, true),
    downsideMoneyness: downsideMoneyness(contract.underlyingPrice, contract.strike, percent),
    pmccCompatibility: pmcc == null ? null : pmcc ? 1 : 0,
  };
}

export function evaluateContract(profile: StrategyProfile, tolerances: DiscoveryTolerances, contract: DiscoveryContract): DiscoveryRow {
  const parsedTolerances = discoveryToleranceSchema.parse(tolerances);
  const spread = spreadPercent(contract.bid, contract.ask, contract.bidAskSpreadPercent);
  const extrinsic = extrinsicCents(contract.contractCost, contract.intrinsicPercent, contract.extrinsicValue);
  const pmcc = pmccCompatibility(contract);
  const dataReasons: DiscoveryReason[] = [];
  let blocked = contract.dataQuality !== 'usable' || spread.inconsistent || extrinsic.inconsistent;
  if (contract.dataQuality !== 'usable') {
    dataReasons.push({
      metric: 'data',
      kind: 'data',
      passed: false,
      target: 'usable',
      actual: contract.dataQuality,
      difference: null,
      text: `Market data is ${contract.dataQuality}, so this row is incomplete and is not a valid opportunity.`,
    });
  }
  if (spread.inconsistent) {
    dataReasons.push({
      metric: 'bidAskSpread',
      kind: 'data',
      passed: false,
      target: null,
      actual: contract.bid,
      difference: null,
      text: 'Bid is above the ask, so the quote is inconsistent and is not a valid opportunity.',
    });
  }
  if (extrinsic.inconsistent) {
    dataReasons.push({
      metric: 'extrinsicValue',
      kind: 'data',
      passed: false,
      target: null,
      actual: contract.extrinsicValue,
      difference: null,
      text: 'Extrinsic value does not match the cost and intrinsic percentage, so the quote is inconsistent.',
    });
  }
  const delta = scaled(contract.delta, 4);
  if (delta != null && (delta < 0 || delta > 10000)) {
    blocked = true;
    dataReasons.push({
      metric: 'delta',
      kind: 'data',
      passed: false,
      target: '0 to 1',
      actual: contract.delta,
      difference: null,
      text: 'Delta is outside 0 to 1, so the value is invalid and is not a valid opportunity.',
    });
  }
  const classification = classifyLongCall(profile, {
    contractCost: contract.contractCost,
    longDelta: contract.delta,
    intrinsicPercent: contract.intrinsicPercent,
    expirationDays: contract.expirationDays,
    bidAskSpreadPercent: spread.value,
    openInterest: contract.openInterest,
    volume: contract.volume,
  });
  const outcome: DiscoveryOutcome = blocked
    ? 'incomplete'
    : classification.outcome === 'exact'
      ? 'exact'
      : classification.outcome === 'near'
        ? 'near'
        : classification.outcome === 'incomplete'
          ? 'incomplete'
          : 'outside-profile';
  const exploration = within(contract, parsedTolerances, spread.value);
  return {
    id: contract.id,
    underlying: contract.underlying,
    symbol: contract.symbol,
    outcome,
    label: DISCOVERY_OUTCOME_LABELS[outcome],
    visible: true,
    usableForComparison: outcome !== 'incomplete',
    withinExploration: exploration.accepted,
    reasons: [...dataReasons, ...profileReasons(profile, contract, spread.value), ...exploration.reasons],
    metrics: metricsOf(contract, spread.value, extrinsic.cents, pmcc.compatible, {
      excludeSpreadFromRanking: blocked || spread.inconsistent,
    }),
    pmccReason: pmcc.reason,
  };
}

export function discoverContracts(profile: StrategyProfile, tolerances: DiscoveryTolerances, contracts: readonly DiscoveryContract[]): DiscoveryRow[] {
  return contracts.map((contract) => evaluateContract(profile, tolerances, contract));
}

export function filterDiscovery(rows: readonly DiscoveryRow[], filter: DiscoveryFilter = {}): DiscoveryRow[] {
  return rows.filter((row) => {
    if (filter.outcomes && !filter.outcomes.includes(row.outcome)) return false;
    if (filter.underlying && row.underlying !== filter.underlying) return false;
    if (filter.withinExplorationOnly && !row.withinExploration) return false;
    if (filter.minDelta != null) {
      const minimum = scaled(filter.minDelta, 4);
      if (minimum == null || row.metrics.delta == null || row.metrics.delta < minimum) return false;
    }
    if (filter.maxDelta != null) {
      const maximum = scaled(filter.maxDelta, 4);
      if (maximum == null || row.metrics.delta == null || row.metrics.delta > maximum) return false;
    }
    if (filter.maxCost != null) {
      const maximum = cents(filter.maxCost);
      if (maximum == null || row.metrics.purchaseCost == null || row.metrics.purchaseCost > maximum) return false;
    }
    return true;
  });
}

export function sortDiscovery(rows: readonly DiscoveryRow[], metric: DiscoveryMetric, direction: 'higher' | 'lower'): DiscoveryRow[] {
  return [...rows].sort((left, right) => {
    const a = left.metrics[metric];
    const b = right.metrics[metric];
    if (a == null && b == null) return left.id.localeCompare(right.id);
    if (a == null) return 1;
    if (b == null) return -1;
    const comparison = direction === 'higher' ? b - a : a - b;
    return comparison === 0 ? left.id.localeCompare(right.id) : comparison;
  });
}

export function compareContracts(left: DiscoveryRow, right: DiscoveryRow, metrics: readonly DiscoveryMetric[]): Array<{ metric: DiscoveryMetric; left: number | null; right: number | null; difference: number | null }> {
  return metrics.map((metric) => {
    const leftValue = left.metrics[metric];
    const rightValue = right.metrics[metric];
    return {
      metric,
      left: leftValue,
      right: rightValue,
      difference: leftValue == null || rightValue == null ? null : leftValue - rightValue,
    };
  });
}

export function paretoFront(rows: readonly DiscoveryRow[], objectives: readonly MetricObjective[]): DiscoveryRow[] {
  if (objectives.length === 0) return [];
  const eligible = rows.filter((row) => row.usableForComparison && objectives.every((objective) => row.metrics[objective.metric] != null));
  return eligible.filter((candidate) => !eligible.some((other) => other.id !== candidate.id && dominates(other, candidate, objectives)));
}

function dominates(left: DiscoveryRow, right: DiscoveryRow, objectives: readonly MetricObjective[]): boolean {
  let better = false;
  for (const objective of objectives) {
    const a = left.metrics[objective.metric];
    const b = right.metrics[objective.metric];
    if (a == null || b == null) return false;
    if (objective.direction === 'higher' ? a < b : a > b) return false;
    if (a !== b) better = true;
  }
  return better;
}

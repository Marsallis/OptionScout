/**
 * Research-only poor man's covered call figures.
 * Long premium is the ask. Short premium is the bid.
 * Max profit ignores leftover long extrinsic: it is the intrinsic width minus the net debit.
 */

import {
  bidAskSpreadPercent,
  daysToExpiration,
  estimatedPurchaseCost,
  extrinsicValue,
  intrinsicPercent,
  intrinsicValue,
} from './finder-math.js';
import { classifyLongCall, classifyShortCall, type StrategyClassification, type StrategyProfile } from './strategy-profile.js';

const moneyPattern = /^-?\d+(\.\d{1,4})?$/;

function cents(value: string | null | undefined): number | null {
  if (value == null || value === '' || !moneyPattern.test(value)) return null;
  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = raw.split('.');
  const padded = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`;
  const amount = Number(padded);
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}

function fromCents(value: number): string {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const text = `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export interface PmccLegInput {
  strike: string;
  expiration: string;
  /** Price per share used for cash: ask for the long call, bid for the short call. */
  premium: string;
  bid: string | null;
  ask: string | null;
  delta: string | null;
  gamma: string | null;
  theta: string | null;
  vega: string | null;
  iv: string | null;
}

export interface PmccAnalysis {
  multiplier: number;
  netDebitPerShare: string;
  netDebit: string;
  maxProfit: string | null;
  maxLoss: string;
  breakeven: string;
  longIntrinsic: string | null;
  longExtrinsic: string | null;
  shortIntrinsic: string | null;
  shortExtrinsic: string | null;
  longDays: number | null;
  shortDays: number | null;
  structureOk: boolean;
  structureNote: string;
}

export function analyzePmcc(input: {
  spot: string;
  asOf: string;
  long: PmccLegInput;
  short: PmccLegInput;
  multiplier?: number;
}): PmccAnalysis {
  const multiplier = input.multiplier ?? 100;
  const longPremium = cents(input.long.premium);
  const shortPremium = cents(input.short.premium);
  const longStrike = cents(input.long.strike);
  const shortStrike = cents(input.short.strike);
  const netPerShare = longPremium != null && shortPremium != null ? longPremium - shortPremium : null;
  const netDebit = netPerShare == null ? null : netPerShare * multiplier;
  const longDays = daysToExpiration(input.long.expiration, input.asOf.slice(0, 10));
  const shortDays = daysToExpiration(input.short.expiration, input.asOf.slice(0, 10));
  const structureOk =
    longStrike != null &&
    shortStrike != null &&
    shortStrike > longStrike &&
    longDays != null &&
    shortDays != null &&
    shortDays < longDays &&
    netDebit != null;
  const width = longStrike != null && shortStrike != null ? (shortStrike - longStrike) * multiplier : null;
  const maxProfit = structureOk && width != null && netDebit != null ? width - netDebit : null;
  const maxLoss = netDebit == null ? null : Math.max(netDebit, 0);
  const breakeven = longStrike != null && netPerShare != null ? longStrike + netPerShare : null;
  const longIntrinsic = intrinsicValue(input.spot, input.long.strike);
  const shortIntrinsic = intrinsicValue(input.spot, input.short.strike);
  return {
    multiplier,
    netDebitPerShare: netPerShare == null ? '0.00' : fromCents(netPerShare),
    netDebit: netDebit == null ? '0.00' : fromCents(netDebit),
    maxProfit: maxProfit == null ? null : fromCents(maxProfit),
    maxLoss: maxLoss == null ? '0.00' : fromCents(maxLoss),
    breakeven: breakeven == null ? '0.00' : fromCents(breakeven),
    longIntrinsic,
    longExtrinsic: extrinsicValue(input.long.premium, longIntrinsic),
    shortIntrinsic,
    shortExtrinsic: extrinsicValue(input.short.premium, shortIntrinsic),
    longDays,
    shortDays,
    structureOk,
    structureNote: structureOk
      ? 'Long strike is below the short strike, and the short call expires first. Figures are research estimates, not an order.'
      : 'This pair is not a conventional PMCC. The short call needs a higher strike and an earlier expiration than the long call.',
  };
}

export interface PmccRuleCheck {
  long: StrategyClassification;
  short: StrategyClassification;
  passes: boolean;
  summary: string;
}

export function evaluatePmccRules(profile: StrategyProfile, input: {
  spot: string;
  long: PmccLegInput;
  short: PmccLegInput;
  asOf: string;
  multiplier?: number;
}): PmccRuleCheck {
  const multiplier = input.multiplier ?? 100;
  const longDays = daysToExpiration(input.long.expiration, input.asOf.slice(0, 10));
  const shortDays = daysToExpiration(input.short.expiration, input.asOf.slice(0, 10));
  const longIntrinsic = intrinsicValue(input.spot, input.long.strike);
  const contractCost = estimatedPurchaseCost(input.long.ask ?? input.long.premium, multiplier);
  const long = classifyLongCall(profile, {
    contractCost,
    longDelta: input.long.delta,
    intrinsicPercent: intrinsicPercent(longIntrinsic, input.long.ask ?? input.long.premium),
    expirationDays: longDays,
    bidAskSpreadPercent: bidAskSpreadPercent(input.long.bid, input.long.ask),
    openInterest: null,
    volume: null,
  });
  const shortCredit = cents(input.short.premium);
  const longCost = cents(input.long.premium);
  const captured =
    shortCredit != null && longCost != null && longCost > 0 ? ((shortCredit / longCost) * 100).toFixed(2) : null;
  const short = classifyShortCall(profile, {
    delta: input.short.delta,
    daysToExpiration: shortDays,
    premiumCapturedPercent: captured,
  });
  const passes = (long.outcome === 'exact' || long.outcome === 'near') && short.outcome !== 'excluded';
  const summary = passes
    ? `Long call is ${long.outcome}. Short call is ${short.outcome}. Open interest and volume were not scored.`
    : `Long call is ${long.outcome}. Short call is ${short.outcome}.`;
  return { long, short, passes, summary };
}

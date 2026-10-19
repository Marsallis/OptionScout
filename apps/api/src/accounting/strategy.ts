import { Decimal } from 'decimal.js';
import type { OptionCycle, SymbolLedger } from './engine.js';
import { money } from './engine.js';

/**
 * A PMCC is saved only after the owner confirms the long call and the exact
 * short-call cycles. Sharing an underlying is not enough.
 */

export interface PmccSuggestion {
  underlying: string;
  longSymbol: string;
  shortSymbol: string;
  ambiguous: boolean;
  reason: string;
}

export interface StrategyValuationModeRow {
  mode: 'broker-mark' | 'midpoint' | 'conservative-liquidation';
  label: string;
  combinedUnrealized: string | null;
  available: boolean;
}

export interface StrategyPerformance {
  assumptions: string[];
  warnings: string[];
  complete: boolean;
  longOriginalInvestment: string | null;
  longCurrentValue: string | null;
  longRealized: string | null;
  longUnrealized: string | null;
  shortCredits: string | null;
  shortCloseCost: string | null;
  shortFees: string | null;
  shortRealized: string | null;
  shortOpenLiability: string | null;
  initialNetDebit: string | null;
  remainingNetValue: string | null;
  realized: string | null;
  unrealized: string | null;
  combined: string | null;
  capitalAtRisk: string | null;
  capitalExplanation: string;
  valuationModes: StrategyValuationModeRow[];
  valuationSourceNote: string;
  quoteAsOf: string | null;
  quoteFetchedAt: string | null;
  shortSymbols: string[];
  shortDaysToExpiration: number | null;
}

function decimal(value: string | null | undefined): Decimal | null {
  if (value == null) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function sum(values: Array<Decimal | null>): Decimal | null {
  if (values.some((value) => value == null)) return null;
  return values.reduce<Decimal>((total, value) => total.plus(value ?? 0), new Decimal(0));
}

export function suggestPairings(symbols: SymbolLedger[]): PmccSuggestion[] {
  const longs = symbols.filter(
    (symbol) => symbol.optionRight === 'call' && symbol.direction === 'long' && symbol.openQuantity !== '0' && symbol.underlying && symbol.expiration,
  );
  const shorts = symbols.filter(
    (symbol) => symbol.optionRight === 'call' && symbol.direction === 'short' && symbol.openQuantity !== '0' && symbol.underlying && symbol.expiration,
  );
  const suggestions: PmccSuggestion[] = [];
  for (const short of shorts) {
    const candidates = longs.filter((long) => {
      if (long.underlying !== short.underlying || !long.expiration || !short.expiration) return false;
      if (long.expiration <= short.expiration) return false;
      if (long.multiplier && short.multiplier && long.multiplier !== short.multiplier) return false;
      const longQty = decimal(long.openQuantity);
      const shortQty = decimal(short.openQuantity);
      if (longQty == null || shortQty == null || shortQty.gt(longQty)) return false;
      return true;
    });
    for (const long of candidates) {
      suggestions.push({
        underlying: long.underlying ?? short.underlying ?? '',
        longSymbol: long.symbol,
        shortSymbol: short.symbol,
        ambiguous: candidates.length > 1,
        reason:
          candidates.length > 1
            ? 'More than one long call could cover this short call. Choose the LEAPS explicitly.'
            : 'One long call expires after this short call and has enough quantity. It is not saved until you confirm it.',
      });
    }
  }
  return suggestions;
}

export function strategyPerformance(long: SymbolLedger, shorts: Array<{ ledger: SymbolLedger; cycle: OptionCycle }>): StrategyPerformance {
  const cycles = shorts.map((item) => item.cycle);
  const assumptions = [
    'Known-fee net cash outlay is the long call entry cost minus confirmed short-cycle opening credits after their known opening fees.',
    'Opening short-call premium is not treated as income while the short call remains open.',
    'Combined P/L adds long appreciation and confirmed short-cycle results once each. Estimated or omitted fees keep that total qualified.',
  ];
  const warnings: string[] = [];
  if (cycles.some((cycle) => cycle.side !== 'short')) {
    warnings.push('A selected cycle is not a short call.');
  }
  if (cycles.some((cycle) => long.openedAt && cycle.openedAt && cycle.openedAt < long.openedAt)) {
    assumptions.push('Short cycles opened before the long call are excluded from the initial net debit.');
  }
  const debitCredits = cycles.filter((cycle) => !long.openedAt || !cycle.openedAt || cycle.openedAt >= long.openedAt);
  const longEntry = decimal(long.entryCost);
  const creditTotal = sum(
    debitCredits.map((cycle) => {
      const cash = decimal(cycle.openingCash);
      const openingFees = decimal(cycle.openingFees);
      if (cash == null || openingFees == null) return null;
      return cash.minus(openingFees);
    }),
  );
  const initialNetDebit = longEntry && creditTotal ? longEntry.minus(creditTotal) : null;
  const shortCredits = sum(cycles.map((cycle) => decimal(cycle.openingCash)));
  const shortCloseCost = sum(cycles.map((cycle) => decimal(cycle.closingCash)));
  const shortFees = sum(cycles.map((cycle) => decimal(cycle.fees)));
  const shortRealizedValues = cycles.map((cycle) => decimal(cycle.realized));
  const shortRealized = sum(shortRealizedValues);
  const openShorts = shorts.filter((item) => decimal(item.cycle.openQuantity)?.gt(0));
  const liabilities = openShorts.map((item) => liabilityOf(item.ledger, item.cycle));
  const shortLiability = openShorts.length === 0 ? new Decimal(0) : sum(liabilities);
  const openUnrealized = openShorts.map((item) => {
    const liability = liabilityOf(item.ledger, item.cycle);
    const premium = decimal(item.cycle.remainingPremium);
    const fees = decimal(item.cycle.remainingFees);
    if (liability == null || premium == null || fees == null) return null;
    return premium.minus(fees).minus(liability);
  });

  if (long.status === 'unreconciled' || long.status === 'missing-opening' || cycles.some((cycle) => cycle.status === 'unreconciled' || cycle.realized == null)) {
    warnings.push('Unreconciled or missing records are excluded, so strategy profit is withheld.');
  }
  if (!long.feesComplete || cycles.some((cycle) => !cycle.feesComplete)) {
    warnings.push('At least one fee was not reported. Figures that include fees are incomplete.');
  }

  const withheld = warnings.some((warning) => warning.includes('withheld'));
  const longRealized = withheld ? null : decimal(long.realized);
  const longUnrealized = withheld ? null : decimal(long.unrealized);
  const unrealized = withheld ? null : sum([longUnrealized, ...openUnrealized]);
  const realized = withheld ? null : sum([longRealized, withheld ? null : shortRealized]);
  const combined = sum([realized, unrealized]);
  const longValue = decimal(long.marketValue);
  const remainingNet =
    withheld || longValue == null || shortLiability == null ? null : longValue.minus(shortLiability);
  const longBasis = decimal(long.remainingBasis);
  const openShortNet = sum(
    openShorts.map((item) => {
      const premium = decimal(item.cycle.remainingPremium);
      const fees = decimal(item.cycle.remainingFees);
      if (premium == null || fees == null) return null;
      return premium.minus(fees);
    }),
  );
  const capital = withheld || longBasis == null || openShortNet == null ? null : longBasis.minus(openShortNet);
  const complete =
    warnings.length === 0 &&
    combined != null &&
    long.status === 'complete' &&
    cycles.every((cycle) => cycle.feesComplete && cycle.status !== 'unreconciled');

  const shortSymbols = [...new Set(shorts.map((item) => item.ledger.symbol))];
  const shortDays = openShorts
    .map((item) => item.ledger.daysRemaining)
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right)[0] ?? null;
  const quoteTimes = [long.quote, ...shorts.map((item) => item.ledger.quote)]
    .filter(Boolean)
    .map((quote) => ({ asOf: quote!.quoteAsOf, fetched: quote!.fetchedAt }));
  const quoteAsOf = quoteTimes.map((row) => row.asOf).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const quoteFetchedAt = quoteTimes.map((row) => row.fetched).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  return {
    assumptions,
    warnings,
    complete,
    longOriginalInvestment: long.entryCost,
    longCurrentValue: long.marketValue,
    longRealized: withheld ? null : long.realized,
    longUnrealized: withheld ? null : long.unrealized,
    shortCredits: shortCredits ? money(shortCredits) : null,
    shortCloseCost: shortCloseCost ? money(shortCloseCost) : null,
    shortFees: shortFees ? money(shortFees) : null,
    shortRealized: withheld || shortRealized == null ? null : money(shortRealized),
    shortOpenLiability: shortLiability ? money(shortLiability) : null,
    initialNetDebit: initialNetDebit ? money(initialNetDebit) : null,
    remainingNetValue: remainingNet ? money(remainingNet) : null,
    realized: realized ? money(realized) : null,
    unrealized: unrealized ? money(unrealized) : null,
    combined: combined ? money(combined) : null,
    capitalAtRisk: capital ? money(capital) : null,
    capitalExplanation:
      'Known-fee cash still committed is the remaining long-call cost minus the net credit still open on confirmed short calls. Estimated or omitted fees keep this figure qualified.',
    valuationModes: [],
    valuationSourceNote:
      'Default combined unrealized uses each leg’s brokerage REST mark × quantity × multiplier. Midpoint and conservative liquidation modes are computed separately and labeled — they are never mixed silently.',
    quoteAsOf,
    quoteFetchedAt,
    shortSymbols,
    shortDaysToExpiration: shortDays,
  };
}

function liabilityOf(ledger: SymbolLedger, cycle: OptionCycle): Decimal | null {
  const mark = decimal(ledger.quote?.mark);
  const quantity = decimal(cycle.openQuantity);
  const multiplier = decimal(ledger.multiplier);
  if (mark == null || quantity == null || multiplier == null) return null;
  return mark.times(quantity).times(multiplier);
}

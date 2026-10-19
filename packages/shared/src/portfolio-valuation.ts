/**
 * Explicit portfolio valuation modes for open option legs.
 * Does not invent quotes. Does not mutate cost basis or transactions.
 */

export type ValuationModeId = 'broker-mark' | 'midpoint' | 'conservative-liquidation';

export const VALUATION_MODE_LABELS: Record<ValuationModeId, string> = {
  'broker-mark': 'Brokerage-reported mark (REST mark field)',
  midpoint: 'Midpoint-based estimated unrealized P/L',
  'conservative-liquidation': 'Conservative bid/ask liquidation illustration',
};

export interface LegQuoteInputs {
  direction: 'long' | 'short' | 'flat';
  openQuantity: string | null;
  multiplier: string | null;
  remainingBasis: string | null;
  bid: string | null;
  ask: string | null;
  mid: string | null;
  mark: string | null;
  quoteAsOf: string | null;
  quoteFetchedAt: string | null;
}

export interface LegValuation {
  mode: ValuationModeId;
  pricePerShare: string | null;
  priceSource: string;
  marketValueOrLiability: string | null;
  unrealized: string | null;
  available: boolean;
  note: string;
}

export interface MultiModeValuation {
  legs: Array<{ symbol: string; direction: 'long' | 'short' | 'flat'; valuations: LegValuation[] }>;
  combinedUnrealized: Record<ValuationModeId, string | null>;
  quoteAsOf: string | null;
  quoteFetchedAt: string | null;
  warnings: string[];
}

function num(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number): string {
  return value.toFixed(2);
}

function computeMid(bid: string | null, ask: string | null, mid: string | null): { price: string | null; source: string } {
  const direct = num(mid);
  if (direct != null) return { price: money(direct), source: 'Brokerage mid field' };
  const bidN = num(bid);
  const askN = num(ask);
  if (bidN != null && askN != null && askN >= bidN) {
    return { price: money((bidN + askN) / 2), source: '(bid + ask) / 2' };
  }
  return { price: null, source: 'Mid unavailable (need mid or valid bid/ask)' };
}

function priceForMode(
  mode: ValuationModeId,
  direction: 'long' | 'short' | 'flat',
  input: LegQuoteInputs,
): { price: string | null; source: string } {
  if (mode === 'broker-mark') {
    return {
      price: input.mark,
      source: input.mark != null ? 'Brokerage REST mark field (not assumed mid or ask)' : 'Brokerage mark missing',
    };
  }
  if (mode === 'midpoint') {
    return computeMid(input.bid, input.ask, input.mid);
  }
  // Conservative liquidation: sell long at bid; buy-to-close short at ask.
  if (direction === 'long') {
    return {
      price: input.bid,
      source: input.bid != null ? 'Bid (illustrative long exit)' : 'Bid missing',
    };
  }
  if (direction === 'short') {
    return {
      price: input.ask,
      source: input.ask != null ? 'Ask (illustrative short cover)' : 'Ask missing',
    };
  }
  return { price: null, source: 'Flat position' };
}

/** Unrealized for one open option leg under a chosen price convention. */
export function valueOpenLeg(input: LegQuoteInputs, mode: ValuationModeId): LegValuation {
  const qty = num(input.openQuantity);
  const mult = num(input.multiplier) ?? 100;
  const basis = num(input.remainingBasis);
  const { price, source } = priceForMode(mode, input.direction, input);
  const priceN = num(price);
  if (input.direction === 'flat' || qty == null || qty === 0) {
    return {
      mode,
      pricePerShare: price,
      priceSource: source,
      marketValueOrLiability: '0.00',
      unrealized: '0.00',
      available: true,
      note: 'No open quantity.',
    };
  }
  if (priceN == null || basis == null) {
    return {
      mode,
      pricePerShare: price,
      priceSource: source,
      marketValueOrLiability: null,
      unrealized: null,
      available: false,
      note: 'Unrealized withheld — price or known-fee remaining basis missing.',
    };
  }
  const notional = priceN * qty * mult;
  if (input.direction === 'long') {
    return {
      mode,
      pricePerShare: money(priceN),
      priceSource: source,
      marketValueOrLiability: money(notional),
      unrealized: money(notional - basis),
      available: true,
      note: 'Long unrealized = market value − known-fee remaining cost.',
    };
  }
  // Short: remainingBasis is known-fee net credit still open; liability = price × qty × mult.
  return {
    mode,
    pricePerShare: money(priceN),
    priceSource: source,
    marketValueOrLiability: money(notional),
    unrealized: money(basis - notional),
    available: true,
    note: 'Short unrealized = known-fee net credit remaining − cover liability.',
  };
}

export function combineLegUnrealized(legs: LegValuation[]): string | null {
  let total = 0;
  let any = false;
  for (const leg of legs) {
    const value = num(leg.unrealized);
    if (value == null) return null;
    total += value;
    any = true;
  }
  return any ? money(total) : null;
}

export function buildMultiModeValuation(
  legs: Array<LegQuoteInputs & { symbol: string }>,
): MultiModeValuation {
  const modes: ValuationModeId[] = ['broker-mark', 'midpoint', 'conservative-liquidation'];
  const warnings: string[] = [];
  const valued = legs.map((leg) => {
    const valuations = modes.map((mode) => valueOpenLeg(leg, mode));
    for (const row of valuations) {
      if (!row.available && leg.direction !== 'flat') {
        warnings.push(`${leg.symbol} (${row.mode}): ${row.note}`);
      }
    }
    // Detect mixed mark vs mid/ask without labeling — surface when broker mark equals one side only.
    const mark = num(leg.mark);
    const mid = num(computeMid(leg.bid, leg.ask, leg.mid).price);
    const ask = num(leg.ask);
    if (leg.direction === 'short' && mark != null && ask != null && mid != null && Math.abs(mark - ask) < 0.005 && Math.abs(mark - mid) > 0.01) {
      warnings.push(
        `${leg.symbol}: brokerage mark (${mark.toFixed(2)}) matches the ask, not the midpoint (${mid.toFixed(2)}). Broker-mark and midpoint modes will differ.`,
      );
    }
    if (leg.direction === 'long' && mark != null && mid != null && Math.abs(mark - mid) < 0.005) {
      warnings.push(`${leg.symbol}: brokerage mark matches midpoint for this snapshot.`);
    }
    return { symbol: leg.symbol, direction: leg.direction, valuations };
  });

  const combinedUnrealized = Object.fromEntries(
    modes.map((mode) => {
      const slice = valued.map((leg) => leg.valuations.find((row) => row.mode === mode)!);
      return [mode, combineLegUnrealized(slice)];
    }),
  ) as Record<ValuationModeId, string | null>;

  const quoteAsOf = legs.map((leg) => leg.quoteAsOf).filter(Boolean).sort().at(-1) ?? null;
  const quoteFetchedAt = legs.map((leg) => leg.quoteFetchedAt).filter(Boolean).sort().at(-1) ?? null;

  return { legs: valued, combinedUnrealized, quoteAsOf, quoteFetchedAt, warnings };
}

export interface RealizedAuditLine {
  id: string;
  underlying: string;
  symbol: string;
  side: 'long' | 'short';
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  originalQuantity: string | null;
  openQuantity: string | null;
  multiplier: string | null;
  openingCash: string;
  closingCash: string;
  fees: string;
  realized: string | null;
  feesComplete: boolean;
  includedInTotal: boolean;
  note: string;
}

export interface RealizedAudit {
  totalIncluded: string | null;
  label: string;
  howCalculated: string;
  lines: RealizedAuditLine[];
  excludedNotes: string[];
  grossShortOpeningCredits: string | null;
  closedShortRealized: string | null;
  closedLongRealized: string | null;
  unknownFeeCount: number;
  includedCycleCount: number;
}

const REALIZED_HOW_CALCULATED =
  'Sum of reconstructed FIFO option-cycle realized figures marked included. Each cycle is one opening lot matched to supported closes — rolls open a new cycle and do not reuse the prior opening credit. Open short credits, deposits, withdrawals, balance adjustments, and unresolved assignment/transfer cycles are excluded. Incomplete fees qualify the total as partial accounting. Partially closed lots can contribute realized P/L while a remaining quantity (or strategy) stays open.';

/** Read-only realized audit from reconstructed cycles — does not alter transactions. */
export function buildRealizedAudit(
  positions: Array<{
    underlying: string;
    symbol: string;
    multiplier?: string | null;
    cycles: Array<{
      openingTransactionId: string;
      side: 'long' | 'short';
      status: string;
      openedAt: string | null;
      closedAt: string | null;
      originalQuantity?: string | null;
      openQuantity?: string | null;
      openingCash: string;
      closingCash: string;
      fees: string;
      realized: string | null;
      feesComplete: boolean;
      notes: string[];
    }>;
  }>,
): RealizedAudit {
  const lines: RealizedAuditLine[] = [];
  const excludedNotes: string[] = [];
  let total = 0;
  let totalAny = false;
  let grossCredits = 0;
  let grossAny = false;
  let closedShortRealized = 0;
  let closedShortAny = false;
  let closedLongRealized = 0;
  let closedLongAny = false;
  let unknownFeeCount = 0;
  let includedCycleCount = 0;

  for (const position of positions) {
    for (const cycle of position.cycles) {
      if (cycle.side === 'short') {
        const openCash = num(cycle.openingCash);
        if (openCash != null) {
          grossCredits += openCash;
          grossAny = true;
        }
      }
      if (!cycle.feesComplete) unknownFeeCount += 1;
      const realized = num(cycle.realized);
      const isClosed = cycle.status === 'closed';
      const withheld = cycle.status === 'unreconciled' || cycle.realized == null;
      let note = '';
      let included = false;
      if (withheld) {
        note = 'Excluded — unreconciled cycle or withheld realized figure.';
        excludedNotes.push(`${position.symbol}: ${note}`);
      } else if (!isClosed && cycle.side === 'short') {
        note = 'Open short cycle — opening credit is not realized profit.';
        // Partial closes can leave realized on a cycle that still has open quantity.
        if (realized != null && realized !== 0) {
          included = true;
          total += realized;
          totalAny = true;
          note = 'Partial realized on a cycle still marked open (scaled closes).';
        }
      } else if (!isClosed && cycle.side === 'long') {
        note = 'Open long cycle — no realized until a supported close.';
        if (realized != null && realized !== 0) {
          included = true;
          total += realized;
          totalAny = true;
          note = 'Partial realized on a long cycle still marked open (scaled closes).';
        }
      } else if (isClosed) {
        included = realized != null;
        if (realized != null) {
          total += realized;
          totalAny = true;
          if (cycle.side === 'short') {
            closedShortRealized += realized;
            closedShortAny = true;
          } else {
            closedLongRealized += realized;
            closedLongAny = true;
          }
        }
        note = cycle.feesComplete
          ? 'Closed cycle included in reconstructed realized results.'
          : 'Closed cycle included; fees incomplete — treat as partial accounting.';
      } else {
        note = 'Cycle not included in supported realized totals.';
      }
      if (included) includedCycleCount += 1;
      lines.push({
        id: cycle.openingTransactionId,
        underlying: position.underlying,
        symbol: position.symbol,
        side: cycle.side,
        status: cycle.status,
        openedAt: cycle.openedAt,
        closedAt: cycle.closedAt,
        originalQuantity: cycle.originalQuantity ?? null,
        openQuantity: cycle.openQuantity ?? null,
        multiplier: position.multiplier ?? null,
        openingCash: cycle.openingCash,
        closingCash: cycle.closingCash,
        fees: cycle.fees,
        realized: cycle.realized,
        feesComplete: cycle.feesComplete,
        includedInTotal: included,
        note,
      });
    }
  }

  const incomplete = unknownFeeCount > 0 || excludedNotes.length > 0;
  return {
    totalIncluded: totalAny ? money(total) : null,
    label: incomplete
      ? 'Reconstructed realized results — partial accounting'
      : 'Reconstructed realized results',
    howCalculated: REALIZED_HOW_CALCULATED,
    lines,
    excludedNotes,
    grossShortOpeningCredits: grossAny ? money(grossCredits) : null,
    closedShortRealized: closedShortAny ? money(closedShortRealized) : null,
    closedLongRealized: closedLongAny ? money(closedLongRealized) : null,
    unknownFeeCount,
    includedCycleCount,
  };
}

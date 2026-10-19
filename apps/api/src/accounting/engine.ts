import { Decimal } from 'decimal.js';
import { parseOccSymbol } from '../brokerage/normalize.js';

/**
 * FIFO option lots.
 *
 * An opening short-call credit stays unrealized until a supported close.
 * Deposits, withdrawals, and balance adjustments are not trading profit.
 * Assignments, exercises, and transfers withhold profit for the quantity they
 * affect. Missing fees stay missing. Missing marks are not invented.
 */

export type AccountingClassification = 'trade' | 'expiration' | 'assignment' | 'exercise' | 'transfer' | 'unsupported';

export interface AccountingFees {
  clearing: string | null;
  regulatory: string | null;
  proprietary: string | null;
  other: string | null;
}

export interface AccountingTransaction {
  id: string;
  symbol: string | null;
  instrumentType: string | null;
  action: string | null;
  quantity: string | null;
  price: string | null;
  executedAt: string | null;
  grossValue: string | null;
  valueEffect: string | null;
  commission: string | null;
  fees: AccountingFees;
  feesEstimated?: boolean;
  netValue?: string | null;
  netValueEffect?: string | null;
  classification: AccountingClassification;
  transactionType: string | null;
  transactionSubtype: string | null;
}

export interface AccountingPosition {
  id: string;
  providerSymbol: string;
  underlyingSymbol: string;
  instrumentType: string;
  quantity: string;
  direction: 'long' | 'short' | 'zero';
  strike: string | null;
  expiration: string | null;
  averageOpenPrice: string | null;
  multiplier: string;
  optionRight: 'call' | 'put' | null;
}

export interface AccountingQuote {
  symbol: string;
  bid: string | null;
  ask: string | null;
  mid: string | null;
  mark: string | null;
  quoteAsOf: string | null;
  fetchedAt: string | null;
  freshness: 'not_requested' | 'unavailable' | 'missing' | 'fresh' | 'closed_session' | 'stale';
  entitlement: 'unknown' | 'entitled' | 'denied';
}

export interface LedgerEvent {
  id: string;
  executedAt: string | null;
  action: string | null;
  classification: AccountingClassification;
  quantity: string | null;
  cash: string | null;
  cashDirection: 'in' | 'out' | 'none' | null;
  note: string;
}

export interface OptionCycle {
  openingTransactionId: string;
  symbol: string;
  side: 'long' | 'short';
  openedAt: string | null;
  closedAt: string | null;
  originalQuantity: string;
  openQuantity: string;
  openingCash: string;
  closingCash: string;
  remainingPremium: string;
  remainingFees: string;
  openingFees: string;
  fees: string;
  feesComplete: boolean;
  realized: string | null;
  status: 'open' | 'closed' | 'unreconciled';
  events: LedgerEvent[];
}

export type LedgerStatus = 'complete' | 'partial' | 'unreconciled' | 'missing-opening';

export interface SymbolLedger {
  symbol: string;
  positionId: string | null;
  underlying: string | null;
  instrumentType: string | null;
  optionRight: 'call' | 'put' | null;
  strike: string | null;
  expiration: string | null;
  daysRemaining: number | null;
  multiplier: string | null;
  brokerQuantity: string | null;
  brokerDirection: 'long' | 'short' | 'zero' | null;
  openQuantity: string;
  direction: 'long' | 'short' | 'flat';
  openedAt: string | null;
  originalPremium: string | null;
  entryCost: string | null;
  remainingPremium: string | null;
  remainingFees: string | null;
  remainingBasis: string | null;
  marketValue: string | null;
  realized: string | null;
  unrealized: string | null;
  feesComplete: boolean;
  status: LedgerStatus;
  issues: string[];
  cycles: OptionCycle[];
  quote: AccountingQuote | null;
  brokerAverageOpenPrice: string | null;
  calculatedAverageOpenPrice: string | null;
  averagePriceDifference: string | null;
}

export interface Reconstruction {
  symbols: SymbolLedger[];
  excludedCashEvents: number;
}

interface Lot {
  openingTransactionId: string;
  symbol: string;
  side: 'long' | 'short';
  openedAt: string | null;
  originalQuantity: Decimal;
  openQuantity: Decimal;
  originalPremium: Decimal;
  remainingPremium: Decimal;
  originalFees: Decimal;
  remainingFees: Decimal;
  closeFees: Decimal;
  closingCash: Decimal;
  feesComplete: boolean;
  withheld: boolean;
  closedAt: string | null;
  realized: Decimal;
  events: LedgerEvent[];
}

const ZERO = new Decimal(0);

export function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function quantityText(value: Decimal): string {
  return value.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString();
}

function decimalOrNull(value: string | null | undefined): Decimal | null {
  if (value == null || value.trim() === '') return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function feeInfo(tx: AccountingTransaction): { amount: Decimal; complete: boolean; missing: string[] } {
  const parts: Array<[string, string | null]> = [
    ['commission', tx.commission],
    ['clearing-fees', tx.fees.clearing],
    ['regulatory-fees', tx.fees.regulatory],
    ['proprietary-index-option-fees', tx.fees.proprietary],
    ['other-charge', tx.fees.other],
  ];
  let amount = ZERO;
  const missing: string[] = [];
  for (const [name, part] of parts) {
    const parsed = decimalOrNull(part);
    if (parsed == null) {
      missing.push(name);
      continue;
    }
    amount = amount.plus(parsed);
  }
  return { amount, complete: missing.length === 0, missing };
}

function noteNetValue(issues: string[], tx: AccountingTransaction, gross: Decimal, feeAmount: Decimal): boolean {
  if (tx.netValue == null || tx.netValueEffect == null) return false;
  const net = decimalOrNull(tx.netValue);
  const effect = (tx.valueEffect ?? '').toLowerCase();
  const netEffect = tx.netValueEffect.toLowerCase();
  if (net == null || (effect !== 'debit' && effect !== 'credit') || effect !== netEffect) {
    issues.push('Broker net value could not be compared with the gross amount.');
    return true;
  }
  const expected = effect === 'debit' ? gross.plus(feeAmount) : gross.minus(feeAmount);
  if (expected.minus(net).abs().gt('0.01')) {
    issues.push('Broker net value differs from gross value adjusted by the reported fees.');
    return true;
  }
  return false;
}

function daysUntil(expiration: string | null, asOf: string): number | null {
  if (!expiration) return null;
  const end = Date.parse(`${expiration.slice(0, 10)}T00:00:00Z`);
  const start = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.round((end - start) / 86_400_000);
}

function optionRightOf(symbol: string): 'call' | 'put' | null {
  const match = /([CP])\d{8}$/.exec(symbol.trim());
  if (match?.[1] === 'C') return 'call';
  if (match?.[1] === 'P') return 'put';
  return null;
}

export function isCashMovement(tx: AccountingTransaction): boolean {
  if (tx.classification !== 'unsupported') return false;
  const blob = `${tx.transactionType ?? ''} ${tx.transactionSubtype ?? ''} ${tx.action ?? ''}`.toLowerCase();
  return (
    blob.includes('money') ||
    blob.includes('deposit') ||
    blob.includes('withdraw') ||
    blob.includes('balance') ||
    blob.includes('dividend') ||
    blob.includes('interest')
  );
}

type Cash = { ok: true; amount: Decimal; direction: 'in' | 'out' | 'none' } | { ok: false; reason: string };

function cashFor(tx: AccountingTransaction, quantity: Decimal, multiplier: Decimal | null, buy: boolean): Cash {
  const gross = decimalOrNull(tx.grossValue);
  const effect = (tx.valueEffect ?? '').toLowerCase();
  if (gross != null && (effect === 'debit' || effect === 'credit')) {
    return { ok: true, amount: gross, direction: effect === 'debit' ? 'out' : 'in' };
  }
  if (gross != null && effect === 'none') {
    if (gross.isZero()) return { ok: true, amount: ZERO, direction: 'none' };
    return { ok: false, reason: 'A nonzero cash amount had no debit or credit direction.' };
  }
  const price = decimalOrNull(tx.price);
  if (price != null && multiplier != null) {
    return { ok: true, amount: price.times(quantity).times(multiplier), direction: buy ? 'out' : 'in' };
  }
  return { ok: false, reason: 'The cash amount could not be determined from the transaction.' };
}

function sortTransactions(transactions: AccountingTransaction[]): AccountingTransaction[] {
  return [...transactions].sort((left, right) => {
    const leftTime = left.executedAt ?? '9999';
    const rightTime = right.executedAt ?? '9999';
    if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function consume(lots: Lot[], side: 'long' | 'short', quantity: Decimal): { matched: Array<{ lot: Lot; quantity: Decimal }>; remainder: Decimal } {
  let left = quantity;
  const matched: Array<{ lot: Lot; quantity: Decimal }> = [];
  for (const lot of lots) {
    if (left.lte(0)) break;
    if (lot.side !== side || lot.openQuantity.lte(0)) continue;
    const take = Decimal.min(lot.openQuantity, left);
    matched.push({ lot, quantity: take });
    left = left.minus(take);
  }
  return { matched, remainder: left };
}

function release(lot: Lot, take: Decimal): { premium: Decimal; fees: Decimal } {
  const premium = lot.openQuantity.eq(take) ? lot.remainingPremium : lot.remainingPremium.times(take).div(lot.openQuantity);
  const fees = lot.openQuantity.eq(take) ? lot.remainingFees : lot.remainingFees.times(take).div(lot.openQuantity);
  lot.remainingPremium = lot.remainingPremium.minus(premium);
  lot.remainingFees = lot.remainingFees.minus(fees);
  lot.openQuantity = lot.openQuantity.minus(take);
  return { premium, fees };
}

type Intent =
  | { kind: 'open'; side: 'long' | 'short' }
  | { kind: 'close'; side: 'long' | 'short' }
  | { kind: 'expire'; side: 'long' | 'short' | null }
  | { kind: 'withhold'; reason: string }
  | { kind: 'ignore' };

function intentOf(tx: AccountingTransaction): Intent {
  if (isCashMovement(tx)) return { kind: 'ignore' };
  if (tx.classification === 'transfer') return { kind: 'withhold', reason: 'A transfer was not applied to cost basis.' };
  if (tx.classification === 'assignment') return { kind: 'withhold', reason: 'An assignment was withheld because the stock leg is not accounted.' };
  if (tx.classification === 'exercise') return { kind: 'withhold', reason: 'An exercise was withheld because the stock leg is not accounted.' };
  if (tx.classification === 'unsupported') return { kind: 'withhold', reason: 'An unsupported transaction affected this contract.' };
  const action = (tx.action ?? '').toLowerCase();
  if (tx.classification === 'expiration') {
    if (action.includes('sell')) return { kind: 'expire', side: 'long' };
    if (action.includes('buy')) return { kind: 'expire', side: 'short' };
    return { kind: 'expire', side: null };
  }
  if (action === 'buy to open') return { kind: 'open', side: 'long' };
  if (action === 'sell to open') return { kind: 'open', side: 'short' };
  if (action === 'sell to close') return { kind: 'close', side: 'long' };
  if (action === 'buy to close') return { kind: 'close', side: 'short' };
  return { kind: 'withhold', reason: 'A trade action was not an option open or close.' };
}

function openSide(lots: Lot[]): 'long' | 'short' | null {
  const sides = new Set(lots.filter((lot) => lot.openQuantity.gt(0)).map((lot) => lot.side));
  if (sides.size !== 1) return null;
  return [...sides][0] ?? null;
}

export function reconstructPortfolio(input: {
  transactions: AccountingTransaction[];
  positions: AccountingPosition[];
  quotes: AccountingQuote[];
  asOf: string;
}): Reconstruction {
  const positionsBySymbol = new Map(input.positions.map((position) => [position.providerSymbol, position]));
  const quotesBySymbol = new Map(input.quotes.map((quote) => [quote.symbol, quote]));
  const grouped = new Map<string, AccountingTransaction[]>();
  for (const tx of sortTransactions(input.transactions)) {
    if (!tx.symbol) continue;
    const rows = grouped.get(tx.symbol) ?? [];
    rows.push(tx);
    grouped.set(tx.symbol, rows);
  }
  for (const position of input.positions) {
    if (!grouped.has(position.providerSymbol)) grouped.set(position.providerSymbol, []);
  }
  const symbols = [...grouped.entries()]
    .map(([symbol, rows]) => buildSymbol(symbol, rows, positionsBySymbol.get(symbol) ?? null, quotesBySymbol.get(symbol) ?? null, input.asOf))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  return { symbols, excludedCashEvents: input.transactions.filter((tx) => isCashMovement(tx)).length };
}

function buildSymbol(
  symbol: string,
  rows: AccountingTransaction[],
  position: AccountingPosition | null,
  quote: AccountingQuote | null,
  asOf: string,
): SymbolLedger {
  const issues: string[] = [];
  const lots: Lot[] = [];
  const multiplier = position ? decimalOrNull(position.multiplier) : null;
  let blocked = false;
  let cashDisagrees = false;
  if (position && position.instrumentType !== 'Equity Option') {
    issues.push('This instrument is outside the options accounting engine.');
    blocked = true;
  }

  for (const tx of rows) {
    if (isCashMovement(tx)) continue;
    if (!tx.executedAt) {
      issues.push('A transaction had no execution time and was not applied.');
      blocked = true;
      continue;
    }
    const intent = intentOf(tx);
    if (intent.kind === 'ignore') continue;
    const quantity = decimalOrNull(tx.quantity);
    if (intent.kind === 'withhold') {
      issues.push(intent.reason);
      blocked = true;
      withhold(lots, tx, quantity, intent.reason);
      continue;
    }
    if (quantity == null || quantity.lte(0)) {
      issues.push('A transaction quantity was missing.');
      blocked = true;
      continue;
    }
    const side = intent.kind === 'expire' ? (intent.side ?? openSide(lots)) : intent.side;
    if (side == null) {
      issues.push('An expiration could not be matched to one open side.');
      blocked = true;
      continue;
    }
    const buying = (intent.kind === 'open' && side === 'long') || (intent.kind !== 'open' && side === 'short');
    const cash = cashFor(tx, quantity, multiplier, buying);
    if (!cash.ok) {
      issues.push(cash.reason);
      blocked = true;
      continue;
    }
    const fees = feeInfo(tx);
    if (!fees.complete) issues.push(`Unreported fee fields were not treated as zero: ${fees.missing.join(', ')}.`);
    if (tx.feesEstimated) issues.push('The broker marked the reported fees as estimated, so fee-adjusted figures are not fully reconciled.');
    if (noteNetValue(issues, tx, cash.amount, fees.amount)) cashDisagrees = true;
    const feeComplete = fees.complete && tx.feesEstimated !== true;
    if (intent.kind === 'open') {
      lots.push({
        openingTransactionId: tx.id,
        symbol,
        side,
        openedAt: tx.executedAt,
        originalQuantity: quantity,
        openQuantity: quantity,
        originalPremium: cash.amount,
        remainingPremium: cash.amount,
        originalFees: fees.amount,
        remainingFees: fees.amount,
        closeFees: ZERO,
        closingCash: ZERO,
        feesComplete: feeComplete,
        withheld: false,
        closedAt: null,
        realized: ZERO,
        events: [toEvent(tx, quantity, cash, 'Opening cash is not realized profit.')],
      });
      continue;
    }
    const { matched, remainder } = consume(lots, side, quantity);
    if (remainder.gt(0) || matched.length === 0) {
      issues.push('A closing transaction had no matching open lot.');
      blocked = true;
      continue;
    }
    let feesLeft = fees.amount;
    matched.forEach((match, index) => {
      const released = release(match.lot, match.quantity);
      const closeCash = cash.amount.times(match.quantity).div(quantity);
      const closeFee = index === matched.length - 1 ? feesLeft : fees.amount.times(match.quantity).div(quantity);
      feesLeft = feesLeft.minus(closeFee);
      match.lot.closingCash = match.lot.closingCash.plus(closeCash);
      match.lot.closeFees = match.lot.closeFees.plus(closeFee);
      match.lot.feesComplete = match.lot.feesComplete && feeComplete;
      match.lot.closedAt = tx.executedAt;
      match.lot.events.push(toEvent(tx, match.quantity, { amount: closeCash, direction: cash.direction }, 'Closed with FIFO matching.'));
      const next =
        side === 'long'
          ? closeCash.minus(released.premium).minus(released.fees).minus(closeFee)
          : released.premium.minus(closeCash).minus(released.fees).minus(closeFee);
      match.lot.realized = match.lot.realized.plus(next);
    });
  }

  const openLots = lots.filter((lot) => lot.openQuantity.gt(0));
  const openQuantity = openLots.reduce((sum, lot) => sum.plus(lot.openQuantity), ZERO);
  const sideNow = openSide(lots);
  if (openLots.length > 0 && sideNow == null) {
    issues.push('Open long and short lots remain on the same contract.');
    blocked = true;
  }
  const direction: SymbolLedger['direction'] = openQuantity.isZero() ? 'flat' : (sideNow ?? 'flat');

  if (position && position.instrumentType === 'Equity Option' && !blocked) {
    const brokerQty = decimalOrNull(position.quantity) ?? ZERO;
    const brokerFlat = position.direction === 'zero' || brokerQty.isZero();
    if (brokerFlat && openQuantity.gt(0)) {
      issues.push('The brokerage position is flat while option lots remain open.');
      blocked = true;
    } else if (!brokerFlat && lots.length === 0) {
      issues.push('No opening transaction was found for the open brokerage position.');
    } else if (!brokerFlat && (position.direction !== direction || !brokerQty.eq(openQuantity))) {
      issues.push('The reconstructed quantity does not match the brokerage position.');
      blocked = true;
    }
  }

  const missingOpening = Boolean(
    position && position.instrumentType === 'Equity Option' && position.direction !== 'zero' && lots.length === 0,
  );
  const feesComplete = lots.length === 0 ? !missingOpening : lots.every((lot) => lot.feesComplete);
  if (!feesComplete && lots.some((lot) => !lot.feesComplete)) {
    // The per-transaction issue is already recorded.
  }
  const longLots = lots.filter((lot) => lot.side === 'long');
  const shortLots = lots.filter((lot) => lot.side === 'short');
  const displayLots = direction === 'short' ? shortLots : longLots.length > 0 ? longLots : shortLots;
  const originalPremium = displayLots.reduce((sum, lot) => sum.plus(lot.originalPremium), ZERO);
  const longPremium = longLots.reduce((sum, lot) => sum.plus(lot.originalPremium), ZERO);
  const longOpenFees = longLots.reduce((sum, lot) => sum.plus(lot.originalFees), ZERO);
  const remainingPremium = openLots.reduce((sum, lot) => sum.plus(lot.remainingPremium), ZERO);
  const remainingFees = openLots.reduce((sum, lot) => sum.plus(lot.remainingFees), ZERO);
  const mark = quote ? decimalOrNull(quote.mark) : null;
  let marketValue: Decimal | null = null;
  if (openQuantity.gt(0)) {
    if (mark == null) issues.push('No mark was available, so unrealized P/L was withheld.');
    else if (multiplier == null) issues.push('Unrealized P/L needs the contract multiplier.');
    else marketValue = mark.times(openQuantity).times(multiplier);
  }
  const canValue = !blocked && !missingOpening && position?.instrumentType !== 'Equity';
  const outside = position != null && position.instrumentType !== 'Equity Option';
  let unrealized: Decimal | null = null;
  if (canValue && !outside && openQuantity.isZero()) unrealized = ZERO;
  if (canValue && !outside && marketValue != null && sideNow) {
    unrealized = sideNow === 'long' ? marketValue.minus(remainingPremium).minus(remainingFees) : remainingPremium.minus(remainingFees).minus(marketValue);
  }
  const realized = lots.reduce((sum, lot) => sum.plus(lot.withheld ? ZERO : lot.realized), ZERO);
  const calculatedAverage =
    openQuantity.gt(0) && multiplier != null && !multiplier.isZero() && sideNow
      ? remainingPremium.div(openQuantity.times(multiplier))
      : null;
  const brokerAverage = decimalOrNull(position?.averageOpenPrice);
  const averageDiffers = Boolean(calculatedAverage && brokerAverage && calculatedAverage.minus(brokerAverage).abs().gt('0.01'));
  if (averageDiffers) issues.push('The FIFO average premium differs from the brokerage average open price.');
  const quoteMissing = openQuantity.gt(0) && (quote == null || mark == null);
  const status: LedgerStatus = outside
    ? 'unreconciled'
    : missingOpening
      ? 'missing-opening'
      : blocked || lots.some((lot) => lot.withheld)
        ? 'unreconciled'
        : !feesComplete || quoteMissing || averageDiffers || cashDisagrees
          ? 'partial'
          : 'complete';
  const showMoney = !missingOpening && !outside && !blocked && !lots.some((lot) => lot.withheld);
  const parsed = parseOccSymbol(symbol);
  const expiration = position?.expiration ?? parsed?.expiration ?? null;

  return {
    symbol,
    positionId: position?.id ?? null,
    underlying: position?.underlyingSymbol ?? null,
    instrumentType: position?.instrumentType ?? rows.find((row) => row.instrumentType)?.instrumentType ?? null,
    optionRight: position?.optionRight ?? optionRightOf(symbol),
    strike: position?.strike ?? parsed?.strike ?? null,
    expiration,
    daysRemaining: daysUntil(expiration, asOf),
    multiplier: multiplier ? quantityText(multiplier) : null,
    brokerQuantity: position?.quantity ?? null,
    brokerDirection: position?.direction ?? null,
    openQuantity: quantityText(openQuantity),
    direction,
    openedAt: lots.map((lot) => lot.openedAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    originalPremium: showMoney && displayLots.length > 0 ? money(originalPremium) : null,
    entryCost: showMoney && longPremium.gt(0) ? money(longPremium.plus(longOpenFees)) : null,
    remainingPremium: showMoney ? money(remainingPremium) : null,
    remainingFees: showMoney ? money(remainingFees) : null,
    remainingBasis: showMoney ? money(sideNow === 'short' ? remainingPremium.minus(remainingFees) : remainingPremium.plus(remainingFees)) : null,
    marketValue: showMoney && marketValue != null ? money(marketValue) : showMoney && openQuantity.isZero() ? money(ZERO) : null,
    realized: showMoney ? money(realized) : null,
    unrealized: showMoney && unrealized != null ? money(unrealized) : null,
    feesComplete,
    status,
    issues: [...new Set(issues)],
    cycles: lots.map(toCycle),
    quote,
    brokerAverageOpenPrice: position?.averageOpenPrice ?? null,
    calculatedAverageOpenPrice: showMoney && calculatedAverage ? calculatedAverage.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4) : null,
    averagePriceDifference: showMoney && calculatedAverage && brokerAverage ? money(calculatedAverage.minus(brokerAverage)) : null,
  };
}

function withhold(lots: Lot[], tx: AccountingTransaction, quantity: Decimal | null, reason: string): void {
  const action = (tx.action ?? '').toLowerCase();
  let side: 'long' | 'short' | null = null;
  if (action.includes('sell to close')) side = 'long';
  else if (action.includes('buy to close')) side = 'short';
  else side = openSide(lots);
  if (quantity == null || side == null) {
    for (const lot of lots) lot.withheld = true;
    return;
  }
  const { matched, remainder } = consume(lots, side, quantity);
  if (remainder.gt(0) || matched.length === 0) {
    for (const lot of lots) lot.withheld = true;
    return;
  }
  for (const match of matched) {
    release(match.lot, match.quantity);
    match.lot.withheld = true;
    match.lot.closedAt = tx.executedAt;
    match.lot.events.push({
      id: tx.id,
      executedAt: tx.executedAt,
      action: tx.action,
      classification: tx.classification,
      quantity: quantityText(match.quantity),
      cash: null,
      cashDirection: null,
      note: reason,
    });
  }
}

function toEvent(tx: AccountingTransaction, quantity: Decimal, cash: { amount: Decimal; direction: 'in' | 'out' | 'none' }, note: string): LedgerEvent {
  return {
    id: tx.id,
    executedAt: tx.executedAt,
    action: tx.action,
    classification: tx.classification,
    quantity: quantityText(quantity),
    cash: money(cash.amount),
    cashDirection: cash.direction,
    note,
  };
}

function toCycle(lot: Lot): OptionCycle {
  const closed = lot.openQuantity.isZero();
  return {
    openingTransactionId: lot.openingTransactionId,
    symbol: lot.symbol,
    side: lot.side,
    openedAt: lot.openedAt,
    closedAt: closed ? lot.closedAt : null,
    originalQuantity: quantityText(lot.originalQuantity),
    openQuantity: quantityText(lot.openQuantity),
    openingCash: money(lot.originalPremium),
    closingCash: money(lot.closingCash),
    remainingPremium: money(lot.remainingPremium),
    remainingFees: money(lot.remainingFees),
    openingFees: money(lot.originalFees),
    fees: money(lot.originalFees.plus(lot.closeFees)),
    feesComplete: lot.feesComplete,
    realized: lot.withheld ? null : money(lot.realized),
    status: lot.withheld ? 'unreconciled' : closed ? 'closed' : 'open',
    events: lot.events,
  };
}

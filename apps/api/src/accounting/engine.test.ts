import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { reconstructPortfolio, type AccountingPosition, type AccountingQuote, type AccountingTransaction } from './engine.js';
import { strategyPerformance, suggestPairings } from './strategy.js';

const fees = { clearing: '0.00', regulatory: '0.00', proprietary: '0.00', other: '0.00' };
const asOf = '2026-10-15T20:00:00.000Z';
const longSymbol = 'ZZT   280121C00155000';
const shortSymbol = 'ZZT   261030C00227500';

function transaction(overrides: Partial<AccountingTransaction> = {}): AccountingTransaction {
  return {
    id: '1',
    symbol: longSymbol,
    instrumentType: 'Equity Option',
    action: 'Buy to Open',
    quantity: '1',
    price: '20',
    executedAt: '2026-01-02T15:00:00.000Z',
    grossValue: '2000.00',
    valueEffect: 'Debit',
    commission: '0.00',
    fees,
    classification: 'trade',
    transactionType: 'Trade',
    transactionSubtype: 'Buy to Open',
    ...overrides,
  };
}

function position(overrides: Partial<AccountingPosition> = {}): AccountingPosition {
  return {
    id: 'pos-long',
    providerSymbol: longSymbol,
    underlyingSymbol: 'ZZT',
    instrumentType: 'Equity Option',
    quantity: '1',
    direction: 'long',
    strike: '155',
    expiration: '2028-01-21',
    averageOpenPrice: '20',
    multiplier: '100',
    optionRight: 'call',
    ...overrides,
  };
}

function quote(symbol: string, mark: string, extras: Partial<AccountingQuote> = {}): AccountingQuote {
  return {
    symbol,
    bid: mark,
    ask: mark,
    mid: mark,
    mark,
    quoteAsOf: '2026-10-15T15:00:00.000Z',
    fetchedAt: '2026-10-15T15:00:01.000Z',
    freshness: 'fresh',
    entitlement: 'entitled',
    ...extras,
  };
}

function book(transactions: AccountingTransaction[], positions: AccountingPosition[], quotes: AccountingQuote[] = []) {
  return reconstructPortfolio({ transactions, positions, quotes, asOf });
}

describe('options accounting', () => {
  it('keeps a long LEAPS debit unrealized until it is sold', () => {
    const result = book(
      [transaction({ commission: '1.00' })],
      [position()],
      [quote(longSymbol, '25')],
    );
    const ledger = result.symbols[0];
    expect(ledger?.status).toBe('complete');
    expect(ledger?.originalPremium).toBe('2000.00');
    expect(ledger?.entryCost).toBe('2001.00');
    expect(ledger?.remainingBasis).toBe('2001.00');
    expect(ledger?.marketValue).toBe('2500.00');
    expect(ledger?.unrealized).toBe('499.00');
    expect(ledger?.realized).toBe('0.00');
    expect(ledger?.calculatedAverageOpenPrice).toBe('20.0000');
    expect(ledger?.averagePriceDifference).toBe('0.00');
    expect(ledger?.daysRemaining).toBe(463);
  });

  it('matches a partial close to the FIFO lot and keeps the remainder', () => {
    const result = book(
      [
        transaction({ id: 'open', quantity: '2', grossValue: '4000.00', commission: '2.00' }),
        transaction({
          id: 'close',
          action: 'Sell to Close',
          transactionSubtype: 'Sell to Close',
          quantity: '1',
          grossValue: '2500.00',
          valueEffect: 'Credit',
          commission: '1.00',
          executedAt: '2026-06-01T15:00:00.000Z',
        }),
      ],
      [position({ quantity: '1', averageOpenPrice: '20' })],
      [quote(longSymbol, '22')],
    );
    const ledger = result.symbols[0];
    expect(ledger?.openQuantity).toBe('1');
    expect(ledger?.realized).toBe('498.00');
    expect(ledger?.remainingBasis).toBe('2001.00');
    expect(ledger?.unrealized).toBe('199.00');
    expect(ledger?.cycles[0]?.originalQuantity).toBe('2');
  });

  it('does not realize short premium until the buy-to-close', () => {
    const opened = book(
      [transaction({ id: 'sto', symbol: shortSymbol, action: 'Sell to Open', transactionSubtype: 'Sell to Open', grossValue: '150.00', valueEffect: 'Credit', commission: '1.00' })],
      [position({ id: 'pos-short', providerSymbol: shortSymbol, direction: 'short', strike: '227.5', expiration: '2026-10-30', averageOpenPrice: '1.5' })],
      [quote(shortSymbol, '0.50')],
    );
    expect(opened.symbols[0]?.realized).toBe('0.00');
    expect(opened.symbols[0]?.unrealized).toBe('99.00');
    expect(opened.symbols[0]?.remainingBasis).toBe('149.00');

    const closed = book(
      [
        transaction({ id: 'sto', symbol: shortSymbol, action: 'Sell to Open', transactionSubtype: 'Sell to Open', grossValue: '150.00', valueEffect: 'Credit', commission: '1.00' }),
        transaction({
          id: 'btc',
          symbol: shortSymbol,
          action: 'Buy to Close',
          transactionSubtype: 'Buy to Close',
          grossValue: '40.00',
          valueEffect: 'Debit',
          commission: '1.00',
          executedAt: '2026-06-02T15:00:00.000Z',
        }),
      ],
      [],
      [],
    );
    expect(closed.symbols[0]?.realized).toBe('108.00');
    expect(closed.symbols[0]?.unrealized).toBe('0.00');
    expect(closed.symbols[0]?.openQuantity).toBe('0');
  });

  it('realizes an explicit worthless expiration and withholds an assignment', () => {
    const expired = book(
      [
        transaction({ id: 'sto', symbol: shortSymbol, action: 'Sell to Open', transactionSubtype: 'Sell to Open', grossValue: '100.00', valueEffect: 'Credit', commission: '1.00' }),
        transaction({
          id: 'exp',
          symbol: shortSymbol,
          action: 'Buy to Close',
          classification: 'expiration',
          transactionType: 'Receive Deliver',
          transactionSubtype: 'Expiration',
          grossValue: '0.00',
          valueEffect: 'Debit',
          commission: '0.00',
          executedAt: '2026-10-30T20:00:00.000Z',
        }),
      ],
      [],
      [],
    );
    expect(expired.symbols[0]?.realized).toBe('99.00');
    expect(expired.symbols[0]?.status).toBe('complete');

    const assigned = book(
      [
        transaction({ id: 'sto', symbol: shortSymbol, action: 'Sell to Open', transactionSubtype: 'Sell to Open', grossValue: '100.00', valueEffect: 'Credit' }),
        transaction({
          id: 'assign',
          symbol: shortSymbol,
          action: '',
          classification: 'assignment',
          transactionType: 'Receive Deliver',
          transactionSubtype: 'Assignment',
          grossValue: null,
          valueEffect: null,
          executedAt: '2026-10-20T20:00:00.000Z',
        }),
      ],
      [],
      [],
    );
    expect(assigned.symbols[0]?.realized).toBeNull();
    expect(assigned.symbols[0]?.status).toBe('unreconciled');
    expect(assigned.symbols[0]?.cycles[0]?.status).toBe('unreconciled');
  });

  it('keeps consecutive short cycles and a roll as separate FIFO results', () => {
    const cycles = book(
      [
        transaction({ id: 'a', symbol: shortSymbol, action: 'Sell to Open', grossValue: '100.00', valueEffect: 'Credit', executedAt: '2026-03-01T15:00:00.000Z' }),
        transaction({ id: 'b', symbol: shortSymbol, action: 'Buy to Close', grossValue: '20.00', valueEffect: 'Debit', executedAt: '2026-04-01T15:00:00.000Z' }),
        transaction({ id: 'c', symbol: shortSymbol, action: 'Sell to Open', grossValue: '80.00', valueEffect: 'Credit', executedAt: '2026-04-02T15:00:00.000Z' }),
      ],
      [position({ id: 'pos-short', providerSymbol: shortSymbol, direction: 'short', expiration: '2026-10-30', strike: '227.5', averageOpenPrice: '0.8' })],
      [quote(shortSymbol, '0.30')],
    );
    const ledger = cycles.symbols[0];
    expect(ledger?.cycles).toHaveLength(2);
    expect(ledger?.cycles[0]?.status).toBe('closed');
    expect(ledger?.cycles[0]?.realized).toBe('80.00');
    expect(ledger?.cycles[1]?.status).toBe('open');
    expect(ledger?.realized).toBe('80.00');
    expect(ledger?.unrealized).toBe('50.00');

    const roll = book(
      [
        transaction({ id: 'open1', symbol: shortSymbol, action: 'Sell to Open', grossValue: '100.00', valueEffect: 'Credit' }),
        transaction({ id: 'close1', symbol: shortSymbol, action: 'Buy to Close', grossValue: '40.00', valueEffect: 'Debit', executedAt: '2026-05-01T15:00:00.000Z' }),
        transaction({ id: 'open2', symbol: shortSymbol, action: 'Sell to Open', grossValue: '90.00', valueEffect: 'Credit', executedAt: '2026-05-01T15:01:00.000Z' }),
      ],
      [position({ id: 'pos-short', providerSymbol: shortSymbol, direction: 'short', expiration: '2026-11-20', strike: '230', averageOpenPrice: '0.9' })],
      [quote(shortSymbol, '0.90')],
    );
    expect(roll.symbols[0]?.realized).toBe('60.00');
    expect(roll.symbols[0]?.cycles[1]?.openingCash).toBe('90.00');
    expect(roll.symbols[0]?.unrealized).toBe('0.00');
  });

  it('uses FIFO for multiple lots, partial fills, and a nonstandard multiplier', () => {
    const lots = book(
      [
        transaction({ id: 'a', grossValue: '1000.00', executedAt: '2026-01-01T15:00:00.000Z' }),
        transaction({ id: 'b', grossValue: '1200.00', executedAt: '2026-01-03T15:00:00.000Z' }),
        transaction({ id: 'c', action: 'Sell to Close', grossValue: '1500.00', valueEffect: 'Credit', executedAt: '2026-02-01T15:00:00.000Z' }),
      ],
      [position({ quantity: '1', averageOpenPrice: '12' })],
      [quote(longSymbol, '12')],
    );
    expect(lots.symbols[0]?.realized).toBe('500.00');
    expect(lots.symbols[0]?.remainingBasis).toBe('1200.00');
    expect(lots.symbols[0]?.cycles[0]?.status).toBe('closed');
    expect(lots.symbols[0]?.cycles[1]?.status).toBe('open');

    const partial = book(
      [
        transaction({ id: 'p1', quantity: '0.5', grossValue: '1000.00' }),
        transaction({ id: 'p2', quantity: '0.5', grossValue: '1100.00', executedAt: '2026-01-04T15:00:00.000Z' }),
      ],
      [position({ quantity: '1', averageOpenPrice: '21' })],
      [quote(longSymbol, '21')],
    );
    expect(partial.symbols[0]?.openQuantity).toBe('1');
    expect(partial.symbols[0]?.originalPremium).toBe('2100.00');

    const custom = book(
      [transaction({ quantity: '2', price: '3', grossValue: '60.00' })],
      [position({ quantity: '2', multiplier: '10', averageOpenPrice: '3' })],
      [quote(longSymbol, '4')],
    );
    expect(custom.symbols[0]?.multiplier).toBe('10');
    expect(custom.symbols[0]?.calculatedAverageOpenPrice).toBe('3.0000');
    expect(custom.symbols[0]?.marketValue).toBe('80.00');
    expect(custom.symbols[0]?.unrealized).toBe('20.00');
  });

  it('withholds missing openings, transfers, unknown fees, missing marks, and cash movements', () => {
    const missing = book([], [position()], []);
    expect(missing.symbols[0]?.status).toBe('missing-opening');
    expect(missing.symbols[0]?.realized).toBeNull();
    expect(missing.symbols[0]?.unrealized).toBeNull();

    const transfer = book(
      [
        transaction(),
        transaction({
          id: 'xfer',
          action: 'Sell to Open',
          classification: 'transfer',
          transactionType: 'Receive Deliver',
          transactionSubtype: 'Sell to Open',
          grossValue: null,
          executedAt: '2026-03-01T15:00:00.000Z',
        }),
      ],
      [position()],
      [quote(longSymbol, '25')],
    );
    expect(transfer.symbols[0]?.status).toBe('unreconciled');
    expect(transfer.symbols[0]?.realized).toBeNull();

    const unreported = book([transaction({ commission: null })], [position()], [quote(longSymbol, '25')]);
    expect(unreported.symbols[0]?.feesComplete).toBe(false);
    expect(unreported.symbols[0]?.status).toBe('partial');
    expect(unreported.symbols[0]?.issues.some((issue) => issue.includes('commission') && issue.includes('not treated as zero'))).toBe(true);

    const noQuote = book([transaction()], [position()], []);
    expect(noQuote.symbols[0]?.unrealized).toBeNull();
    expect(noQuote.symbols[0]?.status).toBe('partial');

    const source = transaction();
    const withCash = book(
      [source, transaction({ id: 'cash', symbol: null, classification: 'unsupported', transactionType: 'Money Movement', transactionSubtype: 'Deposit', action: '', grossValue: '5000.00', valueEffect: 'Credit' })],
      [position()],
      [quote(longSymbol, '25')],
    );
    expect(withCash.excludedCashEvents).toBe(1);
    expect(withCash.symbols[0]?.unrealized).toBe('500.00');
    expect(source.grossValue).toBe('2000.00');
    const again = book([source], [position()], [quote(longSymbol, '25')]);
    expect(again.symbols[0]?.unrealized).toBe(withCash.symbols[0]?.unrealized);
  });

  it('suggests one PMCC without saving it and reconciles the combined total', () => {
    const longTx = transaction({ commission: '0.00' });
    const shortTx = transaction({
      id: 'short',
      symbol: shortSymbol,
      action: 'Sell to Open',
      transactionSubtype: 'Sell to Open',
      grossValue: '150.00',
      valueEffect: 'Credit',
      executedAt: '2026-09-01T15:00:00.000Z',
    });
    const result = book(
      [longTx, shortTx],
      [
        position(),
        position({ id: 'pos-short', providerSymbol: shortSymbol, direction: 'short', strike: '227.5', expiration: '2026-10-30', averageOpenPrice: '1.5' }),
      ],
      [quote(longSymbol, '25'), quote(shortSymbol, '0.40')],
    );
    const suggestions = suggestPairings(result.symbols);
    expect(suggestions).toEqual([
      {
        underlying: 'ZZT',
        longSymbol,
        shortSymbol,
        ambiguous: false,
        reason: 'One long call expires after this short call and has enough quantity. It is not saved until you confirm it.',
      },
    ]);
    const long = result.symbols.find((symbol) => symbol.symbol === longSymbol);
    const short = result.symbols.find((symbol) => symbol.symbol === shortSymbol);
    const cycle = short?.cycles[0];
    if (!long || !short || !cycle) throw new Error('expected both ledgers');
    const strategy = strategyPerformance(long, [{ ledger: short, cycle }]);
    expect(strategy.longUnrealized).toBe('500.00');
    expect(strategy.shortRealized).toBe('0.00');
    expect(strategy.shortOpenLiability).toBe('40.00');
    expect(strategy.initialNetDebit).toBe('1850.00');
    expect(strategy.capitalAtRisk).toBe('1850.00');
    expect(strategy.combined).toBe('610.00');
    expect(strategy.complete).toBe(true);
    expect(new Decimal(strategy.realized ?? 0).plus(strategy.unrealized ?? 0).toFixed(2)).toBe('610.00');
    expect(new Decimal(strategy.combined ?? 0).plus('150.00').toFixed(2)).not.toBe(strategy.combined);

    const ambiguous = suggestPairings([
      long,
      { ...long, symbol: 'ZZT   280121C00160000', positionId: 'other' },
      short,
    ]);
    expect(ambiguous.every((item) => item.ambiguous)).toBe(true);
  });

  it('reduces a short credit by known opening fees and keeps the combined result qualified', () => {
    const longFees = { clearing: '0.10', regulatory: '0.02', proprietary: '0.00', other: null };
    const shortFees = { clearing: '0.10', regulatory: '0.03', proprietary: '0.00', other: null };
    const result = book(
      [
        transaction({
          commission: '1.00',
          fees: longFees,
          grossValue: '6300.00',
          price: '63',
          netValue: '6301.12',
          netValueEffect: 'Debit',
          feesEstimated: true,
        }),
        transaction({
          id: 'sto',
          symbol: shortSymbol,
          action: 'Sell to Open',
          transactionSubtype: 'Sell to Open',
          grossValue: '188.00',
          valueEffect: 'Credit',
          price: '1.88',
          commission: '1.00',
          fees: shortFees,
          netValue: '186.87',
          netValueEffect: 'Credit',
          feesEstimated: true,
          executedAt: '2026-10-13T14:29:55.000Z',
        }),
      ],
      [
        position({ averageOpenPrice: '63' }),
        position({ id: 'pos-short', providerSymbol: shortSymbol, direction: 'short', strike: '227.5', expiration: '2026-10-30', averageOpenPrice: '1.88' }),
      ],
      [quote(longSymbol, '69.35'), quote(shortSymbol, '2.505')],
    );
    const long = result.symbols.find((symbol) => symbol.symbol === longSymbol);
    const short = result.symbols.find((symbol) => symbol.symbol === shortSymbol);
    const cycle = short?.cycles[0];
    expect(long?.originalPremium).toBe('6300.00');
    expect(long?.entryCost).toBe('6301.12');
    expect(long?.remainingBasis).toBe('6301.12');
    expect(long?.unrealized).toBe('633.88');
    expect(short?.originalPremium).toBe('188.00');
    expect(short?.remainingBasis).toBe('186.87');
    expect(short?.unrealized).toBe('-63.63');
    expect(short?.status).toBe('partial');
    expect(short?.issues.some((issue) => issue.includes('other-charge'))).toBe(true);
    expect(short?.issues.some((issue) => issue.includes('estimated'))).toBe(true);
    if (!long || !short || !cycle) throw new Error('expected both ledgers');
    const strategy = strategyPerformance(long, [{ ledger: short, cycle }]);
    expect(strategy.initialNetDebit).toBe('6114.25');
    expect(strategy.capitalAtRisk).toBe('6114.25');
    expect(strategy.combined).toBe('570.25');
    expect(strategy.complete).toBe(false);
    expect(strategy.capitalExplanation.toLowerCase()).not.toContain('maximum');
    expect(strategy.capitalExplanation).toContain('qualified');
  });
});

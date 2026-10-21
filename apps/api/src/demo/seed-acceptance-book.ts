import { randomUUID } from 'node:crypto';
import { accountFingerprint, rememberImportFingerprint } from '../brokerage/connection.js';
import { writeMeta } from '../db/meta.js';
import { brokerAccounts, brokerPositions, brokerTransactions, quoteSnapshots, settings } from '../db/schema.js';
import type { AppDatabase } from '../db/client.js';
import { confirmStrategy } from '../accounting/portfolio.js';
import { createSavedIdea } from '../finder/saved-ideas.js';

const longSymbol = 'ZZT   280121C00155000';
const shortSymbol = 'ZZT   261030C00227500';
const standaloneLong = 'QQQ   280121C00300000';
const standaloneShort = 'SPY   261218C00450000';
const closedNear = 'ZZT   260402C00210000';
const closedFar = 'ZZT   260116C00180000';

/** Fictional brokerage book for visual acceptance. Does not call a provider. */
export function seedAcceptanceBook(db: AppDatabase): void {
  const accountId = randomUUID();
  const accountNumber = 'ZZQA000111';
  const fees = JSON.stringify({
    'clearing-fees': '0.00',
    'regulatory-fees': '0.00',
    'proprietary-index-option-fees': '0.00',
    'other-fees': '0.00',
  });
  const now = '2026-10-15T20:00:00.000Z';
  db.insert(brokerAccounts).values({
    id: accountId,
    provider: 'tastytrade',
    accountNumber,
    accountType: 'Individual',
    authority: 'owner',
    maskedLabel: '••••0111',
    selected: true,
    transactionHistoryStatus: 'complete',
    historyCoverageStart: '2025-10-15',
    historyCoverageEnd: '2026-10-15',
    discoveredAt: now,
  }).run();
  db.insert(brokerPositions).values([
    position(accountId, longSymbol, 'ZZT', '1', 'long', '155', '2028-01-21', '20', now),
    position(accountId, shortSymbol, 'ZZT', '1', 'short', '227.5', '2026-10-30', '1.5', now),
    position(accountId, standaloneLong, 'QQQ', '1', 'long', '300', '2028-01-21', '18', now),
    position(accountId, standaloneShort, 'SPY', '1', 'short', '450', '2026-12-18', '2.2', now),
  ]).run();
  db.insert(brokerTransactions).values([
    trade(accountId, '501', longSymbol, 'Buy to Open', '1', '20', '2000.00', 'Debit', '2026-09-08T14:58:45.000Z', fees),
    trade(accountId, '502', shortSymbol, 'Sell to Open', '1', '1.5', '150.00', 'Credit', '2026-10-13T14:29:55.000Z', fees),
    trade(accountId, '601', standaloneLong, 'Buy to Open', '1', '18', '1800.00', 'Debit', '2026-08-01T15:00:00.000Z', fees),
    trade(accountId, '602', standaloneShort, 'Sell to Open', '1', '2.2', '220.00', 'Credit', '2026-09-15T15:00:00.000Z', fees),
    trade(accountId, '701', closedNear, 'Buy to Open', '1', '4', '400.00', 'Debit', '2026-01-10T15:00:00.000Z', fees),
    trade(accountId, '702', closedNear, 'Sell to Close', '1', '1', '100.00', 'Credit', '2026-03-20T15:00:00.000Z', fees),
    trade(accountId, '703', closedFar, 'Buy to Open', '1', '6', '600.00', 'Debit', '2025-11-01T15:00:00.000Z', fees),
    trade(accountId, '704', closedFar, 'Sell to Close', '1', '0.5', '50.00', 'Credit', '2026-01-05T15:00:00.000Z', fees),
    {
      id: randomUUID(),
      brokerAccountId: accountId,
      providerTransactionId: '503',
      symbol: 'AMD',
      instrumentType: 'Equity',
      action: 'Sell to Open',
      quantity: '1',
      price: null,
      executedAt: '2026-03-01T15:00:00.000Z',
      grossValue: null,
      valueEffect: null,
      commission: null,
      feesJson: '{}',
      transactionType: 'Receive Deliver',
      transactionSubtype: 'Sell to Open',
      classification: 'transfer',
      rawJson: '{"id":"503"}',
    },
  ]).run();
  db.insert(quoteSnapshots).values([
    quote(longSymbol, '67.70', '71.00', '69.35', now),
    quote(shortSymbol, '2.28', '2.73', '2.51', now),
  ]).run();
  confirmStrategy(db, accountId, {
    underlying: 'ZZT',
    longSymbol,
    shortCycles: [{ providerSymbol: shortSymbol, openingTransactionId: '502' }],
  }, new Date('2026-10-21T15:00:00.000Z'));
  createSavedIdea(db, { underlying: 'QQQ', longOcc: standaloneLong, quoteAsOf: now, notes: 'Hypothetical long call. Not a holding.' });
  createSavedIdea(db, {
    underlying: 'ZZT',
    longOcc: longSymbol,
    shortOcc: shortSymbol,
    quoteAsOf: now,
    notes: 'Hypothetical pair. Not a holding.',
  });
  db.update(settings).set({ portfolioView: 'brokerage', updatedAt: now }).run();
  writeMeta(db, 'broker.selected.account', accountNumber);
  writeMeta(db, 'broker.selected.environment', 'production');
  writeMeta(db, 'broker.account.choices', JSON.stringify([
    { choiceId: 'aaaaaaaaaaaaaaaa', maskedAccount: '••••0111', accountType: 'Individual' },
    { choiceId: 'bbbbbbbbbbbbbbbb', maskedAccount: '••••0222', accountType: 'IRA' },
  ]));
  rememberImportFingerprint(db, accountFingerprint('production', [accountNumber]));
}

function position(
  accountId: string,
  symbol: string,
  underlying: string,
  quantity: string,
  direction: string,
  strike: string,
  expiration: string,
  averageOpenPrice: string,
  syncedAt: string,
) {
  return {
    id: randomUUID(),
    brokerAccountId: accountId,
    providerSymbol: symbol,
    underlyingSymbol: underlying,
    optionSymbol: symbol,
    instrumentType: 'Equity Option',
    quantity,
    direction,
    strike,
    expiration,
    averageOpenPrice,
    multiplier: '100',
    reportedMark: null,
    status: 'open',
    syncedAt,
    rawJson: '{}',
  };
}

function trade(
  accountId: string,
  providerTransactionId: string,
  symbol: string,
  action: string,
  quantity: string,
  price: string,
  grossValue: string,
  valueEffect: string,
  executedAt: string,
  feesJson: string,
) {
  return {
    id: randomUUID(),
    brokerAccountId: accountId,
    providerTransactionId,
    symbol,
    instrumentType: 'Equity Option',
    action,
    quantity,
    price,
    executedAt,
    grossValue,
    valueEffect,
    commission: '0.00',
    feesJson,
    transactionType: 'Trade',
    transactionSubtype: action,
    classification: 'trade',
    rawJson: JSON.stringify({ id: providerTransactionId }),
  };
}

function quote(symbol: string, bid: string, ask: string, mark: string, fetchedAt: string) {
  return {
    id: randomUUID(),
    symbol,
    instrumentType: 'Equity Option',
    bid,
    ask,
    mid: null,
    mark,
    lastPrice: null,
    quoteAsOf: '2026-10-15T20:03:54.000Z',
    fetchedAt,
    freshness: 'closed_session',
    entitlement: 'entitled',
    source: 'tastytrade',
    message: 'Brokerage quote snapshot.',
  };
}

if (process.argv[1]?.includes('seed-acceptance-book')) {
  const { openDatabase } = await import('../db/client.js');
  const opened = openDatabase(process.env.DATABASE_PATH ?? '/data/optionscout.sqlite');
  seedAcceptanceBook(opened.db);
  opened.close();
}

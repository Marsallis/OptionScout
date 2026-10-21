import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPortfolio, confirmStrategy } from '../accounting/portfolio.js';
import { openDatabase, type OpenedDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { brokerAccounts, brokerPositions, brokerTransactions } from '../db/schema.js';

const longSymbol = 'CVX   280121C00155000';
const closedShort = 'CVX   261030C00227500';
const openShort = 'CVX   261106C00235000';

const databases: OpenedDatabase[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const opened of databases.splice(0)) opened.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('stale confirmed PMCC', () => {
  it('keeps the closed short out of the open book and does not assign the new short', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-stale-pmcc-'));
    directories.push(directory);
    const opened = openDatabase(path.join(directory, 'optionscout.sqlite'));
    databases.push(opened);
    applyMigrations(opened.sqlite, migrationsDirectory());
    const accountId = randomUUID();
    const fees = JSON.stringify({ 'clearing-fees': '0.00', 'regulatory-fees': '0.00', 'proprietary-index-option-fees': '0.00', 'other-fees': '0.00' });
    const now = '2026-10-21T20:00:00.000Z';
    opened.db.insert(brokerAccounts).values({
      id: accountId,
      provider: 'tastytrade',
      accountNumber: 'ZZQA000111',
      accountType: 'Individual',
      authority: 'owner',
      maskedLabel: '••••0111',
      selected: true,
      transactionHistoryStatus: 'complete',
      historyCoverageStart: '2026-09-01',
      historyCoverageEnd: '2026-10-21',
      discoveredAt: now,
    }).run();
    opened.db.insert(brokerPositions).values([
      position(accountId, longSymbol, '1', 'long', '155', '2028-01-21', now),
      position(accountId, closedShort, '1', 'short', '227.5', '2026-10-30', now),
      position(accountId, openShort, '1', 'short', '235', '2026-11-06', now),
    ]).run();
    opened.db.insert(brokerTransactions).values([
      trade(accountId, '1', longSymbol, 'Buy to Open', '2026-09-08T14:58:45.000Z', fees),
      trade(accountId, '2', closedShort, 'Sell to Open', '2026-10-13T14:29:55.000Z', fees),
      trade(accountId, '3', closedShort, 'Buy to Close', '2026-10-20T14:23:34.000Z', fees),
      trade(accountId, '4', openShort, 'Sell to Open', '2026-10-20T14:23:34.000Z', fees),
    ]).run();
    const before = opened.sqlite.prepare('SELECT provider_transaction_id FROM broker_transactions ORDER BY provider_transaction_id').all();
    confirmStrategy(opened.db, accountId, {
      underlying: 'CVX',
      longSymbol,
      shortCycles: [{ providerSymbol: closedShort, openingTransactionId: '2' }],
    }, new Date('2026-10-21T15:00:00.000Z'));
    const portfolio = buildPortfolio(opened.db, accountId, new Date('2026-10-21T15:00:00.000Z'));
    const open = portfolio.positions.filter((position) => position.direction !== 'flat');
    expect(open.map((position) => position.symbol).sort()).toEqual([longSymbol, openShort].sort());
    expect(portfolio.positions.find((position) => position.symbol === closedShort)?.direction).toBe('flat');
    expect(portfolio.strategies).toHaveLength(1);
    expect(portfolio.strategies[0]?.performance.shortSymbols).toEqual([closedShort]);
    expect(portfolio.suggestions.map((suggestion) => suggestion.shortSymbol)).toEqual([openShort]);
    expect(opened.sqlite.prepare('SELECT provider_symbol FROM strategy_members').all()).toEqual([{ provider_symbol: closedShort }]);
    expect(opened.sqlite.prepare('SELECT provider_transaction_id FROM broker_transactions ORDER BY provider_transaction_id').all()).toEqual(before);
  });
});

function position(accountId: string, symbol: string, quantity: string, direction: string, strike: string, expiration: string, syncedAt: string) {
  return {
    id: randomUUID(),
    brokerAccountId: accountId,
    providerSymbol: symbol,
    underlyingSymbol: 'CVX',
    optionSymbol: symbol,
    instrumentType: 'Equity Option',
    quantity,
    direction,
    strike,
    expiration,
    averageOpenPrice: '1',
    multiplier: '100',
    reportedMark: null,
    status: 'open',
    syncedAt,
    rawJson: '{}',
  };
}

function trade(accountId: string, providerTransactionId: string, symbol: string, action: string, executedAt: string, feesJson: string) {
  const credit = action.startsWith('Sell');
  return {
    id: randomUUID(),
    brokerAccountId: accountId,
    providerTransactionId,
    symbol,
    instrumentType: 'Equity Option',
    action,
    quantity: '1',
    price: '1',
    executedAt,
    grossValue: '100.00',
    valueEffect: credit ? 'Credit' : 'Debit',
    commission: '0.00',
    feesJson,
    transactionType: 'Trade',
    transactionSubtype: action,
    classification: 'trade',
    rawJson: JSON.stringify({ id: providerTransactionId }),
  };
}

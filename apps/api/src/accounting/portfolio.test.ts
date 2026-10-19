import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { portfolioSchema } from '@optionscout/shared';
import { createApp } from '../app.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { brokerAccounts, brokerPositions, brokerTransactions, quoteSnapshots } from '../db/schema.js';
import { buildPortfolio, confirmStrategy } from './portfolio.js';

const contexts: AppContext[] = [];
const directories: string[] = [];
const longSymbol = 'CVX   280121C00155000';
const shortSymbol = 'CVX   261030C00227500';

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function opened(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-1c-'));
  directories.push(directory);
  const context = await openAppContext(
    parseConfig(
      {
        NODE_ENV: 'test',
        PORT: '3180',
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: path.join(directory, 'optionscout.sqlite'),
        DATA_MODE: 'demo',
        AUTH_MODE: 'local-owner',
        ENABLE_ORDER_EXECUTION: 'false',
        TELEMETRY_ENABLED: 'false',
        RUNNING_IN_DOCKER: 'false',
        STATIC_DIR: '',
      },
      { secretFilePath: path.join(directory, 'missing.env') },
    ),
  );
  contexts.push(context);
  return context;
}

describe('brokerage portfolio', () => {
  it('requires a session and calculates without changing source transactions', async () => {
    const context = await opened();
    const app = createApp(context);
    expect((await request(app).get('/api/broker/portfolio')).status).toBe(401);
    expect((await request(app).post('/api/orders').send({})).status).toBe(404);

    const accountId = randomUUID();
    const longId = randomUUID();
    const shortId = randomUUID();
    context.database.db.insert(brokerAccounts).values({
      id: accountId,
      provider: 'tastytrade',
      accountNumber: '5WX99991',
      accountType: 'Individual',
      authority: 'owner',
      maskedLabel: '••••9991',
      selected: true,
      transactionHistoryStatus: 'complete',
      historyCoverageStart: '2025-10-15',
      historyCoverageEnd: '2026-10-15',
      discoveredAt: '2026-10-15T20:00:00.000Z',
    }).run();
    const fees = JSON.stringify({ 'clearing-fees': '0.00', 'regulatory-fees': '0.00', 'proprietary-index-option-fees': '0.00', 'other-fees': '0.00' });
    context.database.db.insert(brokerPositions).values([
      {
        id: longId,
        brokerAccountId: accountId,
        providerSymbol: longSymbol,
        underlyingSymbol: 'CVX',
        optionSymbol: longSymbol,
        instrumentType: 'Equity Option',
        quantity: '1',
        direction: 'long',
        strike: '155',
        expiration: '2028-01-21',
        averageOpenPrice: '20',
        multiplier: '100',
        reportedMark: null,
        status: 'open',
        syncedAt: '2026-10-15T20:00:00.000Z',
        rawJson: '{}',
      },
      {
        id: shortId,
        brokerAccountId: accountId,
        providerSymbol: shortSymbol,
        underlyingSymbol: 'CVX',
        optionSymbol: shortSymbol,
        instrumentType: 'Equity Option',
        quantity: '1',
        direction: 'short',
        strike: '227.5',
        expiration: '2026-10-30',
        averageOpenPrice: '1.5',
        multiplier: '100',
        reportedMark: null,
        status: 'open',
        syncedAt: '2026-10-15T20:00:00.000Z',
        rawJson: '{}',
      },
    ]).run();
    context.database.db.insert(brokerTransactions).values([
      {
        id: randomUUID(),
        brokerAccountId: accountId,
        providerTransactionId: '501',
        symbol: longSymbol,
        instrumentType: 'Equity Option',
        action: 'Buy to Open',
        quantity: '1',
        price: '20',
        executedAt: '2026-09-08T14:58:45.000Z',
        grossValue: '2000.00',
        valueEffect: 'Debit',
        commission: '0.00',
        feesJson: fees,
        transactionType: 'Trade',
        transactionSubtype: 'Buy to Open',
        classification: 'trade',
        rawJson: '{"id":"501"}',
      },
      {
        id: randomUUID(),
        brokerAccountId: accountId,
        providerTransactionId: '502',
        symbol: shortSymbol,
        instrumentType: 'Equity Option',
        action: 'Sell to Open',
        quantity: '1',
        price: '1.5',
        executedAt: '2026-10-13T14:29:55.000Z',
        grossValue: '150.00',
        valueEffect: 'Credit',
        commission: '0.00',
        feesJson: fees,
        transactionType: 'Trade',
        transactionSubtype: 'Sell to Open',
        classification: 'trade',
        rawJson: '{"id":"502"}',
      },
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
    const fetchedAt = '2026-10-15T20:09:44.000Z';
    context.database.db.insert(quoteSnapshots).values([
      snapshot(longSymbol, '67.70', '71.00', '69.35', fetchedAt),
      snapshot(shortSymbol, '2.28', '2.73', '2.51', fetchedAt),
    ]).run();

    const before = context.database.sqlite.prepare('SELECT raw_json, provider_transaction_id FROM broker_transactions ORDER BY provider_transaction_id').all();
    const portfolio = portfolioSchema.parse(buildPortfolio(context.database.db, accountId, new Date('2026-10-15T20:10:00.000Z')));
    expect(portfolio.demo).toBe(false);
    expect(portfolio.health.missingOpenings).toBe(0);
    expect(portfolio.history.accountingComplete).toBe(false);
    expect(portfolio.suggestions).toHaveLength(1);
    expect(portfolio.suggestions[0]?.ambiguous).toBe(false);
    const long = portfolio.positions.find((position) => position.id === longId);
    expect(long?.originalPremium).toBe('2000.00');
    expect(long?.realized).toBe('0.00');
    expect(long?.quoteFreshness).toBe('closed_session');
    expect(JSON.stringify(portfolio)).not.toContain('5WX99991');
    const transfer = portfolio.positions.find((position) => position.symbol === 'AMD');
    expect(transfer?.status).toBe('unreconciled');
    expect(transfer?.realized).toBeNull();

    const confirmed = confirmStrategy(context.database.db, accountId, {
      underlying: 'CVX',
      longSymbol,
      shortCycles: [{ providerSymbol: shortSymbol, openingTransactionId: '502' }],
    }, new Date('2026-10-15T20:10:00.000Z'));
    expect(confirmed.strategies).toHaveLength(1);
    expect(confirmed.strategies[0]?.performance.shortRealized).toBe('0.00');
    expect(confirmed.strategies[0]?.performance.combined).not.toBeNull();
    const after = context.database.sqlite.prepare('SELECT raw_json, provider_transaction_id FROM broker_transactions ORDER BY provider_transaction_id').all();
    expect(after).toEqual(before);
    const demoCount = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    expect(demoCount.count).toBe(10);
  });
});

function snapshot(symbol: string, bid: string, ask: string, mark: string, fetchedAt: string) {
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

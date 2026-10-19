import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { parseBrokerJson } from './decimals.js';
import { canonicalProviderTransactionId, normalizeTransaction } from './normalize.js';
import { TastytradeClient, type BrokerageReadClient, type BrokerQuery } from './client.js';
import { discoverAccounts, syncPositions, syncQuotes, syncTransactions } from './sync.js';
import { buildBrokerOverview } from './status.js';

const contexts: AppContext[] = [];
const directories: string[] = [];
const longCall = 'CVX   280121C00155000';
const shortCall = 'CVX   261030C00227500';

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function opened(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-repair-'));
  directories.push(directory);
  const config = parseConfig(
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
  );
  const context = await openAppContext(config);
  contexts.push(context);
  return context;
}

class PagedBroker implements BrokerageReadClient {
  calls: Array<{ path: string; query?: BrokerQuery }> = [];
  pages: unknown[][];
  quotes: unknown[] = [];
  omit = new Set<string>();

  constructor(pages: unknown[][]) {
    this.pages = pages;
  }

  async getJson(path: string, query?: BrokerQuery): Promise<unknown> {
    this.calls.push({ path, query });
    if (path.includes('/orders')) throw new Error('orders must not be called');
    if (path === '/customers/me/accounts') {
      return { data: { items: [{ account: { 'account-number': '5WX01234', 'account-type-name': 'Individual' }, 'authority-level': 'owner' }] } };
    }
    if (path.endsWith('/positions')) {
      return {
        data: {
          items: [
            {
              symbol: longCall,
              'underlying-symbol': 'CVX',
              'instrument-type': 'Equity Option',
              quantity: '1',
              'quantity-direction': 'Long',
              multiplier: '100',
              'average-open-price': '21.40',
              'account-number': '5WX01234',
            },
            {
              symbol: shortCall,
              'underlying-symbol': 'CVX',
              'instrument-type': 'Equity Option',
              quantity: '1',
              'quantity-direction': 'Short',
              multiplier: '100',
              'average-open-price': '1.15',
              'account-number': '5WX01234',
            },
          ],
        },
      };
    }
    if (path.endsWith('/transactions')) {
      const rawOffset = query?.['page-offset'];
      const offset = Number(Array.isArray(rawOffset) ? rawOffset[0] : rawOffset ?? '0');
      return {
        data: { items: this.pages[offset] ?? [] },
        pagination: { 'per-page': 250, 'page-offset': offset, 'total-pages': this.pages.length, 'total-items': this.pages.flat().length },
      };
    }
    if (path === '/market-data/by-type') {
      return { data: { items: this.quotes.filter((item) => !this.omit.has(String((item as { symbol?: string }).symbol))) } };
    }
    throw new Error(`unexpected ${path}`);
  }
}

describe('transaction id repair', () => {
  it('keeps integer and string ids, rejects unsafe values, and does not duplicate rows', async () => {
    const unsafe = '9007199254740993';
    const parsed = parseBrokerJson(
      `{"id":${unsafe},"transaction-type":"Trade","action":"Buy to Open","price":1.25,"commission":"1.25","clearing-fees":0.65,"value-effect":"Debit","account-number":"5WX01234"}`,
    ) as { id: string; price: string; commission: string; 'clearing-fees': string };
    expect(parsed.id).toBe(unsafe);
    expect(typeof parsed.id).toBe('string');
    expect(parsed.price).toBe('1.25');
    expect(parsed.commission).toBe('1.25');
    expect(parsed['clearing-fees']).toBe('0.65');

    expect(canonicalProviderTransactionId(1001)).toEqual({ ok: true, id: '1001' });
    expect(canonicalProviderTransactionId('0001001')).toEqual({ ok: true, id: '1001' });
    expect(canonicalProviderTransactionId(null).ok).toBe(false);
    expect(canonicalProviderTransactionId('not-an-id').ok).toBe(false);
    expect(canonicalProviderTransactionId(1.5)).toEqual({ ok: false, reason: 'provider transaction id is not a positive integer' });
    expect(canonicalProviderTransactionId(Number.MAX_SAFE_INTEGER + 2)).toEqual({
      ok: false,
      reason: 'provider transaction id is outside the safe integer range',
    });
    const rejected = normalizeTransaction({ id: 'not-an-id', 'transaction-type': 'Trade' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).not.toContain('not-an-id');

    const context = await opened();
    const demoBefore = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    const pages = [
      [
        {
          id: 501,
          'transaction-type': 'Trade',
          action: 'Buy to Open',
          symbol: longCall,
          'instrument-type': 'Equity Option',
          quantity: '1',
          price: '21.40',
          value: '2140.00',
          'value-effect': 'Debit',
          commission: '1.25',
          'clearing-fees': '0.65',
          'executed-at': '2026-09-08T14:58:45.493Z',
          'account-number': '5WX01234',
        },
        { 'transaction-type': 'Trade', action: 'Buy to Open', symbol: longCall },
        { id: 'not-an-id', 'transaction-type': 'Trade', action: 'Buy to Open' },
        { id: 1.5, 'transaction-type': 'Trade', action: 'Buy to Open' },
        { id: Number.MAX_SAFE_INTEGER + 2, 'transaction-type': 'Trade', action: 'Buy to Open' },
      ],
      [
        {
          id: '502',
          'transaction-type': 'Trade',
          action: 'Sell to Open',
          symbol: shortCall,
          'instrument-type': 'Equity Option',
          quantity: '1',
          price: '1.15',
          value: '115.00',
          'value-effect': 'Credit',
          commission: '1.00',
          'clearing-fees': '0.10',
          'executed-at': '2026-10-13T14:29:55.917Z',
        },
        {
          id: unsafe,
          'transaction-type': 'Trade',
          action: 'Sell to Close',
          symbol: longCall,
          'instrument-type': 'Equity Option',
          quantity: '1',
          price: '30.00',
          value: '3000.00',
          'value-effect': 'Credit',
          commission: '1.25',
          'executed-at': '2026-10-14T15:00:00.000Z',
        },
      ],
    ];
    const fake = new PagedBroker(pages);
    const actor = { type: 'session' as const, sessionId: 'repair' };
    await discoverAccounts(context.database.db, fake, actor, false);
    const first = await syncTransactions(context.database.db, fake, actor, {
      lookbackDays: 365,
      scheduledSyncEnabled: false,
      transactions: { mode: 'backfill', startDate: '2025-10-15' },
      now: new Date('2026-10-15T16:00:00.000Z'),
    });
    expect(first.pagesFetched).toBe(2);
    expect(first.received).toBe(7);
    expect(first.valid).toBe(3);
    expect(first.inserted).toBe(3);
    expect(first.updated).toBe(0);
    expect(first.skipped).toBe(4);
    expect(first.skipReasons).toEqual([
      { reason: 'provider transaction id is missing', count: 1 },
      { reason: 'provider transaction id is not a positive integer', count: 2 },
      { reason: 'provider transaction id is outside the safe integer range', count: 1 },
    ]);
    const afterFirst = context.database.sqlite.prepare('SELECT transaction_history_status FROM broker_accounts').get() as {
      transaction_history_status: string;
    };
    expect(afterFirst.transaction_history_status).toBe('incomplete');
    expect(first.earliest).toBe('2026-09-08T14:58:45.493Z');
    expect(first.latest).toBe('2026-10-14T15:00:00.000Z');

    fake.pages = [[{ ...pages[0]![0], id: '000501', price: '21.45', 'value-effect': 'Debit' }]];
    const second = await syncTransactions(context.database.db, fake, actor, {
      lookbackDays: 365,
      scheduledSyncEnabled: false,
      transactions: { mode: 'recent' },
      now: new Date('2026-10-15T16:00:00.000Z'),
    });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    const rows = context.database.sqlite
      .prepare('SELECT provider_transaction_id, action, value_effect, commission, fees_json, price, raw_json FROM broker_transactions ORDER BY provider_transaction_id')
      .all() as Array<Record<string, string>>;
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.provider_transaction_id)).toEqual(['501', '502', unsafe]);
    expect(rows.find((row) => row.provider_transaction_id === '501')?.value_effect).toBe('Debit');
    expect(rows.find((row) => row.provider_transaction_id === '502')?.value_effect).toBe('Credit');
    expect(rows.find((row) => row.provider_transaction_id === '501')?.commission).toBe('1.25');
    expect(rows.find((row) => row.provider_transaction_id === '501')?.fees_json).toContain('"clearing-fees":"0.65"');
    expect(rows.find((row) => row.provider_transaction_id === '501')?.price).toBe('21.45');
    expect(rows.every((row) => !row.raw_json.includes('5WX01234'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('account-number');
    expect(rows.some((row) => row.provider_transaction_id === '9007199254740992')).toBe(false);

    const demoAfter = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    expect(demoAfter.count).toBe(demoBefore.count);
    const stored = context.database.sqlite.prepare('SELECT transaction_history_status FROM broker_accounts').get() as {
      transaction_history_status: string;
    };
    expect(stored.transaction_history_status).toBe('partial');
  });

  it('requests an independent quote snapshot for each open option', async () => {
    const context = await opened();
    const fake = new PagedBroker([[]]);
    fake.quotes = [
      { symbol: longCall, bid: '22.10', ask: '22.40', mark: '22.25', last: '22.20', 'updated-at': '2026-10-15T15:00:00.000Z' },
      { symbol: shortCall, bid: '0.40', ask: '0.55', mark: '0.48', last: '0.45', 'updated-at': '2026-10-15T15:00:00.000Z' },
    ];
    const actor = { type: 'session' as const, sessionId: 'repair' };
    await discoverAccounts(context.database.db, fake, actor, false);
    await syncPositions(context.database.db, fake, actor, false);
    const positionRaw = context.database.sqlite.prepare('SELECT raw_json FROM broker_positions').all() as Array<{ raw_json: string }>;
    expect(JSON.stringify(positionRaw)).not.toContain('5WX01234');
    await syncQuotes(context.database.db, fake, actor, false, new Date('2026-10-15T15:00:00.000Z'));
    const quoteCalls = fake.calls.filter((call) => call.path === '/market-data/by-type');
    expect(quoteCalls).toHaveLength(1);
    expect(quoteCalls[0]?.query?.['equity-option']).toEqual([longCall, shortCall]);
    const snapshots = context.database.sqlite
      .prepare('SELECT symbol, bid, ask, mark, last_price, quote_as_of, fetched_at, entitlement, freshness FROM quote_snapshots ORDER BY symbol')
      .all() as Array<Record<string, string>>;
    expect(snapshots.map((row) => row.symbol)).toEqual([shortCall, longCall]);
    expect(snapshots.find((row) => row.symbol === longCall)?.bid).toBe('22.10');
    expect(snapshots.find((row) => row.symbol === shortCall)?.bid).toBe('0.40');
    expect(snapshots.every((row) => row.entitlement === 'entitled' && row.freshness === 'fresh')).toBe(true);

    fake.omit.add(longCall);
    await syncQuotes(context.database.db, fake, actor, false, new Date('2026-10-15T15:01:00.000Z'));
    const latest = context.database.sqlite
      .prepare("SELECT symbol, bid, message FROM quote_snapshots WHERE fetched_at = '2026-10-15T15:01:00.000Z' ORDER BY symbol")
      .all() as Array<{ symbol: string; bid: string | null; message: string }>;
    expect(latest.find((row) => row.symbol === longCall)?.bid).toBeNull();
    expect(latest.find((row) => row.symbol === longCall)?.message).toMatch(/did not include/);
    expect(latest.find((row) => row.symbol === shortCall)?.bid).toBe('0.40');

    const overview = buildBrokerOverview({
      db: context.database.db,
      config: context.config,
      runtime: { connectedThisProcess: false, lastError: null },
      authenticated: true,
      ownerConfigured: true,
      portfolioView: 'brokerage',
      now: new Date('2026-10-15T15:01:00.000Z'),
    });
    expect(overview.quotes.symbols.map((quote) => quote.symbol).sort()).toEqual([shortCall, longCall]);
    expect(overview.history.message).toMatch(/2 open option positions have no stored opening transaction/);
    expect(overview.safety.ordersEnabled).toBe(false);
  });

  it('sends each option symbol as its own query parameter', async () => {
    const seen: string[] = [];
    const client = new TastytradeClient({
      baseUrl: 'https://api.cert.tastyworks.com',
      credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh-token' },
      sleep: async () => undefined,
      fetchImpl: async (url) => {
        const href = String(url);
        seen.push(href);
        if (href.includes('/oauth/token')) {
          return { status: 200, text: async () => JSON.stringify({ access_token: 'access-token', expires_in: 900 }) };
        }
        return { status: 200, text: async () => '{"data":{"items":[]}}' };
      },
    });
    await client.getJson('/market-data/by-type', { 'equity-option': [longCall, shortCall] });
    const quoteUrl = seen.find((href) => href.includes('/market-data/by-type'));
    expect(quoteUrl).toBeDefined();
    const params = new URL(quoteUrl ?? 'http://localhost').searchParams.getAll('equity-option');
    expect(params).toEqual([longCall, shortCall]);
    await expect(client.getJson('/accounts/5WX01234/orders')).rejects.toThrow(/Order routes/);
  });
});

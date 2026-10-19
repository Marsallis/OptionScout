import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupOwnerPassphrase } from '../auth/owner.js';
import { createApp } from '../app.js';
import { authorizeSync } from './actor.js';
import { ScheduledSyncDisabledError, TastytradeError } from './errors.js';
import { parseBrokerJson } from './decimals.js';
import { classifyQuoteFreshness, isRegularUsEquitySession } from './market-hours.js';
import { classifyTransaction, normalizePosition } from './normalize.js';
import { TastytradeClient, TokenManager, USER_AGENT, type BrokerageReadClient } from './client.js';
import { discoverAccounts, selectBrokerAccount, syncPositions, syncQuotes, syncTransactions } from './sync.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { brokerAccounts } from '../db/schema.js';
import { logError } from '../logger.js';
import { randomUUID } from 'node:crypto';

const contexts: AppContext[] = [];
const directories: string[] = [];
const passphrase = 'correct horse battery';
const hiddenToken = 'phase1b-refresh-token-do-not-leak';

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function opened(env: NodeJS.ProcessEnv = {}): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-1b-'));
  directories.push(directory);
  const config = parseConfig({
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
    ...env,
  }, { secretFilePath: path.join(directory, 'missing.env') });
  const context = await openAppContext(config);
  contexts.push(context);
  return context;
}

class FakeBroker implements BrokerageReadClient {
  calls: Array<{ path: string; query?: Record<string, string | string[]> }> = [];
  accounts: unknown[] = [
    { account: { 'account-number': '5WX01234', 'account-type-name': 'Individual' }, 'authority-level': 'owner' },
  ];
  positions: unknown[] = [
    {
      symbol: 'AAPL',
      'underlying-symbol': 'AAPL',
      'instrument-type': 'Equity',
      quantity: '1.250',
      'quantity-direction': 'Long',
      'average-open-price': '100.10',
      multiplier: '1',
    },
    {
      symbol: 'AAPL  280116C00150500',
      'underlying-symbol': 'AAPL',
      'instrument-type': 'Equity Option',
      quantity: '2',
      'quantity-direction': 'Short',
      'average-open-price': '3.40',
      multiplier: '10',
      'expires-at': '2028-01-16T21:00:00.000Z',
    },
  ];
  pages: unknown[][] = [
    [
      {
        id: 1001,
        'transaction-type': 'Trade',
        action: 'Buy to Open',
        symbol: 'AAPL  280116C00150500',
        'instrument-type': 'Equity Option',
        quantity: '1',
        price: '20.50',
        value: '2050.00',
        'value-effect': 'Debit',
        commission: '1.00',
        'executed-at': '2024-02-01T15:00:00.000Z',
      },
    ],
    [
      {
        id: '1002',
        'transaction-type': 'Receive Deliver',
        'transaction-sub-type': 'Assignment',
        action: 'Assignment',
        symbol: 'AAPL  280116C00150500',
        'instrument-type': 'Equity Option',
        quantity: '1',
        'executed-at': '2024-03-01T15:00:00.000Z',
      },
      {
        id: 1003,
        'transaction-type': 'Receive Deliver',
        'transaction-sub-type': 'Expiration',
        action: 'Expired',
        symbol: 'AAPL  280116C00150500',
        'instrument-type': 'Equity Option',
        'executed-at': '2024-04-01T20:00:00.000Z',
      },
      { id: '1004', 'transaction-type': 'Money Movement', action: 'Dividend', value: '12.00' },
    ],
  ];
  failPage = false;
  quoteStatus: 'ok' | 'denied' | 'missing' = 'ok';

  async getJson(path: string, query?: Record<string, string | string[]>): Promise<unknown> {
    this.calls.push({ path, query });
    if (path.includes('/orders')) throw new Error('orders must not be called');
    if (path === '/customers/me/accounts') return { data: { items: this.accounts } };
    if (path.endsWith('/positions')) return { data: { items: this.positions } };
    if (path.endsWith('/transactions')) {
      const rawOffset = query?.['page-offset'];
      const offset = Number(Array.isArray(rawOffset) ? rawOffset[0] : rawOffset ?? '0');
      if (this.failPage && offset === 1) throw new TastytradeError(503, true, 'The brokerage is temporarily unavailable.');
      const items = this.pages[offset] ?? [];
      return { data: { items }, pagination: { 'per-page': 250, 'page-offset': offset, 'total-pages': this.pages.length, 'total-items': 5 } };
    }
    if (path === '/market-data/by-type') {
      if (this.quoteStatus === 'denied') throw new TastytradeError(403, false, 'The brokerage refused this read.');
      if (this.quoteStatus === 'missing') return { data: { items: [] } };
      return {
        data: {
          items: [
            { symbol: 'AAPL', bid: '189.10', ask: '189.20', mid: '189.15', mark: '189.15', last: '189.12', 'updated-at': '2026-10-15T15:00:00.000Z' },
            { symbol: 'AAPL  280116C00150500', bid: '21.10', ask: '21.40', mark: '21.25', 'updated-at': '2026-10-15T15:00:00.000Z' },
          ],
        },
      };
    }
    throw new Error(`unexpected ${path}`);
  }
}

describe('owner authentication', () => {
  it('stores only a salted hash and rejects missing, wrong, and locked sign-ins', async () => {
    const context = await opened();
    setupOwnerPassphrase(context.database.db, passphrase);
    const stored = context.database.sqlite.prepare('SELECT password_hash FROM owner_credentials').get() as { password_hash: string };
    expect(stored.password_hash.startsWith('scrypt$16384$')).toBe(true);
    expect(stored.password_hash).not.toContain(passphrase);
    context.database.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    const dump = fs.readFileSync(context.config.databasePath);
    expect(dump.includes(passphrase)).toBe(false);
    const app = createApp(context);
    const agent = request.agent(app);
    const missing = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'wrong passphrase value' });
    expect(missing.status).toBe(401);
    expect(JSON.stringify(missing.body)).not.toContain(passphrase);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'still not right' });
    }
    const locked = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase });
    expect(locked.status).toBe(429);
    const open = await request(app).get('/api/broker/positions');
    expect(open.status).toBe(401);
  });

  it('sets an expiring HttpOnly cookie and requires CSRF on brokerage changes', async () => {
    const context = await opened();
    setupOwnerPassphrase(context.database.db, passphrase);
    const app = createApp(context);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase });
    expect(loggedIn.status).toBe(200);
    const cookie = String(loggedIn.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Secure/i);
    expect(cookie).not.toContain(passphrase);
    const denied = await agent.post('/api/broker/sync').set('Origin', 'http://127.0.0.1').send({ transactions: { mode: 'recent' } });
    expect(denied.status).toBe(403);
    const disabled = await agent
      .post('/api/broker/sync')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({ transactions: { mode: 'recent' } });
    expect(disabled.status).toBe(409);
    const cross = await request(app).put('/api/settings').set('Origin', 'https://evil.example').send({ density: 'compact' });
    expect(cross.status).toBe(403);
    context.database.sqlite.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await agent.get('/api/broker/positions')).status).toBe(401);
  });
});

describe('read-only brokerage sync', () => {
  it('normalizes decimals, directions, multipliers, pages, and special transactions once', async () => {
    const parsed = parseBrokerJson('{"multiplier":10,"average-open-price":"100.10","quantity":"1.250"}') as {
      multiplier: string;
      'average-open-price': string;
      quantity: string;
    };
    expect(parsed.multiplier).toBe('10');
    expect(parsed['average-open-price']).toBe('100.10');
    expect(parsed.quantity).toBe('1.250');
    const short = normalizePosition({
      symbol: 'AAPL  280116C00150500',
      'underlying-symbol': 'AAPL',
      'instrument-type': 'Equity Option',
      quantity: '2',
      'quantity-direction': 'Short',
      'average-open-price': '3.40',
      multiplier: '10',
    });
    expect(short.direction).toBe('short');
    expect(short.multiplier).toBe('10');
    expect(short.strike).toBe('150.5');
    expect(classifyTransaction({ type: 'Receive Deliver', subtype: 'Assignment', action: 'Assignment' })).toBe('assignment');
    expect(classifyTransaction({ type: 'Receive Deliver', subtype: 'Expiration', action: 'Expired' })).toBe('expiration');

    const context = await opened();
    const fake = new FakeBroker();
    const actor = { type: 'session' as const, sessionId: 's1' };
    await discoverAccounts(context.database.db, fake, actor, false);
    await syncPositions(context.database.db, fake, actor, false);
    await syncTransactions(context.database.db, fake, actor, { lookbackDays: 365, scheduledSyncEnabled: false, transactions: { mode: 'recent' } });
    const positions = context.database.db.select().from(brokerAccounts).all();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.transactionHistoryStatus).toBe('partial');
    const storedPositions = context.database.sqlite.prepare('SELECT quantity, average_open_price, multiplier, direction, status FROM broker_positions ORDER BY provider_symbol').all() as Array<Record<string, string>>;
    expect(storedPositions).toEqual([
      { quantity: '1.250', average_open_price: '100.10', multiplier: '1', direction: 'long', status: 'open' },
      { quantity: '2', average_open_price: '3.40', multiplier: '10', direction: 'short', status: 'open' },
    ]);
    const before = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(before.count).toBe(4);
    await syncTransactions(context.database.db, fake, actor, { lookbackDays: 365, scheduledSyncEnabled: false, transactions: { mode: 'recent' } });
    const after = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(after.count).toBe(4);
    const kinds = context.database.sqlite.prepare('SELECT classification FROM broker_transactions ORDER BY provider_transaction_id').all() as Array<{ classification: string }>;
    expect(kinds.map((row) => row.classification).sort()).toEqual(['assignment', 'expiration', 'trade', 'unsupported']);

    fake.positions = fake.positions.slice(0, 1);
    const txBefore = after.count;
    await syncPositions(context.database.db, fake, actor, false);
    const statuses = context.database.sqlite.prepare('SELECT provider_symbol, status FROM broker_positions').all() as Array<{ provider_symbol: string; status: string }>;
    expect(statuses.find((row) => row.provider_symbol.includes('280116'))?.status).toBe('unreconciled');
    const txAfter = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(txAfter.count).toBe(txBefore);

    await syncTransactions(context.database.db, fake, actor, {
      lookbackDays: 365,
      scheduledSyncEnabled: false,
      transactions: { mode: 'backfill', startDate: '2020-01-01' },
      now: new Date('2026-10-15T15:00:00.000Z'),
    });
    expect(context.database.db.select().from(brokerAccounts).get()?.transactionHistoryStatus).toBe('complete');
    fake.pages[1]?.push({ 'transaction-type': 'Trade', action: 'Buy to Open' });
    await syncTransactions(context.database.db, fake, actor, { lookbackDays: 365, scheduledSyncEnabled: false, transactions: { mode: 'recent' } });
    expect(context.database.db.select().from(brokerAccounts).get()?.transactionHistoryStatus).toBe('incomplete');
    const still = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(still.count).toBe(4);
  });

  it('asks for an account choice when the grant has more than one account', async () => {
    const context = await opened();
    const fake = new FakeBroker();
    fake.accounts = [
      { account: { 'account-number': '5WX01234', 'account-type-name': 'Individual' }, 'authority-level': 'owner' },
      { account: { 'account-number': '5WX56789', 'account-type-name': 'IRA' }, 'authority-level': 'owner' },
    ];
    const actor = { type: 'session' as const, sessionId: 's1' };
    await discoverAccounts(context.database.db, fake, actor, false);
    await expect(syncPositions(context.database.db, fake, actor, false)).rejects.toThrow(/Select an account/);
    const rows = context.database.db.select().from(brokerAccounts).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.selected === false)).toBe(true);
    const chosen = rows[0];
    if (!chosen) throw new Error('expected an account');
    selectBrokerAccount(context.database.db, chosen.id);
    await syncPositions(context.database.db, fake, actor, false);
    const calls = fake.calls.filter((call) => call.path.endsWith('/positions'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toContain(chosen.accountNumber);
    expect(calls[0]?.path).not.toContain('5WX56789');
  });

  it('marks a failed page incomplete and does not duplicate the rows already stored', async () => {
    const context = await opened();
    const fake = new FakeBroker();
    fake.failPage = true;
    const actor = { type: 'session' as const, sessionId: 's1' };
    await discoverAccounts(context.database.db, fake, actor, false);
    await expect(
      syncTransactions(context.database.db, fake, actor, { lookbackDays: 365, scheduledSyncEnabled: false, transactions: { mode: 'backfill', startDate: '2020-01-01' } }),
    ).rejects.toBeInstanceOf(TastytradeError);
    const account = context.database.db.select().from(brokerAccounts).get();
    expect(account?.transactionHistoryStatus).toBe('incomplete');
    const count = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('keeps quote freshness separate from a connected account', async () => {
    expect(isRegularUsEquitySession(new Date('2026-10-15T15:00:00.000Z'))).toBe(true);
    expect(isRegularUsEquitySession(new Date('2026-10-15T21:00:00.000Z'))).toBe(false);
    expect(classifyQuoteFreshness('2026-10-15T15:00:00.000Z', new Date('2026-10-15T15:10:00.000Z'))).toBe('fresh');
    expect(classifyQuoteFreshness('2026-10-15T15:00:00.000Z', new Date('2026-10-15T15:20:00.000Z'))).toBe('stale');
    expect(classifyQuoteFreshness('2026-10-15T15:00:00.000Z', new Date('2026-10-17T15:00:00.000Z'))).toBe('closed_session');

    const context = await opened();
    const fake = new FakeBroker();
    const actor = { type: 'session' as const, sessionId: 's1' };
    await discoverAccounts(context.database.db, fake, actor, false);
    await syncPositions(context.database.db, fake, actor, false);
    fake.quoteStatus = 'denied';
    await syncQuotes(context.database.db, fake, actor, false, new Date('2026-10-15T15:00:00.000Z'));
    const denied = context.database.sqlite.prepare('SELECT entitlement, bid FROM quote_snapshots').all() as Array<{ entitlement: string; bid: string | null }>;
    expect(denied.every((row) => row.entitlement === 'denied' && row.bid === null)).toBe(true);
    const { buildBrokerOverview } = await import('./status.js');
    const body = buildBrokerOverview({
      db: context.database.db,
      config: { ...context.config, liveEnabled: true },
      runtime: { connectedThisProcess: true, lastError: null },
      authenticated: true,
      ownerConfigured: false,
      portfolioView: 'brokerage',
      now: new Date('2026-10-15T21:00:00.000Z'),
    });
    expect(body.connection.state).toBe('connected');
    expect(body.quotes.state).toBe('unavailable');
  });
});

describe('brokerage client safety', () => {
  it('refreshes tokens once, retries rate limits, and refuses order routes', async () => {
    let now = 0;
    let tokenCalls = 0;
    const manager = new TokenManager(
      {
        async postToken() {
          tokenCalls += 1;
          return { status: 200, text: JSON.stringify({ access_token: `access-${tokenCalls}`, expires_in: 900 }) };
        },
      },
      { clientId: 'id', clientSecret: 'secret', refreshToken: hiddenToken },
      () => now,
    );
    await Promise.all([manager.getAccessToken(), manager.getAccessToken()]);
    expect(tokenCalls).toBe(1);
    now = 850_000;
    await manager.getAccessToken();
    expect(tokenCalls).toBe(2);

    const rejected = new TokenManager(
      { async postToken() { tokenCalls += 1; return { status: 400, text: '{"error":"invalid_grant"}' }; } },
      { clientId: 'id', clientSecret: 'secret', refreshToken: hiddenToken },
      () => 0,
    );
    const before = tokenCalls;
    await expect(rejected.getAccessToken()).rejects.toThrow(/rejected/);
    await expect(rejected.getAccessToken()).rejects.toThrow(/will not be retried/);
    expect(tokenCalls).toBe(before + 1);

    let fetchCalls = 0;
    const client = new TastytradeClient({
      baseUrl: 'https://api.cert.tastyworks.com',
      credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: hiddenToken },
      sleep: async () => undefined,
      fetchImpl: async (url, init) => {
        fetchCalls += 1;
        const headers = init?.headers as Record<string, string>;
        expect(headers['User-Agent']).toBe(USER_AGENT);
        const href = String(url);
        if (href.includes('/oauth/token')) {
          expect(init?.body).toContain('"scope":"read"');
          expect(init?.body).not.toContain('trade');
          return { status: 200, text: async () => JSON.stringify({ access_token: 'access-token', expires_in: 900 }) };
        }
        if (fetchCalls < 4) return { status: 429, text: async () => 'slow down' };
        return { status: 200, text: async () => '{"data":{"items":[]}}' };
      },
    });
    await client.getJson('/customers/me/accounts');
    await expect(client.getJson('/accounts/5WX01234/orders')).rejects.toThrow(/Order routes/);
    expect(() => authorizeSync({ type: 'job', jobId: 'nightly' }, false)).toThrow(ScheduledSyncDisabledError);
  });

  it('does not call the network or reveal a seeded account when live access is off', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const context = await opened();
    context.database.db.insert(brokerAccounts).values({
      id: randomUUID(),
      provider: 'tastytrade',
      accountNumber: '5WX99991',
      accountType: 'Individual',
      authority: 'owner',
      maskedLabel: '••••9991',
      selected: true,
      transactionHistoryStatus: 'not_imported',
      historyCoverageStart: null,
      historyCoverageEnd: null,
      discoveredAt: new Date().toISOString(),
    }).run();
    setupOwnerPassphrase(context.database.db, passphrase);
    const app = createApp(context);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase });
    const sync = await agent
      .post('/api/broker/sync')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({});
    expect(sync.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
    const hidden = await request(app).get('/api/broker');
    expect(JSON.stringify(hidden.body)).not.toContain('5WX99991');
    expect(hidden.body.accounts).toEqual([]);
    const visible = await agent.get('/api/broker');
    expect(JSON.stringify(visible.body)).not.toContain('5WX99991');
    expect(visible.body.accounts[0].maskedAccount).toBe('••••9991');
    const dashboard = await request(app).get('/api/dashboard');
    expect(dashboard.body.demo).toBe(true);
    expect(JSON.stringify(dashboard.body)).not.toContain('5WX99991');
    const errors: string[] = [];
    const original = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    logError(`Bearer ${hiddenToken} eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature`);
    console.error = original;
    expect(errors.join('\n')).not.toContain(hiddenToken);
    expect(errors.join('\n')).toContain('[redacted]');
    vi.unstubAllGlobals();
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { TastytradeClient, assertReadOnlyPath } from '../brokerage/client.js';
import { equityOptionPath, parseEquityOption } from '../brokerage/instruments.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { brokerAccounts, brokerPositions, instrumentSymbols } from '../db/schema.js';
import { runDxlinkDiagnostic } from './diagnostic.js';
import type { DxlinkSocket } from './session.js';

const contexts: AppContext[] = [];
const directories: string[] = [];
const longSymbol = 'ZZT   280121C00155000';
const shortSymbol = 'ZZT   261030C00227500';
const streamers: Record<string, string> = {
  [longSymbol]: '.ZZT280121C155',
  [shortSymbol]: '.ZZT261030C2275',
};

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

class ScriptedSocket implements DxlinkSocket {
  private message: ((frame: string) => void) | null = null;
  private closed: (() => void) | null = null;

  send(frame: string): void {
    const message = JSON.parse(frame) as { type?: string };
    if (message.type === 'SETUP') this.later({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
    if (message.type === 'AUTH') this.later({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
    if (message.type === 'CHANNEL_REQUEST') this.later({ type: 'CHANNEL_OPENED', channel: 3, service: 'FEED' });
    if (message.type === 'FEED_SETUP') this.later({ type: 'FEED_CONFIG', channel: 3, dataFormat: 'COMPACT' });
    if (message.type === 'FEED_SUBSCRIPTION') {
      this.later({ type: 'FEED_DATA', channel: 3, data: ['Quote', ['Quote', streamers[longSymbol], 69.1, 69.4, 3, 4, 1_700_000_000_000]] });
      this.later({ type: 'FEED_DATA', channel: 3, data: ['Greeks', ['Greeks', streamers[longSymbol], 0.22, 0.81, 0.01, -0.03, Number.NaN, 0.12, 1_700_000_000_100]] });
    }
  }

  close(): void {
    this.closed?.();
  }

  onMessage(handler: (frame: string) => void): void {
    this.message = handler;
  }

  onClose(handler: () => void): void {
    this.closed = handler;
  }

  private later(message: unknown): void {
    queueMicrotask(() => this.message?.(JSON.stringify(message)));
  }
}

async function opened(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-dxlive-'));
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
        DXLINK_LIVE_DIAGNOSTIC: 'false',
      },
      { secretFilePath: path.join(directory, 'missing.env') },
    ),
  );
  contexts.push(context);
  return context;
}

describe('equity option instruments', () => {
  it('encodes the OCC symbol and accepts only that read', () => {
    expect(equityOptionPath(longSymbol)).toBe(`/instruments/equity-options/${encodeURIComponent(longSymbol)}`);
    expect(() => assertReadOnlyPath('GET', equityOptionPath(longSymbol))).not.toThrow();
    expect(() => assertReadOnlyPath('GET', '/option-chains/CVX')).toThrow(/not available/);
    expect(() => assertReadOnlyPath('GET', '/option-chains/CVX/nested')).not.toThrow();
    expect(() => assertReadOnlyPath('GET', '/instruments/equities/CVX')).not.toThrow();
    expect(parseEquityOption(longSymbol, { data: { symbol: longSymbol, 'streamer-symbol': streamers[longSymbol], 'underlying-symbol': 'CVX' } }).streamerSymbol).toBe(streamers[longSymbol]);
    expect(() => parseEquityOption(longSymbol, { data: { symbol: 'SPY   280121C00155000', 'streamer-symbol': '.SPY280121C155', 'underlying-symbol': 'SPY' } })).toThrow(/did not match/);
    expect(() => parseEquityOption(longSymbol, { data: { symbol: longSymbol, 'streamer-symbol': ' ', 'underlying-symbol': 'CVX' } })).toThrow(/streamer symbol/);
  });

  it('requests the encoded instrument path', async () => {
    let captured = '';
    const client = new TastytradeClient({
      baseUrl: 'https://api.tastyworks.com',
      credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
      sleep: async () => undefined,
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/oauth/token')) return { status: 200, text: async () => JSON.stringify({ access_token: 'access', expires_in: 900 }) };
        captured = href;
        return { status: 200, text: async () => JSON.stringify({ data: { symbol: longSymbol, 'streamer-symbol': streamers[longSymbol], 'underlying-symbol': 'CVX' } }) };
      },
    });
    await client.getJson(equityOptionPath(longSymbol));
    expect(captured).toContain(`/instruments/equity-options/${encodeURIComponent(longSymbol)}`);
    expect(captured).not.toContain(' ');
  });
});

describe('DXLink diagnostic', () => {
  it('stays closed unless the switch is on and then subscribes only verified symbols', async () => {
    const context = await opened();
    const calls: string[] = [];
    const client = {
      async getJson(path: string) {
        calls.push(path);
        throw new Error('should not be called');
      },
    };
    await expect(runDxlinkDiagnostic({ enabled: false, db: context.database.db, client, connect: () => { throw new Error('socket'); } })).rejects.toThrow(/disabled/);
    expect(calls).toEqual([]);

    const accountId = randomUUID();
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
    context.database.db.insert(brokerPositions).values([
      position(accountId, longSymbol, 'long', '155', '2028-01-21'),
      position(accountId, shortSymbol, 'short', '227.5', '2026-10-30'),
    ]).run();
    const quoteToken = 'quote-token-should-not-leak';
    const liveClient = {
      async getJson(path: string) {
        calls.push(path.split('?')[0] ?? path);
        if (path === '/api-quote-tokens') {
          return { data: { token: quoteToken, 'dxlink-url': 'wss://tasty-openapi-ws.dxfeed.com/realtime', level: 'equity' } };
        }
        const symbol = decodeURIComponent((path.split('/').pop() ?? '').split('?')[0] ?? '');
        const streamer = streamers[symbol];
        if (!streamer) return { data: { symbol: 'SPY   280121C00155000', 'streamer-symbol': '.SPY', 'underlying-symbol': 'SPY' } };
        return { data: { symbol, 'streamer-symbol': streamer, 'underlying-symbol': 'CVX' } };
      },
    };
    const report = await runDxlinkDiagnostic({
      enabled: true,
      db: context.database.db,
      client: liveClient,
      connect: () => new ScriptedSocket(),
      now: new Date('2026-10-15T22:00:00.000Z'),
      listenMs: 20,
      feedWaitMs: 1000,
    });
    expect(report.marketSession).toBe('closed');
    expect(report.socketOpened).toBe(true);
    expect(report.handshake).toMatchObject({ setup: true, authSent: true, authorized: true, channelOpened: true, feedConfigured: true });
    expect(report.subscriptions.frames).toBe(1);
    expect(report.subscriptions.eventTypes).toEqual(['Greeks', 'Quote']);
    expect(report.subscriptions.symbolCount).toBe(2);
    expect(report.subscriptions.tradeSubscriptions).toBe(0);
    expect(report.closed).toBe(true);
    expect(report.accounting.transactionDigestUnchanged).toBe(true);
    expect(report.accounting.quoteSnapshotDigestUnchanged).toBe(true);
    const longEvent = report.events.find((event) => event.requestedSymbol === longSymbol);
    expect(longEvent?.quote).toMatchObject({ bid: 69.1, ask: 69.4 });
    expect(longEvent?.greeks?.delta).toBe(0.81);
    expect(longEvent?.greeks?.rho).toBeNull();
    expect(JSON.stringify(report)).not.toContain(quoteToken);
    const stored = context.database.db.select().from(instrumentSymbols).all();
    expect(stored.map((row) => row.streamerSymbol).sort()).toEqual([streamers[longSymbol], streamers[shortSymbol]].sort());
    const app = createApp(context);
    expect((await request(app).post('/api/market-data/diagnostic').set('Origin', 'http://127.0.0.1')).status).toBe(401);
  });
});

function position(accountId: string, symbol: string, direction: 'long' | 'short', strike: string, expiration: string) {
  return {
    id: randomUUID(),
    brokerAccountId: accountId,
    providerSymbol: symbol,
    underlyingSymbol: 'CVX',
    optionSymbol: symbol,
    instrumentType: 'Equity Option',
    quantity: '1',
    direction,
    strike,
    expiration,
    averageOpenPrice: '1.00',
    multiplier: '100',
    reportedMark: null,
    status: 'open',
    syncedAt: '2026-10-15T20:00:00.000Z',
    rawJson: '{}',
  };
}

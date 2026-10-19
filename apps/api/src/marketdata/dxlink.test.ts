import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAL_PMCC_DEEP_ITM } from '@optionscout/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { setupOwnerPassphrase } from '../auth/owner.js';
import { assertReadOnlyPath } from '../brokerage/client.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { resetBuiltinTemplate, saveStrategyProfile } from '../strategy/profiles.js';
import { MarketDataCache } from './cache.js';
import { assertDxlinkUrl, parseFeedData, parseQuoteToken } from './protocol.js';
import { DxlinkSession, liveDxlinkSocket, type DxlinkSocket, type SessionSchedule } from './session.js';

const contexts: AppContext[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

class ManualClock implements SessionSchedule {
  current = Date.parse('2026-10-15T14:00:00.000Z');
  private tasks: Array<{ due: number; every: number | null; fn: () => void; cancelled: boolean }> = [];

  now(): number {
    return this.current;
  }

  every(ms: number, fn: () => void): () => void {
    const task = { due: this.current + ms, every: ms, fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  later(ms: number, fn: () => void): () => void {
    const task = { due: this.current + ms, every: null, fn, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const next = this.tasks
        .filter((task) => !task.cancelled && task.due <= target)
        .sort((left, right) => left.due - right.due)[0];
      if (!next) break;
      this.current = next.due;
      if (next.every == null) next.cancelled = true;
      else next.due += next.every;
      next.fn();
    }
    this.current = target;
  }
}

class FakeSocket implements DxlinkSocket {
  readonly sent: Array<Record<string, unknown>> = [];
  private message: ((frame: string) => void) | null = null;
  private closed: (() => void) | null = null;

  send(frame: string): void {
    this.sent.push(JSON.parse(frame) as Record<string, unknown>);
  }

  receive(message: unknown): void {
    this.message?.(JSON.stringify(message));
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
}

function types(socket: FakeSocket): string[] {
  return socket.sent.map((frame) => String(frame.type));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function handshake(session: DxlinkSession, sockets: FakeSocket[]): Promise<FakeSocket> {
  await session.start();
  const socket = sockets.at(-1);
  if (!socket) throw new Error('The test socket was not created.');
  socket.receive({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
  await flush();
  socket.receive({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
  socket.receive({ type: 'CHANNEL_OPENED', channel: 3, service: 'FEED' });
  socket.receive({ type: 'FEED_CONFIG', channel: 3, dataFormat: 'COMPACT' });
  return socket;
}

describe('DXLink protocol', () => {
  it('accepts only the documented market-data socket and the quote-token read', () => {
    expect(() => assertDxlinkUrl('wss://tasty-openapi-ws.dxfeed.com/realtime')).not.toThrow();
    expect(() => assertDxlinkUrl('wss://tasty-openapi-dxlink-md-ws.dxfeed.com/realtime')).not.toThrow();
    expect(() => assertDxlinkUrl('wss://streamer.tastyworks.com')).toThrow(/allowed market-data/);
    expect(() => assertDxlinkUrl('ws://tasty-openapi-ws.dxfeed.com/realtime')).toThrow(/allowed market-data/);
    expect(() => assertReadOnlyPath('GET', '/api-quote-tokens')).not.toThrow();
    expect(() => assertReadOnlyPath('GET', '/accounts/5WX01234/orders')).toThrow(/Order routes/);
    expect(() => assertReadOnlyPath('GET', '/option-chains/CVX')).toThrow(/not available/);
    expect(() => assertReadOnlyPath('GET', '/option-chains/CVX/nested')).not.toThrow();
    expect(() => assertReadOnlyPath('GET', '/instruments/equities/CVX')).not.toThrow();
    const token = parseQuoteToken({ data: { token: 'quote-token', 'dxlink-url': 'wss://tasty-openapi-ws.dxfeed.com/realtime', level: 'equity' } });
    expect(token.token).toBe('quote-token');
    expect(liveDxlinkSocket).toThrow(/disabled until an approved diagnostic/);
  });

  it('sequences setup, auth, channel, feed, and one deduplicated subscription', async () => {
    const clock = new ManualClock();
    const sockets: FakeSocket[] = [];
    let tokenReads = 0;
    const session = new DxlinkSession({
      schedule: clock,
      tokens: {
        async getQuoteToken() {
          tokenReads += 1;
          return { token: 'quote-token', dxlinkUrl: 'wss://tasty-openapi-ws.dxfeed.com/realtime', level: 'equity', expiresAt: clock.now() + 24 * 60 * 60 * 1000 };
        },
      },
      connect(url) {
        expect(url).toBe('wss://tasty-openapi-ws.dxfeed.com/realtime');
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const longId = 'CVX   280121C00155000';
    const streamer = '.CVX280121C155';
    session.subscribe({ consumerId: 'positions', instrumentId: longId, streamerSymbol: streamer, purpose: 'position' });
    session.subscribe({ consumerId: 'detail', instrumentId: ` ${longId} `, streamerSymbol: streamer, purpose: 'position' });
    const socket = await handshake(session, sockets);
    expect(types(socket)).toEqual(['SETUP', 'AUTH', 'CHANNEL_REQUEST', 'FEED_SETUP', 'FEED_SUBSCRIPTION']);
    const auth = socket.sent[1]!;
    expect(auth.token).toBe('quote-token');
    const subscription = socket.sent[4]!;
    const add = subscription.add as Array<{ type: string; symbol: string }>;
    expect(subscription.reset).toBe(true);
    expect(add.map((item) => item.symbol)).toEqual([streamer, streamer, streamer]);
    expect(add.map((item) => item.symbol)).not.toContain(longId);
    expect(tokenReads).toBe(2);

    socket.receive({ type: 'FEED_DATA', channel: 3, data: ['Quote', ['Quote', streamer, 69.2, 69.5, 10, 12, 200]] });
    socket.receive({ type: 'FEED_DATA', channel: 3, data: ['Quote', ['Quote', streamer, 1, 1, 1, 1, 100]] });
    socket.receive({ type: 'FEED_DATA', channel: 3, data: ['Greeks', ['Greeks', streamer, 0.2, Number.NaN, 0.01, -0.04, 0.1, 0.3, 200]] });
    const quote = session.snapshot(longId);
    expect(quote.connection).toBe('connected');
    expect(quote.freshness).toBe('fresh');
    expect(quote.row?.quote?.bid).toBe(69.2);
    expect(quote.row?.greeks?.delta).toBeNull();
    expect(quote.row?.greeks?.theta).toBe(-0.04);

    session.subscribe({ consumerId: 'research', instrumentId: 'CVX   261030C00227500', streamerSymbol: '.CVX261030C227.5', purpose: 'research' });
    expect(socket.sent.filter((frame) => frame.type === 'FEED_SUBSCRIPTION')).toHaveLength(2);
    session.unsubscribe('detail', longId);
    expect(socket.sent.some((frame) => frame.remove)).toBe(false);
    session.unsubscribe('positions', longId);
    expect(socket.sent.at(-1)?.remove).toEqual([
      { type: 'Quote', symbol: streamer },
      { type: 'Trade', symbol: streamer },
      { type: 'Greeks', symbol: streamer },
    ]);
  });

  it('ignores early and stale events, renews an expiring token, and reconnects', async () => {
    const clock = new ManualClock();
    const sockets: FakeSocket[] = [];
    let issued = 0;
    const session = new DxlinkSession({
      schedule: clock,
      tokens: {
        async getQuoteToken() {
          issued += 1;
          return {
            token: `quote-${issued}`,
            dxlinkUrl: 'wss://tasty-openapi-ws.dxfeed.com/realtime',
            level: 'equity',
            expiresAt: clock.now() + 60_000,
          };
        },
      },
      connect() {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    session.subscribe({ consumerId: 'positions', instrumentId: 'CVX', streamerSymbol: 'CVX', purpose: 'position' });
    await session.start();
    sockets[0]!.receive({ type: 'FEED_DATA', channel: 3, data: ['Quote', ['Quote', 'CVX', 10, 11, 1, 1, 1]] });
    expect(session.snapshot('CVX').row?.quote).toBeNull();
    expect(issued).toBeGreaterThanOrEqual(2);
    sockets[0]!.close();
    expect(session.snapshot('CVX').connection).toBe('disconnected');
    clock.advance(1000);
    await flush();
    expect(sockets).toHaveLength(2);
    expect(types(sockets[1]!).at(0)).toBe('SETUP');
    sockets[1]!.receive({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' });
    await flush();
    sockets[1]!.receive({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
    sockets[1]!.receive({ type: 'CHANNEL_OPENED', channel: 3, service: 'FEED' });
    sockets[1]!.receive({ type: 'FEED_CONFIG', channel: 3, dataFormat: 'COMPACT' });
    sockets[1]!.receive({ type: 'FEED_DATA', channel: 3, data: ['Trade', ['Trade', 'CVX', 155.25, 1000, 10, 50]] });
    expect(session.snapshot('CVX').row?.trade?.price).toBe(155.25);
    clock.advance(30_000);
    expect(sockets[1]!.sent.some((frame) => frame.type === 'KEEPALIVE')).toBe(true);
    const missing = session.subscribe({ consumerId: 'positions', instrumentId: 'AMD', streamerSymbol: null, purpose: 'position' });
    expect(missing.missingStreamer).toBe(true);
    expect(sockets[1]!.sent.filter((frame) => frame.type === 'FEED_SUBSCRIPTION').every((frame) => JSON.stringify(frame).includes('AMD') === false)).toBe(true);
  });

  it('labels closed and stale cache rows and refuses a full research set', () => {
    const closed = new MarketDataCache({
      now: () => Date.parse('2026-10-17T14:00:00.000Z'),
      marketClosed: () => true,
    });
    closed.remember('CVX', 'CVX');
    closed.applyQuote({ streamerSymbol: 'CVX', bid: 1, ask: 2, bidSize: 1, askSize: 1, eventTime: 1 }, '2026-10-17T13:00:00.000Z');
    expect(closed.get('CVX')?.freshness).toBe('market_closed');
    const open = new MarketDataCache({
      now: () => Date.parse('2026-10-15T15:00:00.000Z'),
      marketClosed: () => false,
    });
    open.remember('CVX', 'CVX');
    open.applyQuote({ streamerSymbol: 'CVX', bid: 1, ask: 2, bidSize: 1, askSize: 1, eventTime: 1 }, '2026-10-15T14:00:00.000Z');
    expect(open.get('CVX')?.freshness).toBe('stale');
    expect(parseFeedData({ type: 'FEED_DATA', data: ['Summary', ['Summary', 'CVX']] })).toEqual([]);
    const clock = new ManualClock();
    const session = new DxlinkSession({
      schedule: clock,
      researchLimit: 1,
      tokens: { async getQuoteToken() { throw new Error('no token'); } },
      connect() { throw new Error('no socket'); },
    });
    session.subscribe({ consumerId: 'research', instrumentId: 'A', streamerSymbol: 'A', purpose: 'research' });
    expect(() => session.subscribe({ consumerId: 'research', instrumentId: 'B', streamerSymbol: 'B', purpose: 'research' })).toThrow(/limit/);
  });
});

describe('market-data routes', () => {
  it('keeps the live socket closed and serves the saved profile only to a signed-in owner', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-dx-'));
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
    const app = createApp(context);
    expect((await request(app).get('/api/market-data/stream')).status).toBe(401);
    expect((await request(app).post('/api/market-data/stream').set('Origin', 'http://127.0.0.1')).status).toBe(401);
    expect((await request(app).get('/api/strategy-profiles')).status).toBe(401);
    setupOwnerPassphrase(context.database.db, 'correct horse battery staple');
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'correct horse battery staple' });
    const stream = await agent.get('/api/market-data/stream');
    expect(stream.status).toBe(200);
    expect(stream.body).toMatchObject({ state: 'not-connected', liveEnabled: false, implemented: true });
    expect(JSON.stringify(stream.body)).not.toMatch(/quote-token|refresh_token|client_secret/);
    const disabled = await agent.post('/api/market-data/stream').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(disabled.status).toBe(409);
    expect(disabled.body.error).toMatch(/Demo Mode/);
    const profile = await agent.get('/api/strategy-profiles');
    expect(profile.body.profiles[0].name).toBe('Sal PMCC — Deep ITM');
    const saved = saveStrategyProfile(context.database.db, SAL_PMCC_DEEP_ITM.id, {
      ...SAL_PMCC_DEEP_ITM,
      preferences: { ...SAL_PMCC_DEEP_ITM.preferences, maxBidAskSpreadPercent: '5', minOpenInterest: 20, minVolume: 5 },
    });
    expect(saved.preferences.maxBidAskSpreadPercent).toBe('5');
    expect(saved.revision).toBeGreaterThan(1);
    // Built-in id cannot be deleted; reset restores defaults instead.
    const restored = resetBuiltinTemplate(context.database.db);
    expect(restored.hard.maxContractCost).toBe('7000.00');
  });
});

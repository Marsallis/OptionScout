import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_DISCLAIMER } from '@optionscout/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { openAppContext, type AppContext } from './context.js';
import { resetWatchlistQuoteCache } from './marketdata/watchlist-quotes.js';

const contexts: AppContext[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.close();
  }
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function boot(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-api-'));
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
  });
  const context = await openAppContext(config);
  contexts.push(context);
  return context;
}

function assertDemoFlags(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertDemoFlags);
    return;
  }
  if (value && typeof value === 'object') {
    if ('isDemo' in value) {
      expect(value.isDemo).toBe(true);
    }
    Object.values(value).forEach(assertDemoFlags);
  }
}

describe('demo API', () => {
  it('reports health for the local demo service', async () => {
    const context = await boot();
    const response = await request(createApp(context)).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'optionscout',
      phase: '1C',
      liveEnabled: false,
      scheduledSyncEnabled: false,
      ownerConfigured: false,
      dataMode: 'demo',
      demo: true,
      database: 'ok',
      bootCount: 1,
      ordersEnabled: false,
      telemetryEnabled: false,
    });
  });

  it('returns the synthetic portfolio with demo labeling and fixed totals', async () => {
    const context = await boot();
    const response = await request(createApp(context)).get('/api/dashboard');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.disclaimer).toBe(DEMO_DISCLAIMER);
    expect(response.body.dataSource).toBe('demo-fixture');
    expect(response.body.summary).toEqual({
      openPositions: 4,
      leapsCapital: 17190,
      shortCallCreditsReceived: 1600,
      realizedPnl: 690,
      estimatedUnrealizedPnl: 645,
      upcomingExpirationCount: 2,
    });
    expect(response.body.positions).toHaveLength(4);
    expect(response.body.transactions).toHaveLength(10);
    expect(response.body.journal).toHaveLength(3);
    expect(response.body.research).toHaveLength(3);
    expect(response.body.alerts).toHaveLength(3);
    expect(response.body.watchlist).toHaveLength(4);
    expect(response.body.brokerage.ordersEnabled).toBe(false);
    assertDemoFlags(response.body);
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('refresh_token');
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('client_secret');
  });

  it('describes mock providers and rejects order routes and unsafe settings', async () => {
    const context = await boot();
    const app = createApp(context);
    const broker = await request(app).get('/api/broker');
    expect(broker.status).toBe(200);
    expect(broker.body.connection.state).toBe('not_configured');
    expect(broker.body.connection.readOnly).toBe(true);
    expect(broker.body.sync.scheduledSyncEnabled).toBe(false);
    expect(broker.body.accounts).toEqual([]);
    expect(broker.body.stream.implemented).toBe(true);
    expect(broker.body.stream.liveEnabled).toBe(false);
    expect(broker.body.stream.state).toBe('not-connected');
    expect(broker.body.safety).toEqual({
      ordersEnabled: false,
      telemetryEnabled: false,
      networkAccessRequired: false,
    });

    expect((await request(app).post('/api/orders').send({ symbol: 'AAPL' })).status).toBe(404);
    expect((await request(app).post('/api/broker/orders').send({})).status).toBe(404);
    expect((await request(app).delete('/api/positions/pos_aapl')).status).toBe(404);

    const rejected = await request(app).put('/api/settings').send({ dataMode: 'live', density: 'compact' });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).not.toContain('live');

    const saved = await request(app)
      .put('/api/settings')
      .set('Origin', 'http://127.0.0.1')
      .send({ density: 'compact', showGreeks: false });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      demo: true,
      density: 'compact',
      showGreeks: false,
      dataMode: 'demo',
      authMode: 'local-owner',
      portfolioView: 'demo',
      ordersEnabled: false,
    });
  });

  it('stores a passphrase hash without echoing the passphrase', async () => {
    const passphrase = 'correct horse battery staple';
    const context = await boot();
    const agent = request.agent(createApp(context));
    const created = await agent
      .post('/api/owner/setup')
      .set('Origin', 'http://127.0.0.1')
      .send({ passphrase, confirm: passphrase });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ authenticated: true, ownerConfigured: true, publicSimulatedDemo: false });
    expect(JSON.stringify(created.body)).not.toContain(passphrase);
    expect(JSON.stringify(created.body)).not.toContain('scrypt$');
    const session = await agent.get('/api/session');
    expect(session.body.authenticated).toBe(true);
    const again = await agent.post('/api/owner/setup').set('Origin', 'http://127.0.0.1').send({ passphrase, confirm: passphrase });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toContain(passphrase);
  });

  it('refuses a passphrase on the public simulated preview', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-api-'));
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
      PUBLIC_SIMULATED_DEMO: 'true',
    });
    const context = await openAppContext(config);
    contexts.push(context);
    const response = await request(createApp(context))
      .post('/api/owner/setup')
      .set('Host', 'preview.example.test')
      .set('Origin', 'https://preview.example.test')
      .send({ passphrase: 'correct horse battery staple', confirm: 'correct horse battery staple' });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/simulated book/i);
    expect(JSON.stringify(response.body)).not.toContain('correct horse');
  });

  it('serves simulated watchlist quotes and limits repeat refreshes', async () => {
    resetWatchlistQuoteCache();
    const context = await boot();
    const app = createApp(context);
    const first = await request(app).get('/api/market-data/watchlist-quotes?symbols=aapl,msft');
    expect(first.status).toBe(200);
    expect(first.body.rateLimited).toBe(false);
    expect(first.body.quotes).toHaveLength(2);
    expect(first.body.quotes[0]).toMatchObject({
      symbol: 'AAPL',
      source: 'simulated',
      ordersEnabled: false,
    });
    expect(first.body.quotes[0].label).toMatch(/Simulated quote/);
    expect(first.body.quotes[0].last).toBeGreaterThan(0);
    const second = await request(app).get('/api/market-data/watchlist-quotes?symbols=AAPL,MSFT');
    expect(second.status).toBe(200);
    expect(second.body.rateLimited).toBe(true);
    expect(second.body.quotes[0].last).toBe(first.body.quotes[0].last);
    const other = await request(app).get('/api/market-data/watchlist-quotes?symbols=NVDA');
    expect(other.status).toBe(429);
    resetWatchlistQuoteCache();
  });
});

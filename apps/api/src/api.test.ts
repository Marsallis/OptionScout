import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_DISCLAIMER } from '@optionscout/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { openAppContext, type AppContext } from './context.js';

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
});

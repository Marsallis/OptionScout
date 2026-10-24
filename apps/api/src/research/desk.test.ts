import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';

const contexts: AppContext[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function boot(publicSimulatedDemo: boolean): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-desk-'));
  directories.push(directory);
  const config = parseConfig({
    NODE_ENV: 'test',
    PORT: '0',
    BIND_HOST: '127.0.0.1',
    DATABASE_PATH: path.join(directory, 'optionscout.sqlite'),
    DATA_MODE: 'demo',
    AUTH_MODE: 'local-owner',
    ENABLE_ORDER_EXECUTION: 'false',
    TELEMETRY_ENABLED: 'false',
    RUNNING_IN_DOCKER: 'false',
    STATIC_DIR: '',
    PUBLIC_SIMULATED_DEMO: publicSimulatedDemo ? 'true' : 'false',
  });
  const context = await openAppContext(config);
  contexts.push(context);
  return context;
}

const entry = {
  entryDate: '2026-10-15',
  ticker: 'demo',
  strategy: 'PMCC',
  entryPremium: '18.00',
  exitPremium: '20.50',
  notes: 'Simulated journal note.',
  tags: ['practice'],
  outcome: 'win',
};

describe('research desk', () => {
  it('creates, updates, and deletes journal entries and summarizes them', async () => {
    const app = createApp(await boot(true));
    const created = await request(app).post('/api/journal').send(entry);
    expect(created.status).toBe(201);
    expect(created.body.ticker).toBe('DEMO');
    expect(created.body.estimatedPnl).toBe('250.00');

    const listed = await request(app).get('/api/journal');
    expect(listed.status).toBe(200);
    expect(listed.body.summary).toMatchObject({ count: 1, wins: 1, losses: 0, winRate: '100.0', totalEstimatedPnl: '250.00' });

    const updated = await request(app).put(`/api/journal/${created.body.id}`).send({ ...entry, outcome: 'loss', exitPremium: '10.00' });
    expect(updated.status).toBe(200);
    expect(updated.body.outcome).toBe('loss');
    expect(updated.body.estimatedPnl).toBe('-800.00');

    const removed = await request(app).delete(`/api/journal/${created.body.id}`);
    expect(removed.status).toBe(204);
    const empty = await request(app).get('/api/journal');
    expect(empty.body.summary.count).toBe(0);
  });

  it('serves a DEMO chain and a DEMO search from a non-loopback host while refusing orders and broker changes', async () => {
    const app = createApp(await boot(true));
    const host = 'preview.example.test';
    const chain = await request(app).get('/api/research/demo-chain').set('Host', host);
    expect(chain.status).toBe(200);
    expect(chain.body.underlying).toBe('DEMO');
    expect(chain.body.simulated).toBe(true);
    expect(chain.body.contracts.length).toBeGreaterThan(3);

    const scan = await request(app)
      .post('/api/finder/scans')
      .set('Host', host)
      .send({ underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm' });
    expect(scan.status).toBe(201);
    expect(scan.body.marketContext.simulated).toBe(true);
    expect(JSON.stringify(scan.body)).not.toMatch(/client_secret|refresh_token/i);

    expect((await request(app).post('/api/orders').set('Host', host).send({ symbol: 'DEMO' })).status).toBe(404);
    expect((await request(app).post('/api/broker/orders').set('Host', host).send({})).status).toBe(404);
    const credentials = await request(app).post('/api/broker/credentials').set('Host', host).send({ clientId: 'x', clientSecret: 'y', refreshToken: 'z' });
    expect(credentials.status).toBe(403);
    expect((await request(app).post('/api/broker/sync').set('Host', host).send({})).status).toBe(403);
    expect((await request(app).post('/api/broker/disconnect').set('Host', host).send({})).status).toBe(403);
    const liveSettings = await request(app)
      .put('/api/settings')
      .set('Host', host)
      .set('Origin', 'https://preview.example.test')
      .send({ portfolioView: 'brokerage' });
    expect(liveSettings.status).toBe(403);
  });

  it('keeps the default installation loopback-only for journal writes and remote scans', async () => {
    const app = createApp(await boot(false));
    const remote = await request(app).post('/api/finder/scans').set('Host', 'preview.example.test').send({ underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm' });
    expect(remote.status).toBe(403);
    const journal = await request(app).post('/api/journal').set('Origin', 'http://127.0.0.1').send(entry);
    expect(journal.status).toBe(401);
    expect((await request(app).post('/api/orders').send({})).status).toBe(404);
  });
});

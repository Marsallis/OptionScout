import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { seedDemoFixtures } from '../db/seed.js';
import { legs } from '../demo/fixtures.js';
import { createProviders } from './mocks.js';

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function openSeeded() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-providers-'));
  directories.push(directory);
  const opened = openDatabase(path.join(directory, 'test.sqlite'));
  applyMigrations(opened.sqlite, migrationsDirectory());
  seedDemoFixtures(opened.db);
  return opened;
}

describe('mock providers', () => {
  it('reads local fixtures and does not call fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const opened = openSeeded();
    const providers = createProviders(opened.db);
    const aapl = legs.find((leg) => leg.id === 'leg_aapl');
    expect(aapl).toBeDefined();

    const status = await providers.brokerage.getConnectionStatus();
    const quotes = await providers.marketData.getQuotes([aapl!.instrumentKey]);
    const sync = await providers.sync.syncAccount('acct_demo');
    const stream = providers.quotes.getStatus();
    const research = await providers.research.listCandidates();

    expect(status.ordersEnabled).toBe(false);
    expect(status.oauthImplemented).toBe(false);
    expect(quotes).toEqual([
      expect.objectContaining({
        instrumentKey: aapl!.instrumentKey,
        source: 'demo-fixture',
        isDemo: true,
        mark: 48.1,
      }),
    ]);
    expect(sync.externalRequestCount).toBe(0);
    expect(stream.implemented).toBe(false);
    expect(stream.state).toBe('not-connected');
    expect(research.length).toBeGreaterThan(0);
    expect(research.every((item) => item.isDemo)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    opened.close();
  });
});

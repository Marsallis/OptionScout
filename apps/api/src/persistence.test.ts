import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { startServer, type RunningServer } from './server.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function envFor(databasePath: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PORT: '0',
    BIND_HOST: '127.0.0.1',
    DATABASE_PATH: databasePath,
    DATA_MODE: 'demo',
    AUTH_MODE: 'local-owner',
    ENABLE_ORDER_EXECUTION: 'false',
    TELEMETRY_ENABLED: 'false',
    RUNNING_IN_DOCKER: 'false',
    STATIC_DIR: '',
  };
}

async function boot(databasePath: string): Promise<RunningServer> {
  return startServer(parseConfig(envFor(databasePath)));
}

describe('persistence across restart', () => {
  it('keeps the demo book and saved settings after the server stops', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-persist-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'optionscout.sqlite');

    const first = await boot(databasePath);
    const health1 = await fetch(`${first.baseUrl}/api/health`).then((response) => response.json());
    expect(health1.bootCount).toBe(1);
    const saved = await fetch(`${first.baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' },
      body: JSON.stringify({ density: 'compact' }),
    }).then((response) => response.json());
    expect(saved.density).toBe('compact');
    await first.close();

    const second = await boot(databasePath);
    try {
      const health2 = await fetch(`${second.baseUrl}/api/health`).then((response) => response.json());
      const settings = await fetch(`${second.baseUrl}/api/settings`).then((response) => response.json());
      const dashboard = await fetch(`${second.baseUrl}/api/dashboard`).then((response) => response.json());
      const migrations = second.context.database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get() as { count: number };
      const positions = second.context.database.sqlite
        .prepare('SELECT COUNT(*) AS count FROM positions')
        .get() as { count: number };

      expect(health2.bootCount).toBe(2);
      expect(settings.density).toBe('compact');
      expect(dashboard.summary.openPositions).toBe(4);
      expect(dashboard.demo).toBe(true);
      expect(migrations.count).toBe(15);
      expect(positions.count).toBe(4);
    } finally {
      await second.close();
    }
  });
});

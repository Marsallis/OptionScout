import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { applyMigrations, migrationsDirectory } from './db/migrate.js';
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

  it('upgrades a v0.2.1 database without removing an existing brokerage row', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-upgrade-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'optionscout.sqlite');
    const sqlite = new Database(databasePath);
    const migrationsDir = migrationsDirectory();
    sqlite.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`);
    for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql') && name < '0015').sort()) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      sqlite.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, '2026-10-20T00:00:00.000Z');
    }
    sqlite.prepare(`INSERT INTO broker_accounts (
      id, provider, account_number, account_type, authority, masked_label, selected, transaction_history_status, discovered_at
    ) VALUES ('acct', 'tastytrade', 'FICTIONAL', 'Individual', 'owner', '••••ONAL', 1, 'not_imported', '2026-10-20T00:00:00.000Z')`).run();
    sqlite.prepare(`INSERT INTO broker_transactions (
      id, broker_account_id, provider_transaction_id, symbol, instrument_type, action, quantity, price, executed_at,
      gross_value, value_effect, commission, fees_json, transaction_type, transaction_subtype, classification, raw_json
    ) VALUES ('tx1', 'acct', 'p1', 'ZZT', 'Equity Option', 'Buy to Open', '1', '1', '2026-01-01T00:00:00.000Z', '1', 'Debit', '0', '{}', 'Trade', 'Buy to Open', 'trade', '{}')`).run();
    sqlite.close();
    const opened = openDatabase(databasePath);
    try {
      const applied = applyMigrations(opened.sqlite, migrationsDirectory());
      expect(applied).toEqual(['0015_saved_pmcc_ideas.sql']);
      const kept = opened.sqlite.prepare('SELECT id FROM broker_transactions WHERE id = ?').get('tx1') as { id: string };
      expect(kept.id).toBe('tx1');
      expect(opened.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'saved_pmcc_ideas'`).get()).toBeTruthy();
    } finally {
      opened.close();
    }
  });
});

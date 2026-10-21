import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { setupOwnerPassphrase } from '../auth/owner.js';
import { createApp } from '../app.js';
import { parseConfig } from '../config.js';
import { openAppContext } from '../context.js';
import { openDatabase, type OpenedDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { brokerAccounts, brokerTransactions } from '../db/schema.js';
import { readConnectionMode, saveManagedCredentials } from './connection.js';

const directories: string[] = [];
const databases: OpenedDatabase[] = [];

afterEach(() => {
  for (const opened of databases.splice(0)) opened.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('acceptance fixture and legacy upgrade', () => {
  it('keeps the fixture off unless the process asks for it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-fixture-config-'));
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
      STATIC_DIR: '',
    }, { secretFilePath: path.join(directory, 'missing.env') });
    expect(config.acceptanceFixture).toBe(false);
  });

  it('imports only the chosen fictional account and does not call the network', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-fixture-http-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
    const config = parseConfig({
      NODE_ENV: 'test',
      PORT: '0',
      BIND_HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      DATA_MODE: 'demo',
      AUTH_MODE: 'local-owner',
      ENABLE_ORDER_EXECUTION: 'false',
      TELEMETRY_ENABLED: 'false',
      STATIC_DIR: '',
      TASTYTRADE_ACCEPTANCE_FIXTURE: 'true',
    }, { secretFilePath: path.join(directory, 'missing.env') });
    const context = await openAppContext(config);
    databases.push(context.database);
    setupOwnerPassphrase(context.database.db, 'correct horse battery');
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      calls.push(String(input));
      throw new Error('network was called');
    }) as typeof fetch;
    try {
      const app = createApp(context);
      const agent = request.agent(app);
      const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'correct horse battery' });
      const saved = await agent.post('/api/broker/credentials').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({
        environment: 'sandbox',
        clientId: 'fixture-client-id',
        clientSecret: 'fixture-secret-value',
        refreshToken: 'fixture-refresh-token',
      });
      expect(saved.status).toBe(200);
      expect(JSON.stringify(saved.body)).not.toContain('fixture-secret-value');
      expect(calls).toEqual([]);
      const tested = await agent.post('/api/broker/test-connection').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
      expect(tested.status).toBe(200);
      expect(tested.body.connection.message).toMatch(/was not contacted/);
      expect(tested.body.connection.accountChoices).toHaveLength(2);
      expect(JSON.stringify(tested.body)).not.toContain('ZZQA000111');
      expect(JSON.stringify(tested.body)).not.toContain('ZZQA000222');
      const chosen = tested.body.connection.accountChoices.find((item: { maskedAccount: string }) => item.maskedAccount.endsWith('0111'));
      const other = tested.body.connection.accountChoices.find((item: { maskedAccount: string }) => item.maskedAccount.endsWith('0222'));
      const selected = await agent.post('/api/broker/accounts/choose').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({ choiceId: chosen.choiceId });
      expect(selected.status).toBe(200);
      const imported = await agent.post('/api/broker/sync').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
      expect(imported.status).toBe(200);
      const before = context.database.sqlite.prepare('SELECT symbol FROM broker_transactions ORDER BY symbol').all();
      expect(before).toEqual([{ symbol: 'ZZT   280121C00155000' }]);
      const blocked = await agent.post('/api/broker/accounts/choose').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({ choiceId: other.choiceId });
      expect(blocked.status).toBe(409);
      const after = context.database.sqlite.prepare('SELECT symbol FROM broker_transactions ORDER BY symbol').all();
      expect(after).toEqual(before);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('upgrades an older database without disconnecting a legacy read-only file', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-upgrade-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
    const legacyPath = path.join(directory, 'secrets', 'tastytrade.env');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      'TASTYTRADE_ENVIRONMENT=production\nTASTYTRADE_CLIENT_ID=legacy-client-id\nTASTYTRADE_CLIENT_SECRET=legacy-secret-value\nTASTYTRADE_REFRESH_TOKEN=legacy-refresh-token\n',
    );
    const prior = path.join(directory, 'migrations');
    fs.mkdirSync(prior, { recursive: true });
    for (const name of fs.readdirSync(migrationsDirectory())) {
      if (name < '0015') fs.copyFileSync(path.join(migrationsDirectory(), name), path.join(prior, name));
    }
    const opened = openDatabase(databasePath);
    applyMigrations(opened.sqlite, prior);
    const accountId = 'acct-upgrade';
    opened.db.insert(brokerAccounts).values({
      id: accountId,
      provider: 'tastytrade',
      accountNumber: 'ZZQA000111',
      accountType: 'Individual',
      authority: 'owner',
      maskedLabel: '••••0111',
      selected: true,
      transactionHistoryStatus: 'complete',
      historyCoverageStart: '2025-10-15',
      historyCoverageEnd: '2026-10-15',
      discoveredAt: '2026-10-15T20:00:00.000Z',
    }).run();
    opened.db.insert(brokerTransactions).values({
      id: 'tx-upgrade',
      brokerAccountId: accountId,
      providerTransactionId: 'keep-me',
      symbol: 'CVX   280121C00155000',
      instrumentType: 'Equity Option',
      action: 'Buy to Open',
      quantity: '1',
      price: '20',
      executedAt: '2026-09-08T14:58:45.000Z',
      grossValue: '2000.00',
      valueEffect: 'Debit',
      commission: '0.00',
      feesJson: '{}',
      transactionType: 'Trade',
      transactionSubtype: 'Buy to Open',
      classification: 'trade',
      rawJson: '{}',
    }).run();
    opened.close();
    const context = await openAppContext(parseConfig({
      NODE_ENV: 'test',
      PORT: '0',
      BIND_HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      DATA_MODE: 'demo',
      AUTH_MODE: 'local-owner',
      ENABLE_ORDER_EXECUTION: 'false',
      TELEMETRY_ENABLED: 'false',
      STATIC_DIR: '',
      TASTYTRADE_ENABLE_LIVE: 'true',
    }, { secretFilePath: legacyPath }));
    databases.push(context.database);
    const names = context.database.sqlite.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toContain('0015_saved_pmcc_ideas.sql');
    const kept = context.database.sqlite.prepare('SELECT provider_transaction_id FROM broker_transactions').get() as { provider_transaction_id: string };
    expect(kept.provider_transaction_id).toBe('keep-me');
    expect(readConnectionMode(context.database.db)).toBe('legacy');
    expect(context.brokerConnection).toMatchObject({ mode: 'legacy', source: 'legacy', providerAllowed: true, hardDisabled: false });
    expect(context.database.sqlite.prepare("SELECT value FROM app_meta WHERE key = 'broker.connection.mode'").get()).toBeUndefined();
  });

  it('does not activate the fictional brokerage fixture in production', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-fixture-prod-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
    const secretPath = path.join(directory, 'missing.env');
    const base = {
      PORT: '3224',
      BIND_HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      DATA_MODE: 'demo',
      AUTH_MODE: 'local-owner',
      ENABLE_ORDER_EXECUTION: 'false',
      TELEMETRY_ENABLED: 'false',
      STATIC_DIR: '',
      TASTYTRADE_ACCEPTANCE_FIXTURE: 'true',
    };
    const prepared = await openAppContext(parseConfig({ ...base, NODE_ENV: 'test' }, { secretFilePath: secretPath }));
    saveManagedCredentials(prepared.database.db, databasePath, {
      environment: 'production',
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-secret-value',
      refreshToken: 'fixture-refresh-token',
    });
    prepared.close();
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      calls.push(String(input));
      throw new Error('network was called');
    }) as typeof fetch;
    try {
      const config = parseConfig({ ...base, NODE_ENV: 'production' }, { secretFilePath: secretPath });
      expect(config.acceptanceFixture).toBe(false);
      const context = await openAppContext(config);
      databases.push(context.database);
      expect(context.brokerage?.constructor.name).toBe('TastytradeClient');
      expect(calls).toEqual([]);
      expect(context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get()).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = original;
    }
  });
});

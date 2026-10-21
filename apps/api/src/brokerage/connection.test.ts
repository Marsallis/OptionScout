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
import {
  CredentialInputError,
  accountFingerprint,
  disconnectBroker,
  importNeedsDecision,
  managedSecretPath,
  readConnectionMode,
  rememberImportFingerprint,
  resolveActiveConnection,
  saveManagedCredentials,
  selectedImportAccount,
  stageAccountChoices,
  chooseStagedAccount,
  validateCredentialInput,
} from './connection.js';

const directories: string[] = [];
const databases: OpenedDatabase[] = [];

function layout(): { directory: string; databasePath: string; legacyPath: string; db: OpenedDatabase['db'] } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-connection-'));
  directories.push(directory);
  const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
  const opened = openDatabase(databasePath);
  databases.push(opened);
  applyMigrations(opened.sqlite, migrationsDirectory());
  const legacyPath = path.join(directory, 'secrets', 'tastytrade.env');
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(
    legacyPath,
    'TASTYTRADE_ENVIRONMENT=production\nTASTYTRADE_CLIENT_ID=legacy-client-id\nTASTYTRADE_CLIENT_SECRET=legacy-secret-value\nTASTYTRADE_REFRESH_TOKEN=legacy-refresh-token\n',
  );
  return { directory, databasePath, legacyPath, db: opened.db };
}

afterEach(() => {
  for (const opened of databases.splice(0)) opened.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const managedInput = {
  environment: 'sandbox' as const,
  clientId: 'managed-client-id',
  clientSecret: 'managed-secret-value',
  refreshToken: 'managed-refresh-token',
};

describe('brokerage connection precedence', () => {
  it('rejects newlines and comments before writing a file', () => {
    expect(() => validateCredentialInput({ ...managedInput, clientSecret: 'line\nTASTYTRADE_ENVIRONMENT=production' })).toThrow(CredentialInputError);
    expect(() => validateCredentialInput({ ...managedInput, refreshToken: 'token # note' })).toThrow(CredentialInputError);
    expect(() => validateCredentialInput({ ...managedInput, environment: 'cert' })).toThrow(/production or sandbox/);
  });

  it('uses the legacy file until the owner saves a managed file', () => {
    const { databasePath, legacyPath, db } = layout();
    const legacy = resolveActiveConnection({ db, databasePath, legacySecretPath: legacyPath, liveEnabled: true, hardDisabled: false });
    expect(legacy).toMatchObject({ mode: 'legacy', source: 'legacy', environment: 'production', providerAllowed: true });
    expect(legacy.credentials?.clientId).toBe('legacy-client-id');
    saveManagedCredentials(db, databasePath, managedInput);
    const managed = resolveActiveConnection({ db, databasePath, legacySecretPath: legacyPath, liveEnabled: false, hardDisabled: false });
    expect(managed).toMatchObject({ mode: 'managed', source: 'managed', environment: 'sandbox', providerAllowed: true });
    expect(managed.credentials?.refreshToken).toBe('managed-refresh-token');
    expect(fs.readFileSync(legacyPath, 'utf8')).toContain('legacy-refresh-token');
  });

  it('keeps a disconnect in effect across a fresh read and ignores a live-enable flag', () => {
    const { databasePath, legacyPath, db } = layout();
    saveManagedCredentials(db, databasePath, managedInput);
    disconnectBroker(db, databasePath);
    expect(fs.existsSync(managedSecretPath(databasePath))).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(true);
    const again = resolveActiveConnection({ db, databasePath, legacySecretPath: legacyPath, liveEnabled: true, hardDisabled: false });
    expect(again).toMatchObject({ mode: 'disconnected', source: 'none', credentials: null, providerAllowed: false });
    expect(readConnectionMode(db)).toBe('disconnected');
  });

  it('blocks every provider call when the hard-disable switch is on', () => {
    const { databasePath, legacyPath, db } = layout();
    saveManagedCredentials(db, databasePath, managedInput);
    const blocked = resolveActiveConnection({ db, databasePath, legacySecretPath: legacyPath, liveEnabled: true, hardDisabled: true });
    expect(blocked.providerAllowed).toBe(false);
    expect(blocked.hardDisabled).toBe(true);
    expect(blocked.credentials?.clientSecret).toBe('managed-secret-value');
  });

  it('lists every accessible account and imports only the one the owner confirms', () => {
    const { db } = layout();
    const one = stageAccountChoices(db, 'production', [{ accountNumber: 'FICTIONAL1', accountType: 'Individual' }]);
    expect(one).toHaveLength(1);
    expect(one[0]?.maskedAccount).toBe('••••NAL1');
    expect(JSON.stringify(one)).not.toContain('FICTIONAL1');
    expect(() => chooseStagedAccount(db, one[0]?.choiceId ?? '')).not.toThrow();
    expect(selectedImportAccount(db)).toEqual({ accountNumber: 'FICTIONAL1', environment: 'production' });

    const many = stageAccountChoices(db, 'production', [
      { accountNumber: 'FICTIONAL1', accountType: 'Individual' },
      { accountNumber: 'FICTIONAL2', accountType: 'IRA' },
    ]);
    expect(many.map((choice) => choice.maskedAccount)).toEqual(['••••NAL1', '••••NAL2']);
    expect(JSON.stringify(many)).not.toContain('FICTIONAL2');
    const again = many.find((choice) => choice.maskedAccount.endsWith('NAL1'));
    expect(again).toBeTruthy();
    rememberImportFingerprint(db, accountFingerprint('production', ['FICTIONAL1']));
    expect(() => chooseStagedAccount(db, again?.choiceId ?? '')).not.toThrow();
    const other = many.find((choice) => choice.maskedAccount.endsWith('NAL2'));
    expect(() => chooseStagedAccount(db, other?.choiceId ?? '')).toThrow(/different from the imported history/);
    expect(selectedImportAccount(db)?.accountNumber).toBe('FICTIONAL1');

    const sandbox = stageAccountChoices(db, 'sandbox', [{ accountNumber: 'FICTIONAL1', accountType: 'Individual' }]);
    expect(() => chooseStagedAccount(db, sandbox[0]?.choiceId ?? '')).toThrow(/different from the imported history/);
    expect(selectedImportAccount(db)).toEqual({ accountNumber: 'FICTIONAL1', environment: 'production' });
    expect(importNeedsDecision(db, accountFingerprint('sandbox', ['FICTIONAL1']))).toBe(true);
    expect(importNeedsDecision(db, accountFingerprint('production', ['FICTIONAL1']))).toBe(false);
  });

  it('does not attach existing brokerage history to a different account', () => {
    const { db } = layout();
    const accountId = 'acct-history';
    db.insert(brokerAccounts).values({
      id: accountId,
      provider: 'tastytrade',
      accountNumber: 'ZZQA000111',
      accountType: 'Individual',
      authority: 'owner',
      maskedLabel: '••••0111',
      selected: true,
      transactionHistoryStatus: 'complete',
      historyCoverageStart: null,
      historyCoverageEnd: null,
      discoveredAt: '2026-10-15T20:00:00.000Z',
    }).run();
    db.insert(brokerTransactions).values({
      id: 'tx-history',
      brokerAccountId: accountId,
      providerTransactionId: 'keep-history',
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
    const choices = stageAccountChoices(db, 'production', [
      { accountNumber: 'ZZQA000111', accountType: 'Individual' },
      { accountNumber: 'ZZQA000222', accountType: 'IRA' },
    ]);
    const other = choices.find((choice) => choice.maskedAccount.endsWith('0222'));
    const same = choices.find((choice) => choice.maskedAccount.endsWith('0111'));
    expect(() => chooseStagedAccount(db, other?.choiceId ?? '')).toThrow(/another account/);
    expect(selectedImportAccount(db)).toBeNull();
    expect(db.select().from(brokerTransactions).all()).toHaveLength(1);
    expect(() => chooseStagedAccount(db, same?.choiceId ?? '')).not.toThrow();
    expect(selectedImportAccount(db)?.accountNumber).toBe('ZZQA000111');
  });

  it('leaves the previous managed file in place when the new write cannot be restricted', () => {
    const { databasePath, db } = layout();
    saveManagedCredentials(db, databasePath, managedInput);
    const target = managedSecretPath(databasePath);
    const before = fs.readFileSync(target, 'utf8');
    const original = fs.chmodSync;
    fs.chmodSync = () => {
      throw new Error('chmod failed');
    };
    try {
      expect(() => saveManagedCredentials(db, databasePath, { ...managedInput, clientId: 'replacement-client' })).toThrow(/left unchanged/);
    } finally {
      fs.chmodSync = original;
    }
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
    expect(fs.readdirSync(path.dirname(target)).some((name) => name.includes('.tmp'))).toBe(false);
  });

  it('saves credentials only for a signed-in owner and never returns them', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-connection-http-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
    const legacyPath = path.join(directory, 'secrets', 'tastytrade.env');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      'TASTYTRADE_ENVIRONMENT=production\nTASTYTRADE_CLIENT_ID=legacy-client-id\nTASTYTRADE_CLIENT_SECRET=legacy-secret-value\nTASTYTRADE_REFRESH_TOKEN=legacy-refresh-token\n',
    );
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
      TASTYTRADE_ENABLE_LIVE: 'true',
    }, { secretFilePath: legacyPath });
    const context = await openAppContext(config);
    databases.push(context.database);
    setupOwnerPassphrase(context.database.db, 'correct horse battery');
    const app = createApp(context);
    const agent = request.agent(app);
    const anonymous = await agent.post('/api/broker/credentials').set('Origin', 'http://127.0.0.1').send(managedInput);
    expect(anonymous.status).toBe(401);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'correct horse battery' });
    const saved = await agent
      .post('/api/broker/credentials')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send(managedInput);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(managedInput.clientSecret);
    expect(JSON.stringify(saved.body)).not.toContain(managedInput.refreshToken);
    expect(saved.body.connection.connectionMode).toBe('managed');
    expect(saved.body.connection.providerAllowed).toBe(true);
    const disconnected = await agent.post('/api/broker/disconnect').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(disconnected.status).toBe(200);
    expect(disconnected.body.connection.connectionMode).toBe('disconnected');
    expect(disconnected.body.connection.providerAllowed).toBe(false);
    expect(disconnected.body.connection.message).toMatch(/separate action/i);
    const restarted = resolveActiveConnection({
      db: context.database.db,
      databasePath,
      legacySecretPath: legacyPath,
      liveEnabled: true,
      hardDisabled: false,
    });
    expect(restarted.providerAllowed).toBe(false);
    expect(restarted.credentials).toBeNull();
  });

  it('requires an explicit test, account choice, and import, and does not call the provider while saving', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-connection-flow-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
    const legacyPath = path.join(directory, 'secrets', 'tastytrade.env');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      'TASTYTRADE_ENVIRONMENT=production\nTASTYTRADE_CLIENT_ID=legacy-client-id\nTASTYTRADE_CLIENT_SECRET=legacy-secret-value\nTASTYTRADE_REFRESH_TOKEN=legacy-refresh-token\n',
    );
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
      TASTYTRADE_ENABLE_LIVE: 'true',
    }, { secretFilePath: legacyPath });
    const context = await openAppContext(config);
    databases.push(context.database);
    setupOwnerPassphrase(context.database.db, 'correct horse battery');
    const app = createApp(context);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'correct horse battery' });
    const calls: string[] = [];
    const primary = 'ZZQA000111';
    const other = 'ZZQA000222';
    const saved = await agent
      .post('/api/broker/credentials')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send(managedInput);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(managedInput.clientSecret);
    expect(JSON.stringify(saved.body)).not.toContain(managedInput.refreshToken);
    expect(context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_accounts').get()).toEqual({ count: 0 });
    expect(fs.existsSync(managedSecretPath(databasePath))).toBe(true);
    context.brokerage = {
      async getJson(requestPath: string) {
        calls.push(requestPath);
        if (requestPath === '/customers/me/accounts') {
          return {
            data: {
              items: [
                { account: { 'account-number': primary, 'account-type-name': 'Individual' } },
                { account: { 'account-number': other, 'account-type-name': 'IRA' } },
              ],
            },
          };
        }
        if (requestPath.endsWith('/positions') || requestPath.endsWith('/transactions')) {
          return { data: { items: [] }, pagination: { 'page-offset': 0, 'total-pages': 1 } };
        }
        return { data: { items: [] } };
      },
    };
    const premature = await agent.post('/api/broker/sync').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(premature.status).toBe(409);
    expect(calls).toEqual([]);
    const tested = await agent.post('/api/broker/test-connection').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(tested.status).toBe(200);
    expect(tested.body.connection.accountChoices).toHaveLength(2);
    const testedText = JSON.stringify(tested.body);
    expect(testedText).not.toContain(primary);
    expect(testedText).not.toContain(other);
    expect(testedText).not.toContain(managedInput.clientSecret);
    expect(context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_accounts').get()).toEqual({ count: 0 });
    const choice = tested.body.connection.accountChoices.find((item: { maskedAccount: string }) => item.maskedAccount.endsWith('0111'));
    const rejected = tested.body.connection.accountChoices.find((item: { maskedAccount: string }) => item.maskedAccount.endsWith('0222'));
    const chosen = await agent.post('/api/broker/accounts/choose').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({ choiceId: choice.choiceId });
    expect(chosen.status).toBe(200);
    expect(chosen.body.connection.accountSelected).toBe(true);
    expect(JSON.stringify(chosen.body)).not.toContain(primary);
    const imported = await agent.post('/api/broker/sync').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(imported.status).toBe(200);
    expect(calls.some((item) => item.includes(primary))).toBe(true);
    expect(calls.some((item) => item.includes(other))).toBe(false);
    expect(context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_accounts').get()).toEqual({ count: 1 });
    const blocked = await agent.post('/api/broker/accounts/choose').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({ choiceId: rejected.choiceId });
    expect(blocked.status).toBe(409);
    expect(context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_accounts').get()).toEqual({ count: 1 });
    const orders = await agent.post('/api/orders').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(orders.status).toBe(404);
    const beforeDisconnect = calls.length;
    const disconnected = await agent.post('/api/broker/disconnect').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(disconnected.status).toBe(200);
    const afterRestart = await agent.post('/api/broker/test-connection').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(afterRestart.status).toBe(409);
    expect(calls).toHaveLength(beforeDisconnect);
    expect(fs.existsSync(legacyPath)).toBe(true);
    expect(fs.existsSync(managedSecretPath(databasePath))).toBe(false);
  });

  it('blocks Test Connection when live brokerage access is hard-disabled', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-connection-hard-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'data', 'optionscout.sqlite');
    const legacyPath = path.join(directory, 'secrets', 'tastytrade.env');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(
      legacyPath,
      'TASTYTRADE_ENVIRONMENT=sandbox\nTASTYTRADE_CLIENT_ID=managed-client-id\nTASTYTRADE_CLIENT_SECRET=managed-secret-value\nTASTYTRADE_REFRESH_TOKEN=managed-refresh-token\n',
    );
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
      TASTYTRADE_ENABLE_LIVE: 'true',
      TASTYTRADE_DISABLE_LIVE: 'true',
    }, { secretFilePath: legacyPath });
    const context = await openAppContext(config);
    databases.push(context.database);
    setupOwnerPassphrase(context.database.db, 'correct horse battery');
    saveManagedCredentials(context.database.db, databasePath, managedInput);
    const app = createApp(context);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase: 'correct horse battery' });
    const tested = await agent.post('/api/broker/test-connection').set('Origin', 'http://127.0.0.1').set('X-CSRF-Token', loggedIn.body.csrfToken).send({});
    expect(tested.status).toBe(409);
    expect(tested.body.error).toMatch(/TASTYTRADE_DISABLE_LIVE/);
    expect(context.brokerage).toBeNull();
  });
});

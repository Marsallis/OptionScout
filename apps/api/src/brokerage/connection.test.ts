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
  singleAccountImport,
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

  it('requires an explicit decision when the imported account fingerprint changes', () => {
    const { db } = layout();
    rememberImportFingerprint(db, accountFingerprint('production', ['AAA']));
    expect(importNeedsDecision(db, accountFingerprint('production', ['AAA']))).toBe(false);
    expect(importNeedsDecision(db, accountFingerprint('sandbox', ['AAA']))).toBe(true);
    expect(importNeedsDecision(db, accountFingerprint('production', ['BBB']))).toBe(true);
    expect(() => singleAccountImport(db, 'production', ['AAA', 'BBB'])).toThrow(/one brokerage account/);
    expect(() => singleAccountImport(db, 'sandbox', ['AAA'])).toThrow(/different account or environment/);
    expect(singleAccountImport(db, 'production', ['AAA']).fingerprint).toBe(accountFingerprint('production', ['AAA']));
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
});

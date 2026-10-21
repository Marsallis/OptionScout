import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../db/client.js';
import { readMeta, writeMeta } from '../db/meta.js';
import type { TastytradeCredentials } from '../config.js';

export const CONNECTION_MODE_KEY = 'broker.connection.mode';
export const IMPORT_FINGERPRINT_KEY = 'broker.import.fingerprint';
export const PENDING_FINGERPRINT_KEY = 'broker.pending.fingerprint';

export type ConnectionMode = 'legacy' | 'managed' | 'disconnected';
export type BrokerEnvironment = 'sandbox' | 'production';

export class CredentialInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialInputError';
  }
}

const SECRET_KEYS = ['TASTYTRADE_ENVIRONMENT', 'TASTYTRADE_CLIENT_ID', 'TASTYTRADE_CLIENT_SECRET', 'TASTYTRADE_REFRESH_TOKEN'] as const;

export function managedSecretPath(databasePath: string): string {
  return path.join(path.dirname(path.resolve(databasePath)), 'tastytrade.env');
}

export function readConnectionMode(db: AppDatabase): ConnectionMode {
  const value = readMeta(db, CONNECTION_MODE_KEY);
  if (value === 'managed' || value === 'disconnected' || value === 'legacy') return value;
  return 'legacy';
}

function rejectInjected(label: string, value: string): void {
  if (value !== value.trim() || /[\r\n\0]/.test(value) || value.includes('#')) {
    throw new CredentialInputError(`${label} contains characters that cannot be stored.`);
  }
}

export function validateCredentialInput(input: {
  environment: unknown;
  clientId: unknown;
  clientSecret: unknown;
  refreshToken: unknown;
}): { environment: BrokerEnvironment; clientId: string; clientSecret: string; refreshToken: string } {
  if (input.environment !== 'sandbox' && input.environment !== 'production') {
    throw new CredentialInputError('Environment must be production or sandbox.');
  }
  for (const [label, value] of [
    ['Client ID', input.clientId],
    ['Client Secret', input.clientSecret],
    ['Refresh token', input.refreshToken],
  ] as const) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 512) {
      throw new CredentialInputError(`${label} is not a usable value.`);
    }
    rejectInjected(label, value);
  }
  return {
    environment: input.environment,
    clientId: input.clientId as string,
    clientSecret: input.clientSecret as string,
    refreshToken: input.refreshToken as string,
  };
}

export function renderSecretFile(values: {
  environment: BrokerEnvironment;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): string {
  return [
    'TASTYTRADE_ENVIRONMENT=' + values.environment,
    'TASTYTRADE_CLIENT_ID=' + values.clientId,
    'TASTYTRADE_CLIENT_SECRET=' + values.clientSecret,
    'TASTYTRADE_REFRESH_TOKEN=' + values.refreshToken,
    '',
  ].join('\n');
}

function readSecretFile(filePath: string): Record<string, string> | null {
  if (!fs.existsSync(filePath)) return null;
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function complete(values: Record<string, string> | null): values is Record<string, string> {
  if (!values) return false;
  return SECRET_KEYS.every((key) => Boolean(values[key])) && (values.TASTYTRADE_ENVIRONMENT === 'sandbox' || values.TASTYTRADE_ENVIRONMENT === 'production');
}

function toCredentials(values: Record<string, string>): TastytradeCredentials {
  return {
    clientId: values.TASTYTRADE_CLIENT_ID ?? '',
    clientSecret: values.TASTYTRADE_CLIENT_SECRET ?? '',
    refreshToken: values.TASTYTRADE_REFRESH_TOKEN ?? '',
  };
}

export interface ActiveBrokerConnection {
  mode: ConnectionMode;
  source: 'none' | 'managed' | 'legacy';
  environment: 'unset' | BrokerEnvironment;
  credentials: TastytradeCredentials | null;
  /** Explicit provider calls are allowed. Startup still must not call the provider. */
  providerAllowed: boolean;
  hardDisabled: boolean;
  permissionWarning: string | null;
}

export function resolveActiveConnection(input: {
  db: AppDatabase;
  databasePath: string;
  legacySecretPath: string;
  liveEnabled: boolean;
  hardDisabled: boolean;
}): ActiveBrokerConnection {
  const mode = readConnectionMode(input.db);
  const managed = readSecretFile(managedSecretPath(input.databasePath));
  const legacy = readSecretFile(input.legacySecretPath);
  if (mode === 'disconnected') {
    return { mode, source: 'none', environment: 'unset', credentials: null, providerAllowed: false, hardDisabled: input.hardDisabled, permissionWarning: null };
  }
  const chosen = mode === 'managed' ? managed : legacy;
  const source = mode === 'managed' ? 'managed' : 'legacy';
  const environment = chosen?.TASTYTRADE_ENVIRONMENT === 'sandbox' || chosen?.TASTYTRADE_ENVIRONMENT === 'production' ? chosen.TASTYTRADE_ENVIRONMENT : 'unset';
  const credentials = complete(chosen) ? toCredentials(chosen) : null;
  const armed = source === 'managed' || input.liveEnabled;
  return {
    mode,
    source: credentials ? source : 'none',
    environment,
    credentials,
    providerAllowed: !input.hardDisabled && armed && credentials !== null,
    hardDisabled: input.hardDisabled,
    permissionWarning: null,
  };
}

function restrictPermissions(filePath: string): string | null {
  fs.chmodSync(filePath, 0o600);
  if (process.platform === 'win32') {
    return 'This Windows process cannot enforce Unix mode 0600. Use the Docker install for restrictive file permissions.';
  }
  const mode = fs.statSync(filePath).mode & 0o777;
  if (mode !== 0o600) {
    throw new CredentialInputError('Credential file permissions could not be restricted. The previous configuration was left unchanged.');
  }
  return null;
}

export function saveManagedCredentials(
  db: AppDatabase,
  databasePath: string,
  input: { environment: BrokerEnvironment; clientId: string; clientSecret: string; refreshToken: string },
): { permissionWarning: string | null } {
  const target = managedSecretPath(databasePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.tastytrade.${randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, renderSecretFile(input), { mode: 0o600 });
    const permissionWarning = restrictPermissions(temporary);
    fs.renameSync(temporary, target);
    if (process.platform !== 'win32') restrictPermissions(target);
    writeMeta(db, CONNECTION_MODE_KEY, 'managed');
    writeMeta(db, PENDING_FINGERPRINT_KEY, '');
    return { permissionWarning };
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    if (error instanceof CredentialInputError) throw error;
    throw new CredentialInputError('The credential file could not be saved. The previous configuration was left unchanged.');
  }
}

export function disconnectBroker(db: AppDatabase, databasePath: string): void {
  writeMeta(db, CONNECTION_MODE_KEY, 'disconnected');
  writeMeta(db, PENDING_FINGERPRINT_KEY, '');
  const managed = managedSecretPath(databasePath);
  if (fs.existsSync(managed)) fs.rmSync(managed, { force: true });
}

export function accountFingerprint(environment: string, accountNumbers: string[]): string {
  const names = [...accountNumbers].map((value) => value.trim()).filter(Boolean).sort();
  return createHash('sha256').update(`${environment}\n${names.join('\n')}`).digest('hex');
}

export function singleAccountImport(db: AppDatabase, environment: string, accountNumbers: string[]): { fingerprint: string } {
  if (accountNumbers.length === 0) {
    throw new Error('The brokerage did not confirm an account. Nothing was imported.');
  }
  if (accountNumbers.length > 1) {
    throw new Error('This install keeps one brokerage account. The grant can see more than one account, so nothing was imported. Use a separate OptionScout data volume for another account.');
  }
  const fingerprint = accountFingerprint(environment, accountNumbers);
  if (importNeedsDecision(db, fingerprint)) {
    rememberPendingFingerprint(db, fingerprint);
    throw new Error('This grant is for a different account or environment than the imported history. Existing records were not changed or combined. Use a separate Docker data volume for that account.');
  }
  return { fingerprint };
}

export function importNeedsDecision(db: AppDatabase, nextFingerprint: string): boolean {
  const current = readMeta(db, IMPORT_FINGERPRINT_KEY);
  return Boolean(current) && current !== nextFingerprint;
}

export function rememberImportFingerprint(db: AppDatabase, fingerprint: string): void {
  writeMeta(db, IMPORT_FINGERPRINT_KEY, fingerprint);
  writeMeta(db, PENDING_FINGERPRINT_KEY, '');
}

export function rememberPendingFingerprint(db: AppDatabase, fingerprint: string): void {
  writeMeta(db, PENDING_FINGERPRINT_KEY, fingerprint);
}

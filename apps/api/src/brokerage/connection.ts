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

const ACCOUNT_CHOICES_KEY = 'broker.account.choices';
const stagedAccounts = new Map<string, { environment: string; accountNumber: string; accountType: string }>();

export function disconnectBroker(db: AppDatabase, databasePath: string): void {
  stagedAccounts.clear();
  writeMeta(db, CONNECTION_MODE_KEY, 'disconnected');
  writeMeta(db, PENDING_FINGERPRINT_KEY, '');
  writeMeta(db, ACCOUNT_CHOICES_KEY, '');
  const managed = managedSecretPath(databasePath);
  if (fs.existsSync(managed)) fs.rmSync(managed, { force: true });
}

export function accountFingerprint(environment: string, accountNumbers: string[]): string {
  const names = [...accountNumbers].map((value) => value.trim()).filter(Boolean).sort();
  return createHash('sha256').update(`${environment}\n${names.join('\n')}`).digest('hex');
}

export type AccountChoice = { choiceId: string; maskedAccount: string; accountType: string };

export function stageAccountChoices(
  db: AppDatabase,
  environment: string,
  accounts: Array<{ accountNumber: string; accountType: string }>,
): AccountChoice[] {
  stagedAccounts.clear();
  const choices = accounts.map((account) => {
    const choiceId = createHash('sha256').update(`${environment}\n${account.accountNumber}`).digest('hex').slice(0, 16);
    stagedAccounts.set(choiceId, { environment, accountNumber: account.accountNumber, accountType: account.accountType });
    const tail = account.accountNumber.slice(-4);
    return { choiceId, maskedAccount: `••••${tail}`, accountType: account.accountType };
  });
  writeMeta(db, ACCOUNT_CHOICES_KEY, JSON.stringify(choices));
  return choices;
}

export function readAccountChoices(db: AppDatabase): AccountChoice[] {
  const raw = readMeta(db, ACCOUNT_CHOICES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const choice = item as { choiceId?: unknown; maskedAccount?: unknown; accountType?: unknown };
      if (typeof choice.choiceId !== 'string' || typeof choice.maskedAccount !== 'string' || typeof choice.accountType !== 'string') return [];
      if (/\d{5,}/.test(choice.maskedAccount)) return [];
      return [{ choiceId: choice.choiceId, maskedAccount: choice.maskedAccount, accountType: choice.accountType }];
    });
  } catch {
    return [];
  }
}

export function chooseStagedAccount(db: AppDatabase, choiceId: string): { fingerprint: string; maskedAccount: string; accountType: string } {
  const staged = stagedAccounts.get(choiceId);
  if (!staged) {
    throw new Error('Choose an account from the latest connection test. Nothing was imported.');
  }
  const fingerprint = accountFingerprint(staged.environment, [staged.accountNumber]);
  if (importNeedsDecision(db, fingerprint)) {
    rememberPendingFingerprint(db, fingerprint);
    throw new Error('This account or environment is different from the imported history. Existing records were not changed. Use a separate Docker data volume for that account.');
  }
  writeMeta(db, 'broker.selected.account', staged.accountNumber);
  writeMeta(db, 'broker.selected.environment', staged.environment);
  return { fingerprint, maskedAccount: `••••${staged.accountNumber.slice(-4)}`, accountType: staged.accountType };
}

export function selectedImportAccount(db: AppDatabase): { accountNumber: string; environment: string } | null {
  const accountNumber = readMeta(db, 'broker.selected.account');
  const environment = readMeta(db, 'broker.selected.environment');
  if (!accountNumber || (environment !== 'sandbox' && environment !== 'production')) return null;
  return { accountNumber, environment };
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

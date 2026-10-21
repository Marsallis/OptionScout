import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export class ConfigError extends Error {
  readonly code = 'UNSAFE_OR_UNSUPPORTED_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface TastytradeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  bindHost: string;
  databasePath: string;
  dataMode: 'demo';
  authMode: 'local-owner';
  ordersEnabled: false;
  telemetryEnabled: false;
  runningInDocker: boolean;
  staticDir: string | null;
  liveEnabled: boolean;
  hardDisabled: boolean;
  dxlinkLiveDiagnostic: boolean;
  finderLiveScan: boolean;
  smartScanLive: boolean;
  scheduledSyncEnabled: false;
  tastytradeEnvironment: 'unset' | 'sandbox' | 'production';
  transactionLookbackDays: number;
  secretFilePath: string;
  secretFileComplete: boolean;
  tastytrade: TastytradeCredentials | null;
}

const CREDENTIAL_KEYS = [
  'TASTYTRADE_CLIENT_SECRET',
  'TASTYTRADE_CLIENT_ID',
  'TASTYTRADE_REFRESH_TOKEN',
  'TASTYTRADE_ACCESS_TOKEN',
  'BROKER_CLIENT_SECRET',
  'BROKER_REFRESH_TOKEN',
  'BROKER_ACCESS_TOKEN',
] as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function defaultDatabasePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../data/optionscout.sqlite');
}

export function defaultStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../web/dist');
}

export function defaultSecretFilePath(): string {
  if (process.env.TASTYTRADE_SECRET_FILE?.trim()) {
    return process.env.TASTYTRADE_SECRET_FILE.trim();
  }
  return path.resolve(process.cwd(), 'secrets/tastytrade.env');
}

function rejectCredentialEnv(env: NodeJS.ProcessEnv): void {
  const present = CREDENTIAL_KEYS.filter((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim() !== '';
  });
  if (present.length === 0) {
    return;
  }
  const verb = present.length === 1 ? 'is' : 'are';
  throw new ConfigError(
    `Unsupported configuration: ${present.join(', ')} ${verb} set. Brokerage secrets belong in the gitignored secret file, not the process environment.`,
  );
}

function readSecretFile(filePath: string): Record<string, string> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const values: Record<string, string> = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

function secretEnvironment(values: Record<string, string> | null): 'unset' | 'sandbox' | 'production' {
  const environment = values?.TASTYTRADE_ENVIRONMENT;
  if (environment === 'sandbox' || environment === 'production') {
    return environment;
  }
  return 'unset';
}

function secretComplete(values: Record<string, string> | null): boolean {
  if (!values) {
    return false;
  }
  return Boolean(
    values.TASTYTRADE_CLIENT_ID &&
      values.TASTYTRADE_CLIENT_SECRET &&
      values.TASTYTRADE_REFRESH_TOKEN &&
      secretEnvironment(values) !== 'unset',
  );
}

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3180),
    BIND_HOST: z.string().trim().min(1).default('127.0.0.1'),
    DATABASE_PATH: z.string().trim().min(1),
    DATA_MODE: z.string().trim().default('demo'),
    AUTH_MODE: z.string().trim().default('local-owner'),
    ENABLE_ORDER_EXECUTION: z.string().trim().default('false'),
    TELEMETRY_ENABLED: z.string().trim().default('false'),
    RUNNING_IN_DOCKER: z.string().trim().default('false'),
    STATIC_DIR: z.string().optional(),
    TASTYTRADE_ENABLE_LIVE: z.string().trim().default('false'),
    TASTYTRADE_DISABLE_LIVE: z.string().trim().default('false'),
    DXLINK_LIVE_DIAGNOSTIC: z.string().trim().default('false'),
    FINDER_LIVE_SCAN: z.string().trim().default('false'),
    /** Separate gate for multi-ticker Smart Scan live chains. Default false for 1D.2a. */
    SMART_SCAN_LIVE: z.string().trim().default('false'),
    TASTYTRADE_SCHEDULED_SYNC: z.string().trim().default('false'),
    TASTYTRADE_TRANSACTION_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  })
  .superRefine((value, context) => {
    if (value.DATA_MODE !== 'demo') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATA_MODE must be "demo". The synthetic book stays available beside a brokerage portfolio view.',
        path: ['DATA_MODE'],
      });
    }
    if (value.AUTH_MODE !== 'local-owner') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AUTH_MODE must be "local-owner". Public registration and open local mode are not supported.',
        path: ['AUTH_MODE'],
      });
    }
    if (value.ENABLE_ORDER_EXECUTION !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ENABLE_ORDER_EXECUTION must be "false". OptionScout cannot route orders.',
        path: ['ENABLE_ORDER_EXECUTION'],
      });
    }
    if (value.TELEMETRY_ENABLED !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TELEMETRY_ENABLED must be "false". External telemetry is disabled.',
        path: ['TELEMETRY_ENABLED'],
      });
    }
    if (value.TASTYTRADE_SCHEDULED_SYNC !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TASTYTRADE_SCHEDULED_SYNC must be "false". Automatic scheduled synchronization is disabled.',
        path: ['TASTYTRADE_SCHEDULED_SYNC'],
      });
    }
    if (value.TASTYTRADE_ENABLE_LIVE !== 'true' && value.TASTYTRADE_ENABLE_LIVE !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TASTYTRADE_ENABLE_LIVE must be "true" or "false".',
        path: ['TASTYTRADE_ENABLE_LIVE'],
      });
    }
    if (value.TASTYTRADE_DISABLE_LIVE !== 'true' && value.TASTYTRADE_DISABLE_LIVE !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TASTYTRADE_DISABLE_LIVE must be "true" or "false".',
        path: ['TASTYTRADE_DISABLE_LIVE'],
      });
    }
    if (value.FINDER_LIVE_SCAN !== 'true' && value.FINDER_LIVE_SCAN !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FINDER_LIVE_SCAN must be "true" or "false".',
        path: ['FINDER_LIVE_SCAN'],
      });
    }
    if (value.SMART_SCAN_LIVE !== 'true' && value.SMART_SCAN_LIVE !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMART_SCAN_LIVE must be "true" or "false".',
        path: ['SMART_SCAN_LIVE'],
      });
    }
    if (value.DXLINK_LIVE_DIAGNOSTIC !== 'true' && value.DXLINK_LIVE_DIAGNOSTIC !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DXLINK_LIVE_DIAGNOSTIC must be "true" or "false".',
        path: ['DXLINK_LIVE_DIAGNOSTIC'],
      });
    }
    if (value.RUNNING_IN_DOCKER !== 'true' && value.RUNNING_IN_DOCKER !== 'false') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RUNNING_IN_DOCKER must be "true" or "false".',
        path: ['RUNNING_IN_DOCKER'],
      });
    }
    const docker = value.RUNNING_IN_DOCKER === 'true';
    const loopback = LOOPBACK_HOSTS.has(value.BIND_HOST);
    const dockerBind = docker && value.BIND_HOST === '0.0.0.0';
    if (!loopback && !dockerBind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'BIND_HOST must be a loopback address. 0.0.0.0 is allowed only when RUNNING_IN_DOCKER=true, and the published port must stay bound to 127.0.0.1.',
        path: ['BIND_HOST'],
      });
    }
    if (value.PORT === 0 && value.NODE_ENV !== 'test') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PORT 0 is only allowed when NODE_ENV=test.',
        path: ['PORT'],
      });
    }
    if (/^(postgres|postgresql|mysql|mongodb|redis|http|https):/i.test(value.DATABASE_PATH)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_PATH must be a local SQLite file. External databases are not used.',
        path: ['DATABASE_PATH'],
      });
    }
  });

export function parseConfig(
  env: NodeJS.ProcessEnv,
  options?: { defaultDatabasePath?: string; secretFilePath?: string },
): AppConfig {
  rejectCredentialEnv(env);
  const secretFilePath = options?.secretFilePath ?? (env.TASTYTRADE_SECRET_FILE?.trim() || defaultSecretFilePath());
  const parsed = configSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    BIND_HOST: env.BIND_HOST,
    DATABASE_PATH: env.DATABASE_PATH ?? options?.defaultDatabasePath ?? defaultDatabasePath(),
    DATA_MODE: env.DATA_MODE,
    AUTH_MODE: env.AUTH_MODE,
    ENABLE_ORDER_EXECUTION: env.ENABLE_ORDER_EXECUTION,
    TELEMETRY_ENABLED: env.TELEMETRY_ENABLED,
    RUNNING_IN_DOCKER: env.RUNNING_IN_DOCKER,
    STATIC_DIR: env.STATIC_DIR,
    TASTYTRADE_ENABLE_LIVE: env.TASTYTRADE_ENABLE_LIVE,
    TASTYTRADE_DISABLE_LIVE: env.TASTYTRADE_DISABLE_LIVE,
    DXLINK_LIVE_DIAGNOSTIC: env.DXLINK_LIVE_DIAGNOSTIC,
    FINDER_LIVE_SCAN: env.FINDER_LIVE_SCAN,
    SMART_SCAN_LIVE: env.SMART_SCAN_LIVE,
    TASTYTRADE_SCHEDULED_SYNC: env.TASTYTRADE_SCHEDULED_SYNC,
    TASTYTRADE_TRANSACTION_LOOKBACK_DAYS: env.TASTYTRADE_TRANSACTION_LOOKBACK_DAYS,
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(' ');
    throw new ConfigError(message);
  }

  const secretValues = readSecretFile(secretFilePath);
  const complete = secretComplete(secretValues);
  const liveEnabled = parsed.data.TASTYTRADE_ENABLE_LIVE === 'true';
  if (liveEnabled && !complete) {
    throw new ConfigError('TASTYTRADE_ENABLE_LIVE is true, but the brokerage secret file is missing or incomplete.');
  }

  const staticDir = parsed.data.STATIC_DIR === '' ? null : (parsed.data.STATIC_DIR ?? defaultStaticDir());
  const credentials =
    liveEnabled && secretValues
      ? {
          clientId: secretValues.TASTYTRADE_CLIENT_ID ?? '',
          clientSecret: secretValues.TASTYTRADE_CLIENT_SECRET ?? '',
          refreshToken: secretValues.TASTYTRADE_REFRESH_TOKEN ?? '',
        }
      : null;

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    bindHost: parsed.data.BIND_HOST,
    databasePath: parsed.data.DATABASE_PATH,
    dataMode: 'demo',
    authMode: 'local-owner',
    ordersEnabled: false,
    telemetryEnabled: false,
    runningInDocker: parsed.data.RUNNING_IN_DOCKER === 'true',
    staticDir,
    liveEnabled,
    hardDisabled: parsed.data.TASTYTRADE_DISABLE_LIVE === 'true',
    dxlinkLiveDiagnostic: parsed.data.DXLINK_LIVE_DIAGNOSTIC === 'true',
    finderLiveScan: parsed.data.FINDER_LIVE_SCAN === 'true',
    smartScanLive: parsed.data.SMART_SCAN_LIVE === 'true',
    scheduledSyncEnabled: false,
    tastytradeEnvironment: secretEnvironment(secretValues),
    transactionLookbackDays: parsed.data.TASTYTRADE_TRANSACTION_LOOKBACK_DAYS,
    secretFilePath,
    secretFileComplete: complete,
    tastytrade: credentials,
  };
}

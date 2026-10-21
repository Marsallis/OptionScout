import type { AppConfig } from './config.js';
import { resolveActiveConnection, type ActiveBrokerConnection } from './brokerage/connection.js';
import { createAcceptanceFixture } from './brokerage/acceptance-fixture.js';
import { brokerageBaseUrl, TastytradeClient, type BrokerageReadClient } from './brokerage/client.js';
import type { BrokerRuntime } from './brokerage/status.js';
import { openDatabase, type OpenedDatabase } from './db/client.js';
import { applyMigrations, migrationsDirectory } from './db/migrate.js';
import { incrementBootCount, seedDemoFixtures } from './db/seed.js';
import { createProviders, type ProviderSet } from './providers/mocks.js';
import { ensureStrategyProfilesSeeded } from './strategy/profiles.js';
import { markInterruptedRunningSessions } from './finder/research-sessions.js';
import type { SmartScanDeps } from './finder/smart-scan.js';
import type { FinderTestDeps } from './finder/scan.js';

export interface AppContext {
  config: AppConfig;
  database: OpenedDatabase;
  bootCount: number;
  providers: ProviderSet;
  brokerage: BrokerageReadClient | null;
  brokerConnection: ActiveBrokerConnection;
  brokerRuntime: BrokerRuntime;
  /** Mocked chain/quote providers for route-level tests. Never set in production boot. */
  smartScanTestDeps?: Partial<Pick<SmartScanDeps, 'chainPayloadForTicker' | 'quoteSource' | 'now' | 'underlyingQuote' | 'claimHeartbeatMs'>>;
  finderTestDeps?: FinderTestDeps;
  close(): void;
}

export async function openAppContext(config: AppConfig): Promise<AppContext> {
  const database = openDatabase(config.databasePath);
  applyMigrations(database.sqlite, migrationsDirectory());
  seedDemoFixtures(database.db);
  ensureStrategyProfilesSeeded(database.db);
  markInterruptedRunningSessions(database.sqlite);
  const bootCount = incrementBootCount(database.db);
  const providers = createProviders(database.db);
  await providers.sync.syncAccount('acct_demo');
  const context: AppContext = {
    config,
    database,
    bootCount,
    providers,
    brokerage: null,
    brokerConnection: resolveActiveConnection({
      db: database.db,
      databasePath: config.databasePath,
      legacySecretPath: config.secretFilePath,
      liveEnabled: config.liveEnabled,
      hardDisabled: config.hardDisabled,
    }),
    brokerRuntime: { connectedThisProcess: false, lastError: null },
    close() {
      database.close();
    },
  };
  refreshBrokerConnection(context);
  return context;
}

export function refreshBrokerConnection(context: AppContext): ActiveBrokerConnection {
  const active = resolveActiveConnection({
    db: context.database.db,
    databasePath: context.config.databasePath,
    legacySecretPath: context.config.secretFilePath,
    liveEnabled: context.config.liveEnabled,
    hardDisabled: context.config.hardDisabled,
  });
  context.brokerConnection = active;
  context.brokerage =
    active.providerAllowed && active.credentials && active.environment !== 'unset'
      ? context.config.acceptanceFixture
        ? createAcceptanceFixture()
        : new TastytradeClient({
            baseUrl: brokerageBaseUrl(active.environment),
            credentials: active.credentials,
          })
      : null;
  if (!context.brokerage) {
    context.brokerRuntime.connectedThisProcess = false;
  }
  return active;
}

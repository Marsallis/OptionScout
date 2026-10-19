import type { AppConfig } from './config.js';
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
  const brokerage =
    config.liveEnabled && config.tastytrade && config.tastytradeEnvironment !== 'unset'
      ? new TastytradeClient({
          baseUrl: brokerageBaseUrl(config.tastytradeEnvironment),
          credentials: config.tastytrade,
        })
      : null;
  return {
    config,
    database,
    bootCount,
    providers,
    brokerage,
    brokerRuntime: { connectedThisProcess: false, lastError: null },
    close() {
      database.close();
    },
  };
}

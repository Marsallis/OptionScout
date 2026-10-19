import type {
  AccountSyncResult,
  AccountSyncService,
  BrokerageProvider,
  MarketDataProvider,
  QuoteStreamService,
  ResearchProvider,
} from '@optionscout/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { accounts, marks, researchCandidates } from '../db/schema.js';

const DEMO_ACCOUNT_ID = 'acct_demo';

export function createMockBrokerage(db: AppDatabase): BrokerageProvider {
  return {
    id: 'demo',
    readOnly: true,
    async getConnectionStatus() {
      const account = db.select().from(accounts).where(eq(accounts.id, DEMO_ACCOUNT_ID)).get();
      return {
        providerId: 'demo',
        connectionStatus: 'demo-only',
        accountName: account?.displayName ?? 'Synthetic Demo Account',
        liveCredentialsRequired: false,
        oauthImplemented: false,
        streamingImplemented: false,
        ordersEnabled: false,
        label: 'Not connected to a brokerage. Showing the synthetic demo account.',
      };
    },
    async listAccounts() {
      return db
        .select()
        .from(accounts)
        .all()
        .map((account) => ({
          id: account.id,
          providerId: 'demo' as const,
          displayName: account.displayName,
          isDemo: account.isDemo,
        }));
    },
  };
}

export function createMockMarketData(db: AppDatabase): MarketDataProvider {
  return {
    id: 'demo',
    async getQuotes(instrumentKeys) {
      const rows = db.select().from(marks).all();
      const wanted = new Set(instrumentKeys);
      return rows
        .filter((row) => wanted.has(row.instrumentKey))
        .map((row) => {
          if (row.source !== 'demo-fixture' || row.isDemo !== true) {
            throw new Error('Refusing a mark that is not demo fixture data.');
          }
          return {
            instrumentKey: row.instrumentKey,
            mark: row.mark,
            asOf: row.asOf,
            source: 'demo-fixture' as const,
            isDemo: true as const,
          };
        });
    },
  };
}

export function createMockSync(): AccountSyncService {
  let lastResult: AccountSyncResult | null = null;
  return {
    async syncAccount(accountId) {
      lastResult = {
        accountId,
        mode: 'demo-fixture',
        externalRequestCount: 0,
        changed: false,
        message: 'Demo fixtures are already stored locally. No brokerage request was made.',
      };
      return lastResult;
    },
    getLastResult() {
      return lastResult;
    },
  };
}

export function createMockQuoteStream(): QuoteStreamService {
  return {
    implemented: false,
    getStatus() {
      return {
        state: 'not-connected',
        transport: 'dxlink',
        implemented: false,
        detail: 'DXLink streaming is not connected. Phase 1A does not open a market-data socket.',
      };
    },
  };
}

export function createMockResearch(db: AppDatabase): ResearchProvider {
  return {
    id: 'local-fixtures',
    async listCandidates() {
      return db
        .select()
        .from(researchCandidates)
        .all()
        .map((candidate) => ({
          id: candidate.id,
          underlying: candidate.underlying,
          title: candidate.title,
          summary: candidate.summary,
          isDemo: true as const,
        }));
    },
  };
}

export interface ProviderSet {
  brokerage: BrokerageProvider;
  marketData: MarketDataProvider;
  sync: AccountSyncService;
  quotes: QuoteStreamService;
  research: ResearchProvider;
}

export function createProviders(db: AppDatabase): ProviderSet {
  return {
    brokerage: createMockBrokerage(db),
    marketData: createMockMarketData(db),
    sync: createMockSync(),
    quotes: createMockQuoteStream(),
    research: createMockResearch(db),
  };
}

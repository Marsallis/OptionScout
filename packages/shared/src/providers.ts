/**
 * Boundaries for a future read-only tastytrade connection.
 * Implementations must not place, cancel, or replace orders.
 * Phase 1A ships mock implementations only.
 */

export interface BrokerageAccountSummary {
  id: string;
  providerId: 'demo' | 'tastytrade';
  displayName: string;
  isDemo: boolean;
}

export interface BrokerConnectionStatus {
  providerId: 'demo' | 'tastytrade';
  connectionStatus: 'demo-only' | 'disconnected' | 'connected';
  accountName: string;
  liveCredentialsRequired: boolean;
  oauthImplemented: boolean;
  streamingImplemented: boolean;
  ordersEnabled: false;
  label: string;
}

export interface BrokerageProvider {
  readonly id: 'demo' | 'tastytrade';
  readonly readOnly: true;
  getConnectionStatus(): Promise<BrokerConnectionStatus>;
  listAccounts(): Promise<BrokerageAccountSummary[]>;
}

export interface InstrumentQuote {
  instrumentKey: string;
  mark: number;
  asOf: string;
  source: 'demo-fixture' | 'tastytrade';
  isDemo: boolean;
}

export interface MarketDataProvider {
  readonly id: 'demo' | 'tastytrade';
  getQuotes(instrumentKeys: string[]): Promise<InstrumentQuote[]>;
}

export interface AccountSyncResult {
  accountId: string;
  mode: 'demo-fixture' | 'tastytrade';
  externalRequestCount: number;
  changed: boolean;
  message: string;
}

export interface AccountSyncService {
  syncAccount(accountId: string): Promise<AccountSyncResult>;
  getLastResult(): AccountSyncResult | null;
}

export interface QuoteStreamStatus {
  state: 'not-connected' | 'connected';
  transport: 'dxlink';
  implemented: boolean;
  detail: string;
}

export interface QuoteStreamService {
  readonly implemented: boolean;
  getStatus(): QuoteStreamStatus;
}

export interface ResearchCandidateRecord {
  id: string;
  underlying: string;
  title: string;
  summary: string;
  isDemo: boolean;
}

export interface ResearchProvider {
  readonly id: 'local-fixtures' | 'faircloth-os';
  listCandidates(): Promise<ResearchCandidateRecord[]>;
}

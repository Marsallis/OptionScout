import { and, desc, eq } from 'drizzle-orm';
import type { BrokerOverview } from '@optionscout/shared';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/client.js';
import { readMeta } from '../db/meta.js';
import { brokerAccounts, brokerPositions, brokerTransactions, quoteSnapshots, syncRuns } from '../db/schema.js';
import { classifyQuoteFreshness } from './market-hours.js';

export interface BrokerRuntime {
  connectedThisProcess: boolean;
  lastError: string | null;
}

function latestRun(db: AppDatabase, kind: string): string | null {
  const rows = db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.kind, kind))
    .all()
    .filter((row) => row.finishedAt && (row.status === 'succeeded' || row.status === 'incomplete'))
    .sort((left, right) => (right.finishedAt ?? '').localeCompare(left.finishedAt ?? ''));
  return rows[0]?.finishedAt ?? null;
}

interface StoredImport {
  pagesFetched: number;
  received: number;
  valid: number;
  inserted: number;
  updated: number;
  skipped: number;
  skipReasons: Array<{ reason: string; count: number }>;
  earliest: string | null;
  latest: string | null;
}

function readImport(db: AppDatabase): StoredImport | null {
  const raw = readMeta(db, 'broker_transaction_import');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredImport;
    if (typeof parsed.received !== 'number' || typeof parsed.valid !== 'number' || !Array.isArray(parsed.skipReasons)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function missingOpeningCount(db: AppDatabase, accountId: string): number {
  const positions = db
    .select()
    .from(brokerPositions)
    .where(and(eq(brokerPositions.brokerAccountId, accountId), eq(brokerPositions.status, 'open'), eq(brokerPositions.instrumentType, 'Equity Option')))
    .all();
  const transactions = db.select().from(brokerTransactions).where(eq(brokerTransactions.brokerAccountId, accountId)).all();
  let missing = 0;
  for (const position of positions) {
    const needed = position.direction === 'short' ? 'sell to open' : 'buy to open';
    const found = transactions.some((row) => (row.symbol ?? '') === position.providerSymbol && (row.action ?? '').toLowerCase() === needed);
    if (!found) missing += 1;
  }
  return missing;
}

function historyMessage(status: string, start: string | null, summary: StoredImport | null, openingsMissing: number): string {
  let message = 'No brokerage transactions have been imported. Cost basis and realized P/L are not calculated.';
  if (status === 'partial') {
    message = 'Only a recent window was imported. Opening trades for long-dated LEAPS may be missing. Cost basis and realized P/L are not calculated.';
  } else if (status === 'incomplete') {
    message = 'Transaction history is incomplete. Cost basis and realized P/L are not calculated.';
  } else if (status === 'complete') {
    message = `Transaction history is complete for the requested range${start ? ` starting ${start}` : ''}. Cost basis and realized P/L are not calculated.`;
  }
  if (summary && summary.received > 0 && summary.valid === 0) {
    message = `The brokerage returned ${summary.received} transactions and none were stored. ${message}`;
  } else if (summary && summary.received > 0) {
    const reasons = summary.skipReasons.map((item) => `${item.count} ${item.reason}`).join('; ');
    message = `${message} Last import received ${summary.received}, stored ${summary.valid} (${summary.inserted} new, ${summary.updated} updated), skipped ${summary.skipped}${reasons ? ` (${reasons})` : ''}.`;
  }
  if (openingsMissing > 0) {
    message = `${message} ${openingsMissing} open option position${openingsMissing === 1 ? '' : 's'} have no stored opening transaction.`;
  }
  return message;
}

export function buildBrokerOverview(input: {
  db: AppDatabase;
  config: AppConfig;
  runtime: BrokerRuntime;
  authenticated: boolean;
  ownerConfigured: boolean;
  portfolioView: 'demo' | 'brokerage';
  now?: Date;
}): BrokerOverview {
  const now = input.now ?? new Date();
  const selected = input.authenticated
    ? (input.db.select().from(brokerAccounts).where(eq(brokerAccounts.selected, true)).get() ?? null)
    : null;
  const accounts = input.authenticated
    ? input.db
        .select()
        .from(brokerAccounts)
        .all()
        .filter((account) => account.provider === 'tastytrade')
        .map((account) => ({
          id: account.id,
          maskedAccount: account.maskedLabel,
          accountType: account.accountType,
          authority: account.authority,
          selected: account.selected,
        }))
    : [];

  let connectionState: BrokerOverview['connection']['state'] = 'not_configured';
  let connectionMessage = 'No brokerage secret file is configured. Live access stays off.';
  if (!input.config.liveEnabled && input.config.secretFileComplete) {
    connectionState = 'disabled';
    connectionMessage = 'A secret file is present, and live access is still disabled.';
  } else if (input.config.liveEnabled && input.runtime.lastError && !input.runtime.connectedThisProcess) {
    connectionState = 'error';
    connectionMessage = input.runtime.lastError;
  } else if (input.config.liveEnabled && input.runtime.connectedThisProcess) {
    connectionState = 'connected';
    connectionMessage = 'Read-only brokerage access is connected for this process.';
  } else if (input.config.liveEnabled) {
    connectionState = 'disconnected';
    connectionMessage =
      'No brokerage request has succeeded since this process started. That is not proof credentials are invalid — a successful sign-in sync or Find LEAPS call establishes the connection for this process.';
  }

  const snapshots = input.db.select().from(quoteSnapshots).orderBy(desc(quoteSnapshots.fetchedAt)).all();
  const latestFetch = snapshots[0]?.fetchedAt ?? null;
  const latest = latestFetch ? snapshots.filter((row) => row.fetchedAt === latestFetch && row.symbol !== '') : [];
  const unavailable = readMeta(input.db, 'broker_quote_unavailable');
  let quoteState: BrokerOverview['quotes']['state'] = 'not_requested';
  let entitlement: BrokerOverview['quotes']['entitlement'] = 'unknown';
  let quoteMessage = 'No quote check has run.';
  let asOf: string | null = null;
  if (unavailable) {
    quoteState = 'unavailable';
    quoteMessage = unavailable;
  } else if (latest.length > 0) {
    const ranked = latest.map((row) => {
      if (row.entitlement === 'denied' || row.freshness === 'unavailable') {
        return { state: 'unavailable' as const, row };
      }
      return { state: classifyQuoteFreshness(row.quoteAsOf, now), row };
    });
    const priority = ['unavailable', 'missing', 'stale', 'closed_session', 'fresh'] as const;
    const winner = priority.find((state) => ranked.some((item) => item.state === state)) ?? 'not_requested';
    quoteState = winner;
    entitlement = ranked.some((item) => item.row.entitlement === 'denied')
      ? 'denied'
      : ranked.some((item) => item.row.entitlement === 'entitled')
        ? 'entitled'
        : 'unknown';
    asOf = ranked.find((item) => item.row.quoteAsOf)?.row.quoteAsOf ?? null;
    quoteMessage =
      quoteState === 'closed_session'
        ? 'The quote timestamp is from outside the regular US equity session.'
        : quoteState === 'stale'
          ? 'The quote is older than 15 minutes during the regular session.'
          : quoteState === 'fresh'
            ? 'The quote is current for the regular session.'
            : quoteState === 'missing'
              ? 'The brokerage response did not include a quote timestamp.'
              : 'Market data is unavailable. Account connection is a separate status.';
  }
  const quoteSymbols = input.authenticated
    ? latest.map((row) => ({
        symbol: row.symbol,
        freshness:
          row.entitlement === 'denied' || row.freshness === 'unavailable'
            ? ('unavailable' as const)
            : classifyQuoteFreshness(row.quoteAsOf, now),
        asOf: row.quoteAsOf,
        fetchedAt: row.fetchedAt,
        entitlement: (row.entitlement === 'entitled' || row.entitlement === 'denied' ? row.entitlement : 'unknown') as
          | 'unknown'
          | 'entitled'
          | 'denied',
      }))
    : [];

  const storedImport = input.authenticated && selected ? readImport(input.db) : null;
  const openingsMissing = input.authenticated && selected ? missingOpeningCount(input.db, selected.id) : 0;
  const historyStatus = (selected?.transactionHistoryStatus ?? 'not_imported') as BrokerOverview['history']['status'];
  return {
    phase: '1C',
    portfolioView: input.portfolioView,
    authenticated: input.authenticated,
    ownerConfigured: input.ownerConfigured,
    disclaimer: 'Brokerage data is separate from the synthetic demo book. This phase does not calculate cost basis or realized P/L.',
    connection: {
      state: connectionState,
      environment: input.config.tastytradeEnvironment,
      readOnly: true,
      liveEnabled: input.config.liveEnabled,
      secretFilePresent: input.config.secretFileComplete,
      lastSuccessAt: readMeta(input.db, 'broker_last_success_at'),
      message: connectionMessage,
    },
    quotes: {
      state: quoteState,
      entitlement,
      asOf,
      fetchedAt: latestFetch,
      message: quoteMessage,
      symbols: quoteSymbols,
    },
    history: {
      status: historyStatus,
      coverageStart: selected?.historyCoverageStart ?? null,
      coverageEnd: selected?.historyCoverageEnd ?? null,
      message: historyMessage(historyStatus, selected?.historyCoverageStart ?? null, storedImport, openingsMissing),
      lastImport: storedImport
        ? {
            ...storedImport,
            openingsMissing,
          }
        : null,
    },
    sync: {
      positionsAt: latestRun(input.db, 'positions'),
      transactionsAt: latestRun(input.db, 'transactions'),
      scheduledSyncEnabled: false,
    },
    accounts,
    stream: {
      state: 'not-connected',
      transport: 'dxlink',
      implemented: true,
      liveEnabled: false,
      detail: input.config.dxlinkLiveDiagnostic
        ? 'DXLink live diagnostic is armed. Startup does not open a socket. REST snapshots remain the fallback.'
        : 'DXLink protocol is implemented. The live diagnostic switch is off, and startup does not open a socket. REST snapshots remain the fallback.',
    },
    safety: {
      ordersEnabled: false,
      telemetryEnabled: false,
      networkAccessRequired: input.config.liveEnabled,
    },
  };
}

export function listImportedPositions(db: AppDatabase, accountId: string) {
  return db
    .select()
    .from(brokerPositions)
    .where(eq(brokerPositions.brokerAccountId, accountId))
    .all()
    .map((row) => ({
      id: row.id,
      providerSymbol: row.providerSymbol,
      underlyingSymbol: row.underlyingSymbol,
      optionSymbol: row.optionSymbol,
      instrumentType: row.instrumentType,
      quantity: row.quantity,
      direction: row.direction as 'long' | 'short' | 'zero',
      strike: row.strike,
      expiration: row.expiration,
      averageOpenPrice: row.averageOpenPrice,
      multiplier: row.multiplier,
      reportedMark: row.reportedMark,
      status: row.status as 'open' | 'unreconciled' | 'closed',
      syncedAt: row.syncedAt,
      source: 'tastytrade' as const,
      isDemo: false as const,
    }));
}

export function listImportedTransactions(db: AppDatabase, accountId: string) {
  return db
    .select()
    .from(brokerTransactions)
    .where(eq(brokerTransactions.brokerAccountId, accountId))
    .all()
    .map((row) => ({
      id: row.id,
      providerTransactionId: row.providerTransactionId,
      symbol: row.symbol,
      instrumentType: row.instrumentType,
      action: row.action,
      quantity: row.quantity,
      price: row.price,
      executedAt: row.executedAt,
      grossValue: row.grossValue,
      valueEffect: row.valueEffect,
      commission: row.commission,
      feesJson: row.feesJson,
      transactionType: row.transactionType,
      transactionSubtype: row.transactionSubtype,
      classification: row.classification as 'trade' | 'expiration' | 'assignment' | 'exercise' | 'transfer' | 'unsupported',
      source: 'tastytrade' as const,
      isDemo: false as const,
    }));
}

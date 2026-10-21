import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { readMeta, writeMeta } from '../db/meta.js';
import { brokerAccounts, brokerPositions, brokerTransactions, syncRuns } from '../db/schema.js';
import { authorizeSync, type SyncActor } from './actor.js';
import { SyncInputError } from './errors.js';
import type { BrokerageReadClient, BrokerQuery } from './client.js';
import { maskAccountNumber, normalizePosition, normalizeTransaction } from './normalize.js';
import { classifyQuoteFreshness } from './market-hours.js';
import { quoteSnapshots } from '../db/schema.js';
import { asDecimalString } from './decimals.js';

export interface SyncOptions {
  lookbackDays: number;
  scheduledSyncEnabled: boolean;
  now?: Date;
  transactions?: { mode: 'recent' | 'backfill'; startDate?: string };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const value = new Date(`${iso}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function earlier(left: string | null, right: string): string {
  if (!left || right < left) return right;
  return left;
}

function later(left: string | null, right: string): string {
  if (!left || right > left) return right;
  return left;
}

function itemsOf(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: { items?: unknown[] } }).data;
  return Array.isArray(data?.items) ? data.items : [];
}

function paginationOf(body: unknown): { pageOffset: number; totalPages: number } | null {
  if (!body || typeof body !== 'object') return null;
  const pagination = (body as { pagination?: Record<string, unknown> }).pagination;
  if (!pagination || typeof pagination['total-pages'] !== 'number') return null;
  const pageOffset = typeof pagination['page-offset'] === 'number' ? pagination['page-offset'] : 0;
  return { pageOffset, totalPages: pagination['total-pages'] };
}

function recordRun(
  db: AppDatabase,
  input: { accountId: string | null; kind: string; status: string; startedAt: string; errorMessage: string | null; actor: SyncActor },
): void {
  db.insert(syncRuns)
    .values({
      id: randomUUID(),
      brokerAccountId: input.accountId,
      kind: input.kind,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: input.errorMessage,
      actorType: input.actor.type,
    })
    .run();
}

export async function discoverAccounts(
  db: AppDatabase,
  client: BrokerageReadClient,
  actor: SyncActor,
  scheduledSyncEnabled: boolean,
  onlyAccountNumber?: string,
): Promise<void> {
  authorizeSync(actor, scheduledSyncEnabled);
  const startedAt = new Date().toISOString();
  try {
    const body = await client.getJson('/customers/me/accounts');
    const items = itemsOf(body);
    const discovered: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { account?: Record<string, unknown>; 'authority-level'?: unknown };
      const account = record.account ?? {};
      const accountNumber = typeof account['account-number'] === 'string' ? account['account-number'] : '';
      if (!accountNumber) continue;
      if (onlyAccountNumber && accountNumber !== onlyAccountNumber) continue;
      discovered.push(accountNumber);
      const existing = db
        .select()
        .from(brokerAccounts)
        .where(and(eq(brokerAccounts.provider, 'tastytrade'), eq(brokerAccounts.accountNumber, accountNumber)))
        .get();
      const values = {
        accountType: typeof account['account-type-name'] === 'string' ? account['account-type-name'] : 'Unknown',
        authority: typeof record['authority-level'] === 'string' ? record['authority-level'] : 'unknown',
        maskedLabel: maskAccountNumber(accountNumber),
        discoveredAt: startedAt,
      };
      if (existing) {
        db.update(brokerAccounts).set(values).where(eq(brokerAccounts.id, existing.id)).run();
      } else {
        db.insert(brokerAccounts)
          .values({
            id: randomUUID(),
            provider: 'tastytrade',
            accountNumber,
            selected: false,
            transactionHistoryStatus: 'not_imported',
            historyCoverageStart: null,
            historyCoverageEnd: null,
            ...values,
          })
          .run();
      }
    }
    if (!onlyAccountNumber) {
      const rows = db.select().from(brokerAccounts).where(eq(brokerAccounts.provider, 'tastytrade')).all();
      if (rows.length === 1 && rows[0] && !rows[0].selected) {
        db.update(brokerAccounts).set({ selected: true }).where(eq(brokerAccounts.id, rows[0].id)).run();
      }
    }
    if (discovered.length === 0) {
      throw new Error(onlyAccountNumber ? 'The selected account was not returned.' : 'The brokerage returned no accounts.');
    }
    writeMeta(db, 'broker_last_success_at', new Date().toISOString());
    recordRun(db, { accountId: null, kind: 'accounts', status: 'succeeded', startedAt, errorMessage: null, actor });
  } catch (error) {
    recordRun(db, {
      accountId: null,
      kind: 'accounts',
      status: 'failed',
      startedAt,
      errorMessage: 'Account discovery failed.',
      actor,
    });
    throw error;
  }
}

export function selectAccountNumber(db: AppDatabase, accountNumber: string): void {
  const row = db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.provider, 'tastytrade'), eq(brokerAccounts.accountNumber, accountNumber)))
    .get();
  if (!row) throw new Error('That account is not available.');
  selectBrokerAccount(db, row.id);
}

export function selectBrokerAccount(db: AppDatabase, accountId: string): void {
  const row = db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId)).get();
  if (!row) {
    throw new Error('That account is not available.');
  }
  const bound = readMeta(db, 'broker.selected.account');
  if (bound && row.accountNumber !== bound) {
    throw new Error('This installation already keeps history for one account. Use a separate Docker data volume for a different account.');
  }
  db.update(brokerAccounts).set({ selected: false }).where(eq(brokerAccounts.provider, 'tastytrade')).run();
  db.update(brokerAccounts).set({ selected: true }).where(eq(brokerAccounts.id, accountId)).run();
}

function selectedAccount(db: AppDatabase) {
  return db.select().from(brokerAccounts).where(eq(brokerAccounts.selected, true)).get() ?? null;
}

export async function syncPositions(db: AppDatabase, client: BrokerageReadClient, actor: SyncActor, scheduledSyncEnabled: boolean): Promise<void> {
  authorizeSync(actor, scheduledSyncEnabled);
  const account = selectedAccount(db);
  if (!account) {
    throw new SyncInputError('Select an account before syncing.');
  }
  const startedAt = new Date().toISOString();
  try {
    const body = await client.getJson(`/accounts/${encodeURIComponent(account.accountNumber)}/positions`, {
      'include-marks': 'true',
    });
    const normalized = itemsOf(body).map((item) => normalizePosition(item));
    const seen = new Set<string>();
    for (const position of normalized) {
      seen.add(position.providerSymbol);
      const existing = db
        .select()
        .from(brokerPositions)
        .where(and(eq(brokerPositions.brokerAccountId, account.id), eq(brokerPositions.providerSymbol, position.providerSymbol)))
        .get();
      const values = {
        underlyingSymbol: position.underlyingSymbol,
        optionSymbol: position.optionSymbol,
        instrumentType: position.instrumentType,
        quantity: position.quantity,
        direction: position.direction,
        strike: position.strike,
        expiration: position.expiration,
        averageOpenPrice: position.averageOpenPrice,
        multiplier: position.multiplier,
        reportedMark: position.reportedMark,
        status: 'open',
        syncedAt: startedAt,
        rawJson: JSON.stringify(position.raw),
      };
      if (existing) {
        db.update(brokerPositions).set(values).where(eq(brokerPositions.id, existing.id)).run();
      } else {
        db.insert(brokerPositions)
          .values({
            id: randomUUID(),
            brokerAccountId: account.id,
            providerSymbol: position.providerSymbol,
            ...values,
          })
          .run();
      }
    }
    const previous = db.select().from(brokerPositions).where(eq(brokerPositions.brokerAccountId, account.id)).all();
    for (const row of previous) {
      if (!seen.has(row.providerSymbol) && row.status !== 'unreconciled') {
        db.update(brokerPositions).set({ status: 'unreconciled', syncedAt: startedAt }).where(eq(brokerPositions.id, row.id)).run();
      }
    }
    writeMeta(db, 'broker_last_success_at', new Date().toISOString());
    recordRun(db, { accountId: account.id, kind: 'positions', status: 'succeeded', startedAt, errorMessage: null, actor });
  } catch (error) {
    recordRun(db, { accountId: account.id, kind: 'positions', status: 'failed', startedAt, errorMessage: 'Position sync failed.', actor });
    throw error;
  }
}

const IMPORT_META = 'broker_transaction_import';

export interface TransactionImportCounts {
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

function emptyImport(): TransactionImportCounts & { reasons: Map<string, number> } {
  return {
    pagesFetched: 0,
    received: 0,
    valid: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    skipReasons: [],
    earliest: null,
    latest: null,
    reasons: new Map(),
  };
}

function noteSkip(counts: ReturnType<typeof emptyImport>, reason: string): void {
  counts.skipped += 1;
  counts.reasons.set(reason, (counts.reasons.get(reason) ?? 0) + 1);
}

function finishImport(counts: ReturnType<typeof emptyImport>): TransactionImportCounts {
  return {
    pagesFetched: counts.pagesFetched,
    received: counts.received,
    valid: counts.valid,
    inserted: counts.inserted,
    updated: counts.updated,
    skipped: counts.skipped,
    skipReasons: [...counts.reasons.entries()].map(([reason, count]) => ({ reason, count })),
    earliest: counts.earliest,
    latest: counts.latest,
  };
}

function importDiagnostic(summary: TransactionImportCounts): string {
  const reasons = summary.skipReasons.map((item) => `${item.count} ${item.reason}`).join('; ');
  const storedNone = summary.received > 0 && summary.valid === 0;
  const lead = storedNone ? 'Transaction import stored none of the returned records. ' : '';
  return `${lead}Received ${summary.received}, valid ${summary.valid}, inserted ${summary.inserted}, updated ${summary.updated}, skipped ${summary.skipped}${reasons ? ` (${reasons})` : ''}.`.slice(0, 500);
}

function persistImport(db: AppDatabase, summary: TransactionImportCounts): void {
  writeMeta(db, IMPORT_META, JSON.stringify(summary));
}

export async function syncTransactions(
  db: AppDatabase,
  client: BrokerageReadClient,
  actor: SyncActor,
  options: SyncOptions,
): Promise<TransactionImportCounts> {
  authorizeSync(actor, options.scheduledSyncEnabled);
  const account = selectedAccount(db);
  if (!account) {
    throw new SyncInputError('Select an account before syncing.');
  }
  const now = options.now ?? new Date();
  const today = isoDate(now);
  const mode = options.transactions?.mode ?? 'recent';
  const requestedStart = options.transactions?.startDate;
  if (mode === 'backfill' && !requestedStart) {
    throw new SyncInputError('A backfill start date is required.', 400);
  }
  if (requestedStart && requestedStart > today) {
    throw new SyncInputError('The backfill start date is in the future.', 400);
  }
  const windowStart =
    mode === 'backfill' && requestedStart
      ? requestedStart
      : (() => {
          const lookback = shiftDate(today, -options.lookbackDays);
          if (!account.historyCoverageEnd) return lookback;
          const overlap = shiftDate(account.historyCoverageEnd, -2);
          return overlap > lookback ? overlap : lookback;
        })();
  const startedAt = now.toISOString();
  const counts = emptyImport();
  let complete = false;
  try {
    const perPage = 250;
    for (let page = 0; page < 1000; page += 1) {
      const body = await client.getJson(`/accounts/${encodeURIComponent(account.accountNumber)}/transactions`, {
        'per-page': String(perPage),
        'page-offset': String(page),
        sort: 'Asc',
        'start-date': windowStart,
        'end-date': today,
      });
      counts.pagesFetched += 1;
      for (const item of itemsOf(body)) {
        counts.received += 1;
        const normalized = normalizeTransaction(item);
        if (!normalized.ok) {
          noteSkip(counts, normalized.reason);
          continue;
        }
        counts.valid += 1;
        const transaction = normalized.transaction;
        if (transaction.executedAt) {
          counts.earliest = counts.earliest == null || transaction.executedAt < counts.earliest ? transaction.executedAt : counts.earliest;
          counts.latest = counts.latest == null || transaction.executedAt > counts.latest ? transaction.executedAt : counts.latest;
        }
        const existing = db
          .select()
          .from(brokerTransactions)
          .where(
            and(
              eq(brokerTransactions.brokerAccountId, account.id),
              eq(brokerTransactions.providerTransactionId, transaction.providerTransactionId),
            ),
          )
          .get();
        const values = {
          symbol: transaction.symbol,
          instrumentType: transaction.instrumentType,
          action: transaction.action,
          quantity: transaction.quantity,
          price: transaction.price,
          executedAt: transaction.executedAt,
          grossValue: transaction.grossValue,
          valueEffect: transaction.valueEffect,
          commission: transaction.commission,
          feesJson: transaction.feesJson,
          transactionType: transaction.transactionType,
          transactionSubtype: transaction.transactionSubtype,
          classification: transaction.classification,
          rawJson: JSON.stringify(transaction.raw),
        };
        if (existing) {
          counts.updated += 1;
          db.update(brokerTransactions).set(values).where(eq(brokerTransactions.id, existing.id)).run();
        } else {
          counts.inserted += 1;
          db.insert(brokerTransactions)
            .values({
              id: randomUUID(),
              brokerAccountId: account.id,
              providerTransactionId: transaction.providerTransactionId,
              ...values,
            })
            .run();
        }
      }
      const pagination = paginationOf(body);
      const count = itemsOf(body).length;
      if ((pagination && pagination.pageOffset + 1 >= pagination.totalPages) || (!pagination && count < perPage)) {
        complete = true;
        break;
      }
    }
    const summary = finishImport(counts);
    const storedNone = summary.received > 0 && summary.valid === 0;
    const status = !complete || summary.skipped > 0 || storedNone
      ? 'incomplete'
      : mode === 'backfill' || account.transactionHistoryStatus === 'complete'
        ? 'complete'
        : 'partial';
    const coverageReady = complete && summary.skipped === 0 && !storedNone;
    db.update(brokerAccounts)
      .set({
        transactionHistoryStatus: status,
        historyCoverageStart: coverageReady ? earlier(account.historyCoverageStart, windowStart) : account.historyCoverageStart,
        historyCoverageEnd: coverageReady ? later(account.historyCoverageEnd, today) : account.historyCoverageEnd,
      })
      .where(eq(brokerAccounts.id, account.id))
      .run();
    persistImport(db, summary);
    if (summary.valid > 0) {
      writeMeta(db, 'broker_last_success_at', new Date().toISOString());
    }
    recordRun(db, {
      accountId: account.id,
      kind: 'transactions',
      status: status === 'incomplete' ? 'incomplete' : 'succeeded',
      startedAt,
      errorMessage: summary.skipped > 0 || storedNone ? importDiagnostic(summary) : null,
      actor,
    });
    return summary;
  } catch (error) {
    const summary = finishImport(counts);
    persistImport(db, summary);
    db.update(brokerAccounts)
      .set({ transactionHistoryStatus: 'incomplete' })
      .where(eq(brokerAccounts.id, account.id))
      .run();
    recordRun(db, {
      accountId: account.id,
      kind: 'transactions',
      status: 'failed',
      startedAt,
      errorMessage: 'Transaction sync failed.',
      actor,
    });
    throw error;
  }
}

const QUOTE_BATCH = 80;

function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export async function syncQuotes(
  db: AppDatabase,
  client: BrokerageReadClient,
  actor: SyncActor,
  scheduledSyncEnabled: boolean,
  now = new Date(),
): Promise<void> {
  authorizeSync(actor, scheduledSyncEnabled);
  const account = selectedAccount(db);
  if (!account) {
    throw new SyncInputError('Select an account before syncing.');
  }
  const startedAt = now.toISOString();
  const positions = db
    .select()
    .from(brokerPositions)
    .where(and(eq(brokerPositions.brokerAccountId, account.id), eq(brokerPositions.status, 'open')))
    .all();
  const equities = positions.filter((position) => position.instrumentType === 'Equity' && position.providerSymbol);
  const options = positions.filter((position) => position.instrumentType === 'Equity Option' && position.providerSymbol);
  if (equities.length === 0 && options.length === 0) {
    writeMeta(db, 'broker_quote_unavailable', 'No imported equity or option symbol is available for a quote check.');
    recordRun(db, { accountId: account.id, kind: 'quotes', status: 'succeeded', startedAt, errorMessage: null, actor });
    return;
  }
  writeMeta(db, 'broker_quote_unavailable', '');
  const optionGroups = options.length > 0 ? chunks(options, QUOTE_BATCH) : [[]];
  let equityCursor = 0;
  const requests: Array<{ equities: typeof equities; options: typeof options }> = optionGroups.map((group) => {
    const room = Math.max(0, QUOTE_BATCH - group.length);
    const equityGroup = equities.slice(equityCursor, equityCursor + room);
    equityCursor += equityGroup.length;
    return { equities: equityGroup, options: group };
  });
  for (const extra of chunks(equities.slice(equityCursor), QUOTE_BATCH)) {
    requests.push({ equities: extra, options: [] });
  }
  let denied = false;
  try {
    for (const request of requests) {
      const targets = [...request.equities, ...request.options];
      if (targets.length === 0) continue;
      if (denied) {
        storeDeniedQuotes(db, targets, startedAt);
        continue;
      }
      const query: BrokerQuery = {};
      if (request.equities.length > 0) query.equity = request.equities.map((position) => position.providerSymbol);
      if (request.options.length > 0) query['equity-option'] = request.options.map((position) => position.providerSymbol);
      try {
        const body = await client.getJson('/market-data/by-type', query);
        const quotes = itemsOf(body);
        for (const target of targets) {
          const quote = quotes.find((item) => item && typeof item === 'object' && (item as { symbol?: string }).symbol === target.providerSymbol) as
            | Record<string, unknown>
            | undefined;
          const asOf = typeof quote?.['updated-at'] === 'string' ? quote['updated-at'] : null;
          db.insert(quoteSnapshots)
            .values({
              id: randomUUID(),
              symbol: target.providerSymbol,
              instrumentType: target.instrumentType,
              bid: asDecimalString(quote?.bid),
              ask: asDecimalString(quote?.ask),
              mid: asDecimalString(quote?.mid),
              mark: asDecimalString(quote?.mark),
              lastPrice: asDecimalString(quote?.last),
              quoteAsOf: asOf,
              fetchedAt: startedAt,
              freshness: classifyQuoteFreshness(asOf, now),
              entitlement: quote ? 'entitled' : 'unknown',
              source: 'tastytrade',
              message: quote ? 'Brokerage quote snapshot.' : 'The brokerage response did not include this symbol.',
            })
            .run();
        }
      } catch (error) {
        const refused = error instanceof Error && 'status' in error && (error as { status?: number }).status === 403;
        if (!refused) throw error;
        denied = true;
        storeDeniedQuotes(db, targets, startedAt);
      }
    }
    if (!denied) writeMeta(db, 'broker_last_success_at', new Date().toISOString());
    recordRun(db, {
      accountId: account.id,
      kind: 'quotes',
      status: denied ? 'failed' : 'succeeded',
      startedAt,
      errorMessage: denied ? 'Market data was denied.' : null,
      actor,
    });
  } catch (error) {
    recordRun(db, { accountId: account.id, kind: 'quotes', status: 'failed', startedAt, errorMessage: 'Quote check failed.', actor });
    throw error;
  }
}

function storeDeniedQuotes(
  db: AppDatabase,
  targets: Array<{ providerSymbol: string; instrumentType: string }>,
  startedAt: string,
): void {
  for (const target of targets) {
    db.insert(quoteSnapshots)
      .values({
        id: randomUUID(),
        symbol: target.providerSymbol,
        instrumentType: target.instrumentType,
        bid: null,
        ask: null,
        mid: null,
        mark: null,
        lastPrice: null,
        quoteAsOf: null,
        fetchedAt: startedAt,
        freshness: 'unavailable',
        entitlement: 'denied',
        source: 'tastytrade',
        message: 'Market data entitlement was denied. Connection status is unchanged.',
      })
      .run();
  }
}

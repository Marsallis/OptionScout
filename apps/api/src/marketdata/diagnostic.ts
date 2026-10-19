import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BrokerageReadClient } from '../brokerage/client.js';
import { resolveEquityOptions, type ResolvedInstrument, type UnresolvedInstrument } from '../brokerage/instruments.js';
import { isRegularUsEquitySession } from '../brokerage/market-hours.js';
import { loadReconstruction } from '../accounting/portfolio.js';
import { strategyPerformance } from '../accounting/strategy.js';
import type { AppDatabase } from '../db/client.js';
import { brokerAccounts, brokerPositions, brokerTransactions, quoteSnapshots } from '../db/schema.js';
import { parseQuoteToken } from './protocol.js';
import { DxlinkSession, type DxlinkSocket, type SessionSchedule } from './session.js';

const QUOTE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface DiagnosticReport {
  switchEnabled: true;
  startedAt: string;
  finishedAt: string;
  marketSession: 'regular' | 'closed';
  quietFeedIsFailure: false;
  instruments: Array<{
    requestedSymbol: string;
    resolved: boolean;
    returnedSymbol: string | null;
    streamerSymbol: string | null;
    reason: string | null;
  }>;
  socketOpened: boolean;
  handshake: {
    setup: boolean;
    authSent: boolean;
    authorized: boolean;
    channelOpened: boolean;
    feedConfigured: boolean;
  };
  subscriptions: {
    frames: number;
    eventTypes: string[];
    symbolCount: number;
    tradeSubscriptions: number;
  };
  keepaliveCount: number;
  closed: boolean;
  closeCode: number | null;
  errors: string[];
  events: Array<{
    requestedSymbol: string;
    connection: 'connected' | 'disconnected';
    freshness: string;
    quote: { bid: number | null; ask: number | null; eventTime: number | null; receivedAt: string | null } | null;
    greeks: {
      delta: number | null;
      gamma: number | null;
      theta: number | null;
      vega: number | null;
      rho: number | null;
      volatility: number | null;
      eventTime: number | null;
      receivedAt: string | null;
    } | null;
  }>;
  accounting: {
    transactionCount: number;
    transactionDigestUnchanged: boolean;
    quoteSnapshotDigestUnchanged: boolean;
    positionCount: number;
    longRemainingCost: string | null;
    shortNetCredit: string | null;
    knownFeeNetCashOutlay: string | null;
    combinedEstimatedPl: string | null;
    accountingComplete: boolean;
    feesEstimatedWarning: boolean;
    unresolvedCount: number;
    knownFeeFiguresUnchanged: boolean;
  };
}

interface TableDigest {
  count: number;
  digest: string;
}

function digestRows(rows: Array<{ id: string; body: string }>): TableDigest {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row.id).update('\0').update(row.body).update('\n');
  return { count: rows.length, digest: hash.digest('hex') };
}

function sourceDigests(db: AppDatabase): { transactions: TableDigest; quotes: TableDigest; positions: number } {
  const transactions = db
    .select({ id: brokerTransactions.providerTransactionId, body: brokerTransactions.rawJson })
    .from(brokerTransactions)
    .all()
    .sort((left, right) => left.id.localeCompare(right.id));
  const quotes = db
    .select({ id: quoteSnapshots.id, body: quoteSnapshots.mark })
    .from(quoteSnapshots)
    .all()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => ({ id: row.id, body: row.body ?? '' }));
  const positions = db.select({ id: brokerPositions.id }).from(brokerPositions).all().length;
  return { transactions: digestRows(transactions), quotes: digestRows(quotes), positions };
}

function accountingSnapshot(db: AppDatabase, now: Date) {
  const account = db.select().from(brokerAccounts).where(eq(brokerAccounts.selected, true)).get();
  if (!account) {
    return {
      longRemainingCost: null,
      shortNetCredit: null,
      knownFeeNetCashOutlay: null,
      combinedEstimatedPl: null,
      accountingComplete: false,
      feesEstimatedWarning: false,
      unresolvedCount: 0,
    };
  }
  const { reconstruction } = loadReconstruction(db, account.id, now);
  const long = reconstruction.symbols.find((symbol) => symbol.direction === 'long' && symbol.openQuantity !== '0');
  const short = reconstruction.symbols.find((symbol) => symbol.direction === 'short' && symbol.openQuantity !== '0');
  const openShorts = short?.cycles.filter((cycle) => cycle.side === 'short' && cycle.openQuantity !== '0') ?? [];
  const performance = long && short && openShorts.length > 0 ? strategyPerformance(long, openShorts.map((cycle) => ({ ledger: short, cycle }))) : null;
  const unresolvedCount = reconstruction.symbols.filter((symbol) => symbol.status === 'unreconciled' || symbol.status === 'missing-opening').length;
  const feesEstimatedWarning = reconstruction.symbols.some((symbol) => symbol.issues.some((issue) => issue.includes('estimated')));
  return {
    longRemainingCost: long?.remainingBasis ?? null,
    shortNetCredit: short?.remainingBasis ?? null,
    knownFeeNetCashOutlay: performance?.initialNetDebit ?? null,
    combinedEstimatedPl: performance?.combined ?? null,
    accountingComplete: performance?.complete ?? false,
    feesEstimatedWarning,
    unresolvedCount,
  };
}

function realSchedule(): SessionSchedule {
  return {
    now: () => Date.now(),
    every(ms, fn) {
      const timer = setInterval(fn, ms);
      return () => clearInterval(timer);
    },
    later(ms, fn) {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  };
}

export async function runDxlinkDiagnostic(input: {
  enabled: boolean;
  db: AppDatabase;
  client: BrokerageReadClient;
  connect: (url: string) => DxlinkSocket;
  now?: Date;
  listenMs?: number;
  feedWaitMs?: number;
  schedule?: SessionSchedule;
}): Promise<DiagnosticReport> {
  if (!input.enabled) {
    throw new Error('DXLink live diagnostic is disabled.');
  }
  const now = input.now ?? new Date();
  const before = sourceDigests(input.db);
  const beforeAccounting = accountingSnapshot(input.db, now);
  const account = input.db.select().from(brokerAccounts).where(eq(brokerAccounts.selected, true)).get();
  const positions = account
    ? input.db
        .select()
        .from(brokerPositions)
        .where(eq(brokerPositions.brokerAccountId, account.id))
        .all()
        .filter((row) => row.status === 'open' && row.instrumentType === 'Equity Option')
    : [];
  const { resolved, unresolved } = await resolveEquityOptions(
    input.client,
    input.db,
    positions.map((row) => row.providerSymbol),
    now.toISOString(),
  );
  const handshake = { setup: false, authSent: false, authorized: false, channelOpened: false, feedConfigured: false };
  const subscriptions = { frames: 0, eventTypes: [] as string[], symbolCount: 0, tradeSubscriptions: 0 };
  let keepaliveCount = 0;
  let socketOpened = false;
  let closed = false;
  let closeCode: number | null = null;
  const errors: string[] = [];
  const schedule = input.schedule ?? realSchedule();
  let events: DiagnosticReport['events'] = [];

  if (resolved.length > 0) {
    const session = new DxlinkSession({
      schedule,
      eventTypes: ['Quote', 'Greeks'],
      tokens: {
        async getQuoteToken() {
          const parsed = parseQuoteToken(await input.client.getJson('/api-quote-tokens'));
          return { ...parsed, expiresAt: schedule.now() + QUOTE_TOKEN_TTL_MS };
        },
      },
      connect(url) {
        socketOpened = true;
        return input.connect(url);
      },
      onInbound(frame) {
        let message: { type?: string; state?: string };
        try {
          message = JSON.parse(frame) as { type?: string; state?: string };
        } catch {
          return;
        }
        if (message.type === 'AUTH_STATE' && message.state === 'AUTHORIZED') handshake.authorized = true;
        if (message.type === 'CHANNEL_OPENED') handshake.channelOpened = true;
        if (message.type === 'FEED_CONFIG') handshake.feedConfigured = true;
      },
      onOutbound(frame) {
        let message: { type?: string; add?: Array<{ type?: string; symbol?: string }> };
        try {
          message = JSON.parse(frame) as { type?: string; add?: Array<{ type?: string; symbol?: string }> };
        } catch {
          return;
        }
        if (message.type === 'SETUP') handshake.setup = true;
        if (message.type === 'AUTH') handshake.authSent = true;
        if (message.type === 'KEEPALIVE') keepaliveCount += 1;
        if (message.type === 'FEED_SUBSCRIPTION' && message.add) {
          subscriptions.frames += 1;
          const types = new Set(message.add.map((item) => item.type).filter((type): type is string => typeof type === 'string'));
          const symbols = new Set(message.add.map((item) => item.symbol).filter((symbol): symbol is string => typeof symbol === 'string'));
          subscriptions.eventTypes = [...types].sort();
          subscriptions.symbolCount = symbols.size;
          subscriptions.tradeSubscriptions = message.add.filter((item) => item.type === 'Trade').length;
        }
      },
    });
    for (const instrument of resolved) {
      session.subscribe({ consumerId: 'diagnostic-a', instrumentId: instrument.requestedSymbol, streamerSymbol: instrument.streamerSymbol, purpose: 'position' });
      session.subscribe({ consumerId: 'diagnostic-b', instrumentId: instrument.requestedSymbol, streamerSymbol: instrument.streamerSymbol, purpose: 'position' });
    }
    try {
      await session.start();
      const ready = await session.waitForFeed(input.feedWaitMs ?? 15_000);
      handshake.feedConfigured = ready || handshake.feedConfigured;
      if (ready) await delay(input.listenMs ?? 35_000);
      else errors.push('The DXLink feed was not configured before the diagnostic deadline.');
      events = resolved.map((instrument) => eventView(instrument, session));
    } catch (error) {
      errors.push(safeError(error));
    } finally {
      session.stop();
      closed = true;
    }
    const after = sourceDigests(input.db);
    const accounting = accountingSnapshot(input.db, now);
    return finish({
      now,
      marketSession: isRegularUsEquitySession(now) ? 'regular' : 'closed',
      resolved,
      unresolved,
      socketOpened,
      handshake,
      subscriptions,
      keepaliveCount,
      closed,
      closeCode,
      errors,
      events,
      before,
      after,
      accounting,
      beforeAccounting,
    });
  }

  const after = sourceDigests(input.db);
  return finish({
    now,
    marketSession: isRegularUsEquitySession(now) ? 'regular' : 'closed',
    resolved,
    unresolved,
    socketOpened,
    handshake,
    subscriptions,
    keepaliveCount,
    closed: true,
    closeCode,
    errors: unresolved.length > 0 ? ['No verified streamer symbol was available, so no socket was opened.'] : ['No open option position was available.'],
    events: [],
    before,
    after,
    accounting: accountingSnapshot(input.db, now),
    beforeAccounting,
  });
}

function eventView(instrument: ResolvedInstrument, session: DxlinkSession): DiagnosticReport['events'][number] {
  const snapshot = session.snapshot(instrument.requestedSymbol);
  const quote = snapshot.row?.quote;
  const greeks = snapshot.row?.greeks;
  return {
    requestedSymbol: instrument.requestedSymbol,
    connection: snapshot.connection,
    freshness: snapshot.freshness,
    quote: quote
      ? { bid: quote.bid, ask: quote.ask, eventTime: quote.eventTime, receivedAt: snapshot.row?.quoteReceivedAt ?? null }
      : null,
    greeks: greeks
      ? {
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          vega: greeks.vega,
          rho: greeks.rho,
          volatility: greeks.volatility,
          eventTime: greeks.eventTime,
          receivedAt: snapshot.row?.greeksReceivedAt ?? null,
        }
      : null,
  };
}

function finish(input: {
  now: Date;
  marketSession: 'regular' | 'closed';
  resolved: ResolvedInstrument[];
  unresolved: UnresolvedInstrument[];
  socketOpened: boolean;
  handshake: DiagnosticReport['handshake'];
  subscriptions: DiagnosticReport['subscriptions'];
  keepaliveCount: number;
  closed: boolean;
  closeCode: number | null;
  errors: string[];
  events: DiagnosticReport['events'];
  before: ReturnType<typeof sourceDigests>;
  after: ReturnType<typeof sourceDigests>;
  accounting: ReturnType<typeof accountingSnapshot>;
  beforeAccounting: ReturnType<typeof accountingSnapshot>;
}): DiagnosticReport {
  const finished = new Date();
  return {
    switchEnabled: true,
    startedAt: input.now.toISOString(),
    finishedAt: finished.toISOString(),
    marketSession: input.marketSession,
    quietFeedIsFailure: false,
    instruments: [
      ...input.resolved.map((instrument) => ({
        requestedSymbol: instrument.requestedSymbol,
        resolved: true,
        returnedSymbol: instrument.returnedSymbol,
        streamerSymbol: instrument.streamerSymbol,
        reason: null,
      })),
      ...input.unresolved.map((instrument) => ({
        requestedSymbol: instrument.requestedSymbol,
        resolved: false,
        returnedSymbol: null,
        streamerSymbol: null,
        reason: instrument.reason,
      })),
    ],
    socketOpened: input.socketOpened,
    handshake: input.handshake,
    subscriptions: input.subscriptions,
    keepaliveCount: input.keepaliveCount,
    closed: input.closed,
    closeCode: input.closeCode,
    errors: input.errors,
    events: input.events,
    accounting: {
      transactionCount: input.after.transactions.count,
      transactionDigestUnchanged: input.before.transactions.digest === input.after.transactions.digest && input.before.transactions.count === input.after.transactions.count,
      quoteSnapshotDigestUnchanged: input.before.quotes.digest === input.after.quotes.digest,
      positionCount: input.after.positions,
      longRemainingCost: input.accounting.longRemainingCost,
      shortNetCredit: input.accounting.shortNetCredit,
      knownFeeNetCashOutlay: input.accounting.knownFeeNetCashOutlay,
      combinedEstimatedPl: input.accounting.combinedEstimatedPl,
      accountingComplete: input.accounting.accountingComplete,
      feesEstimatedWarning: input.accounting.feesEstimatedWarning,
      unresolvedCount: input.accounting.unresolvedCount,
      knownFeeFiguresUnchanged:
        input.beforeAccounting.longRemainingCost === input.accounting.longRemainingCost &&
        input.beforeAccounting.shortNetCredit === input.accounting.shortNetCredit &&
        input.beforeAccounting.knownFeeNetCashOutlay === input.accounting.knownFeeNetCashOutlay &&
        input.beforeAccounting.combinedEstimatedPl === input.accounting.combinedEstimatedPl,
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'DXLink diagnostic failed.';
  if (/bearer|token|secret|refresh/i.test(message)) return 'DXLink diagnostic failed.';
  return message;
}

export function attachCloseCode(report: DiagnosticReport, code: number): DiagnosticReport {
  return { ...report, closeCode: code };
}

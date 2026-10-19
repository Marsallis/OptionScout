/**
 * Phase 1D.2a.5c acceptance tests — universe ingestion, restart-safe continuation, claims,
 * imports, and deletion isolation. Every provider call is mocked; a brokerage spy proves
 * nothing reaches the brokerage client.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAL_PMCC_DEEP_ITM, type FinderCandidate, type SmartScanResult } from '@optionscout/shared';
import { setupOwnerPassphrase } from './auth/owner.js';
import { createApp } from './app.js';
import { TastytradeError } from './brokerage/errors.js';
import { tradingSessionKey } from './brokerage/market-hours.js';
import { parseConfig } from './config.js';
import { openAppContext, type AppContext } from './context.js';
import { DEMO_UNDERLYING, DemoFinderQuoteSource } from './finder/demo-chain.js';
import { resetFinderScans } from './finder/scan.js';
import { reconcileBatch } from './finder/research-sessions.js';
import { SmartMockQuoteSource, mockSpotForTicker, smartMockNestedChainPayload } from './finder/smart-mock.js';
import {
  continueSmartScan,
  resetSmartScans,
  runSmartScanMoreForTest,
  startSmartScan,
  waitForSmartScan,
  type SmartScanDeps,
} from './finder/smart-scan.js';
import type { FinderQuoteSnapshot, FinderQuoteSource } from './finder/quotes.js';
import { readStrategyProfile, saveStrategyProfile } from './strategy/profiles.js';

const PASSPHRASE = 'correct horse battery staple 1D2a5c';
const ORIGIN = 'http://127.0.0.1';
const PROFILE = SAL_PMCC_DEEP_ITM.id;

/** Deterministic alphabetic ticker for index i (A..Z, AA..ZZ, AAA..). */
function letters(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function holdingsCsv(count: number, opts: { offset?: number; preamble?: boolean; nameSuffix?: string } = {}): string {
  const lines: string[] = [];
  if (opts.preamble) lines.push('Example Fund Holdings', 'Fund Holdings as of,"Oct 15, 2026"');
  lines.push('Ticker,Name,Sector,Asset Class,Weight (%)');
  for (let i = 0; i < count; i += 1) {
    const t = letters(i + (opts.offset ?? 0));
    lines.push(`${t},${t} Holdings Incorporated Common Stock${opts.nameSuffix ?? ''},Industrials,Equity,0.05`);
  }
  return lines.join('\n');
}

type Mocks = {
  chainCalls: string[];
  quoteCalls: number;
  brokerageCalls: number;
  failChainFor: Map<string, () => Error>;
};

function newMocks(): Mocks {
  return { chainCalls: [], quoteCalls: 0, brokerageCalls: 0, failChainFor: new Map() };
}

class CountingQuoteSource implements FinderQuoteSource {
  private readonly inner = new SmartMockQuoteSource('2026-10-15T14:00:00.000Z');
  constructor(
    private readonly mocks: Mocks,
    private readonly gate?: (call: number) => Promise<void> | void,
  ) {}
  async fetchQuotes(symbols: readonly string[]): Promise<Map<string, FinderQuoteSnapshot>> {
    this.mocks.quoteCalls += 1;
    await this.gate?.(this.mocks.quoteCalls);
    return this.inner.fetchQuotes(symbols);
  }
}

function installMocks(context: AppContext, mocks: Mocks, quoteSource?: FinderQuoteSource): void {
  context.smartScanTestDeps = {
    chainPayloadForTicker: (ticker: string) => {
      mocks.chainCalls.push(ticker);
      const failure = mocks.failChainFor.get(ticker);
      if (failure) throw failure();
      return smartMockNestedChainPayload(ticker);
    },
    quoteSource: quoteSource ?? new CountingQuoteSource(mocks),
  };
  context.brokerage = {
    getJson: vi.fn(async () => {
      mocks.brokerageCalls += 1;
      throw new Error('Brokerage must not be called in these tests.');
    }),
  };
}

const directories: string[] = [];
const openContexts: AppContext[] = [];

async function openAt(databasePath: string): Promise<AppContext> {
  const context = await openAppContext(
    parseConfig(
      {
        NODE_ENV: 'test',
        PORT: '3180',
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: databasePath,
        DATA_MODE: 'demo',
        AUTH_MODE: 'local-owner',
        ENABLE_ORDER_EXECUTION: 'false',
        TELEMETRY_ENABLED: 'false',
        RUNNING_IN_DOCKER: 'false',
        STATIC_DIR: '',
      },
      { secretFilePath: path.join(path.dirname(databasePath), 'missing-secret.json') },
    ),
  );
  openContexts.push(context);
  return context;
}

type Session = {
  context: AppContext;
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  post: (url: string, body?: unknown) => request.Test;
};

async function signIn(context: AppContext, first: boolean): Promise<Session> {
  if (first) setupOwnerPassphrase(context.database.db, PASSPHRASE);
  const agent = request.agent(createApp(context));
  const loggedIn = await agent.post('/api/session').set('Origin', ORIGIN).send({ passphrase: PASSPHRASE });
  expect(loggedIn.status).toBe(200);
  const csrf = String(loggedIn.body.csrfToken);
  return {
    context,
    agent,
    csrf,
    post: (url, body = {}) => agent.post(url).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body as object),
  };
}

/** Simulate a backend restart: drop in-memory sessions, close SQLite, boot a fresh context on the same file. */
async function restart(previous: AppContext, databasePath: string): Promise<AppContext> {
  resetSmartScans();
  resetFinderScans();
  previous.close();
  openContexts.splice(openContexts.indexOf(previous), 1);
  return openAt(databasePath);
}

async function importHoldings(
  session: Session,
  csvText: string,
  extra: Record<string, unknown> = {},
): Promise<{ universeId: string; versionId: string; version: number; unchanged: boolean }> {
  const preview = await session.post('/api/discovery/universes/holdings/preview', { csvText });
  expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
  const saved = await session.post('/api/discovery/universes/holdings', {
    name: 'Example ETF',
    fundTicker: 'EXMP',
    provider: 'Example Provider',
    holdingsEffectiveDate: '2026-10-15',
    csvText,
    contentHash: preview.body.contentHash,
    ...extra,
  });
  expect([200, 201], JSON.stringify(saved.body)).toContain(saved.status);
  return saved.body;
}

function companyRows(context: AppContext, sessionId: string) {
  return context.database.sqlite
    .prepare(
      `SELECT ticker, queue_index, status, attempt_count FROM research_session_companies WHERE session_id = ? ORDER BY queue_index`,
    )
    .all(sessionId) as Array<{ ticker: string; queue_index: number; status: string; attempt_count: number }>;
}

function sessionRow(context: AppContext, sessionId: string) {
  return context.database.sqlite
    .prepare(`SELECT status, company_cursor, universe_version_id, active_batch_id FROM research_sessions WHERE id = ?`)
    .get(sessionId) as { status: string; company_cursor: number; universe_version_id: string; active_batch_id: string | null };
}

function batches(context: AppContext, sessionId: string) {
  return context.database.sqlite
    .prepare(`SELECT id, seq, batch_kind, status, ticker_batch_json FROM research_session_batches WHERE session_id = ? ORDER BY seq`)
    .all(sessionId) as Array<{ id: string; seq: number; batch_kind: string; status: string; ticker_batch_json: string }>;
}

describe('Phase 1D.2a.5c research continuation acceptance', () => {
  let dir: string;
  let dbPath: string;
  let mocks: Mocks;

  beforeEach(() => {
    resetSmartScans();
    resetFinderScans();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-1d2a5c-'));
    directories.push(dir);
    dbPath = path.join(dir, 'optionscout.sqlite');
    mocks = newMocks();
  });

  afterEach(() => {
    resetSmartScans();
    resetFinderScans();
    for (const context of openContexts.splice(0)) context.close();
    for (const d of directories.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('1+2+3: imports 500 tickers, scans 12, keeps 488 queued, continues with the next 12, and survives a restart', async () => {
    let context = await openAt(dbPath);
    installMocks(context, mocks);
    let s = await signIn(context, true);
    const imported = await importHoldings(s, holdingsCsv(500));
    expect(imported.version).toBe(1);

    const started = await s.post('/api/finder/smart-scans', {
      universeId: imported.universeId,
      profileId: PROFILE,
      evaluationBudget: 12,
    });
    expect(started.status, JSON.stringify(started.body).slice(0, 400)).toBe(201);
    const scan = started.body as SmartScanResult;
    expect(scan.universeVersionId).toBe(imported.versionId);
    expect(scan.companiesInUniverseQueue).toBe(500);
    expect(scan.companyCursor).toBe(12);
    expect(scan.canScanNextCompanies).toBe(true);
    expect(new Set(mocks.chainCalls)).toEqual(new Set(Array.from({ length: 12 }, (_, i) => letters(i))));

    const rows = companyRows(context, scan.scanId);
    expect(rows).toHaveLength(500);
    expect(rows.map((r) => r.ticker)).toEqual(Array.from({ length: 500 }, (_, i) => letters(i)));
    expect(rows.slice(12).every((r) => r.status === 'pending' && r.attempt_count === 0)).toBe(true);
    expect(rows.slice(0, 12).every((r) => r.attempt_count === 1)).toBe(true);

    mocks.chainCalls.length = 0;
    const next = await s.post(`/api/finder/smart-scans/${scan.scanId}/next-companies`, { count: 12, evaluationBudget: 12 });
    expect(next.status, JSON.stringify(next.body).slice(0, 300)).toBe(200);
    expect(next.body.companyCursor).toBe(24);
    expect(mocks.chainCalls).toEqual(Array.from({ length: 12 }, (_, i) => letters(12 + i)));

    context = await restart(context, dbPath);
    installMocks(context, mocks);
    s = await signIn(context, false);
    expect(mocks.brokerageCalls).toBe(0);
    const latest = await s.agent.get('/api/research-sessions/latest?type=discover');
    expect(latest.status).toBe(200);
    expect(latest.body.result.companyCursor).toBe(24);
    expect(latest.body.orderedTickerQueue).toHaveLength(500);

    mocks.chainCalls.length = 0;
    const third = await s.post(`/api/finder/smart-scans/${scan.scanId}/next-companies`, { count: 12, evaluationBudget: 12 });
    expect(third.status, JSON.stringify(third.body).slice(0, 300)).toBe(200);
    expect(third.body.companyCursor).toBe(36);
    expect(third.body.universeVersionId).toBe(imported.versionId);
    expect(mocks.chainCalls).toEqual(Array.from({ length: 12 }, (_, i) => letters(24 + i)));
    expect(mocks.brokerageCalls).toBe(0);
  });

  it('4: reconciles committed versus retryable work after a mid-batch interruption', async () => {
    let context = await openAt(dbPath);
    let release: (() => void) | null = null;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const quoteSource = new CountingQuoteSource(mocks, (call) => (call === 2 ? hang : undefined));
    installMocks(context, mocks, quoteSource);
    const deps: SmartScanDeps = {
      smartScanLiveEnabled: false,
      liveScanEnabled: false,
      portfolioView: 'demo',
      smartScanMode: 'normal',
      readProfile: (id) => readStrategyProfile(context.database.db, id),
      database: context.database.db,
      persistSqlite: context.database.sqlite,
      ...context.smartScanTestDeps,
    };
    const started = startSmartScan(deps, { tickers: ['AAPL', 'MSFT', 'CVX'], profileId: PROFILE, evaluationBudget: 24 });
    const batchId = started.activeBatchId!;
    expect(batchId).toBe(`${started.scanId}:b1`);
    for (let i = 0; i < 100 && mocks.quoteCalls < 2; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(mocks.quoteCalls).toBe(2);

    const before = reconcileBatch(context.database.sqlite, batchId)!;
    expect(before.status).toBe('running');
    expect(before.planned.length).toBeGreaterThan(8);
    expect(before.committed.length).toBe(8);

    // Crash: the process dies mid-batch (in-memory state is lost, the claim is left behind).
    context = await restart(context, dbPath);
    installMocks(context, mocks);
    const after = reconcileBatch(context.database.sqlite, batchId)!;
    expect(after.status).toBe('interrupted');
    expect(after.committed).toEqual(before.committed);
    expect(after.retryable).toHaveLength(before.planned.length - 8);
    const row = sessionRow(context, started.scanId);
    expect(row.status).toBe('interrupted');
    expect(row.active_batch_id).toBeNull();

    // The dead batch wakes up late: it must not write into the session.
    release!();
    await new Promise((r) => setTimeout(r, 20));
    expect(reconcileBatch(context.database.sqlite, batchId)!.committed).toEqual(before.committed);

    // Only an explicit continuation resumes; it skips committed OCC symbols and discloses rediscovery.
    const s = await signIn(context, true);
    const more = await s.post(`/api/finder/smart-scans/${started.scanId}/more`, { count: 24 });
    expect(more.status, JSON.stringify(more.body).slice(0, 300)).toBe(200);
    expect(more.body.message).toMatch(/re-requests option chains/i);
    const occ = (more.body as SmartScanResult).candidates.map((c) => c.occSymbol);
    expect(new Set(occ).size).toBe(occ.length);
    for (const committed of before.committed) expect(occ).toContain(committed);
    for (const retryable of after.retryable) expect(occ).toContain(retryable);
    expect(mocks.brokerageCalls).toBe(0);
  });

  it('5: Finder Scan More works after a restart', async () => {
    let context = await openAt(dbPath);
    let s = await signIn(context, true);
    const first = await s.post('/api/finder/scans', { underlying: DEMO_UNDERLYING, profileId: PROFILE, evaluationBudget: 8 });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);
    const scanId = first.body.scanId as string;
    const firstOcc = (first.body.candidates as Array<{ occSymbol: string }>).map((c) => c.occSymbol);
    expect(first.body.progress.remaining).toBeGreaterThan(0);

    context = await restart(context, dbPath);
    s = await signIn(context, false);
    const more = await s.post(`/api/finder/scans/${scanId}/more`, { count: 8 });
    expect(more.status, JSON.stringify(more.body).slice(0, 300)).toBe(200);
    expect(more.body.message).toMatch(/re-requests option chains/i);
    const occ = (more.body.candidates as Array<{ occSymbol: string }>).map((c) => c.occSymbol);
    expect(occ.length).toBeGreaterThan(firstOcc.length);
    expect(new Set(occ).size).toBe(occ.length);
    for (const o of firstOcc) expect(occ).toContain(o);
    const finderBatches = batches(context, scanId);
    expect(finderBatches.map((b) => b.status)).toEqual(['completed', 'completed']);
  });

  it('6: two simultaneous Scan Next requests cannot double-advance the cursor', async () => {
    const context = await openAt(dbPath);
    let hold: Promise<void> | null = null;
    let releaseHold: () => void = () => undefined;
    installMocks(context, mocks, new CountingQuoteSource(mocks, () => hold ?? undefined));
    const s = await signIn(context, true);
    const imported = await importHoldings(s, holdingsCsv(60));
    const started = await s.post('/api/finder/smart-scans', { universeId: imported.universeId, profileId: PROFILE, evaluationBudget: 8 });
    const scanId = started.body.scanId as string;

    hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const callsBefore = mocks.quoteCalls;
    const first = s.post(`/api/finder/smart-scans/${scanId}/next-companies`, { count: 12, evaluationBudget: 8 }).then((r) => r);
    for (let i = 0; i < 200 && mocks.quoteCalls === callsBefore; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(mocks.quoteCalls).toBeGreaterThan(callsBefore);

    // Same process: rejected by the in-flight operation.
    const second = await s.post(`/api/finder/smart-scans/${scanId}/next-companies`, { count: 12, evaluationBudget: 8 });
    expect(second.status).toBe(409);
    // No in-memory state (as from another process): rejected by the SQLite claim alone.
    resetSmartScans();
    const third = await s.post(`/api/finder/smart-scans/${scanId}/next-companies`, { count: 12, evaluationBudget: 8 });
    expect(third.status).toBe(409);
    expect(third.body.error).toMatch(/already running/i);

    hold = null;
    releaseHold();
    expect((await first).status).toBe(200);
    expect(sessionRow(context, scanId).company_cursor).toBe(24);
    expect(batches(context, scanId).map((b) => b.status)).toEqual(['completed', 'completed']);
  });

  it('7: running and completed batch events share one batch identity', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    const deps: SmartScanDeps = {
      smartScanLiveEnabled: false,
      liveScanEnabled: false,
      portfolioView: 'demo',
      smartScanMode: 'normal',
      readProfile: (id) => readStrategyProfile(context.database.db, id),
      persistSqlite: context.database.sqlite,
      ...context.smartScanTestDeps,
    };
    const started = startSmartScan(deps, { tickers: ['AAPL', 'MSFT'], profileId: PROFILE, evaluationBudget: 8 });
    expect(started.status).toBe('running');
    const running = batches(context, started.scanId);
    expect(running).toEqual([expect.objectContaining({ id: started.activeBatchId, seq: 1, status: 'running' })]);
    const finished = (await waitForSmartScan(started.scanId))!;
    expect(finished.status).toBe('completed');
    expect(finished.activeBatchId).toBeNull();
    const done = batches(context, started.scanId);
    expect(done).toEqual([expect.objectContaining({ id: started.activeBatchId, seq: 1, status: 'completed' })]);
    const candidateBatchIds = context.database.sqlite
      .prepare('SELECT DISTINCT batch_id FROM research_session_candidates WHERE session_id = ?')
      .all(started.scanId) as Array<{ batch_id: string }>;
    expect(candidateBatchIds.map((r) => r.batch_id)).toEqual([started.activeBatchId]);
  });

  it('8: rate-limited companies stay retryable and Retry Companies does not move the cursor', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    mocks.failChainFor.set('B', () => new TastytradeError(429, true, 'The brokerage rate limit was reached. Try again later.'));
    mocks.failChainFor.set('C', () => new Error('socket hang up'));
    const s = await signIn(context, true);
    const imported = await importHoldings(s, holdingsCsv(30));
    const started = await s.post('/api/finder/smart-scans', { universeId: imported.universeId, profileId: PROFILE, evaluationBudget: 8 });
    expect(started.status).toBe(201);
    const scan = started.body as SmartScanResult;
    expect(scan.tickers.find((t) => t.ticker === 'B')?.status).toBe('rate-limited');
    expect(scan.tickers.find((t) => t.ticker === 'C')?.status).toBe('error');
    expect(scan.companiesRetryable).toBe(2);
    expect(scan.companyCursor).toBe(12);

    const listed = await s.agent.get('/api/research-sessions?type=discover');
    expect(listed.body.sessions[0].companiesRetryable).toBe(2);

    mocks.failChainFor.clear();
    mocks.chainCalls.length = 0;
    const retried = await s.post(`/api/finder/smart-scans/${scan.scanId}/retry-companies`, {});
    expect(retried.status, JSON.stringify(retried.body).slice(0, 300)).toBe(200);
    expect(mocks.chainCalls.sort()).toEqual(['B', 'C']);
    expect(retried.body.companyCursor).toBe(12);
    expect(retried.body.companiesRetryable).toBe(0);
    const rows = companyRows(context, scan.scanId);
    expect(rows.find((r) => r.ticker === 'B')).toMatchObject({ attempt_count: 2 });
    expect(['chain-loaded', 'evaluated']).toContain(rows.find((r) => r.ticker === 'B')!.status);

    const none = await s.post(`/api/finder/smart-scans/${scan.scanId}/retry-companies`, {});
    expect(none.status).toBe(409);
  });

  it('9: large HTTP holdings imports succeed; oversized, malformed, unauthenticated, and unvalidated requests fail safely', async () => {
    const context = await openAt(dbPath);
    const s = await signIn(context, true);
    const big = holdingsCsv(2000, { preamble: true });
    expect(big.length).toBeGreaterThan(32 * 1024);
    const preview = await s.post('/api/discovery/universes/holdings/preview', { csvText: big });
    expect(preview.status).toBe(200);
    expect(preview.body.counts.equity).toBe(2000);
    expect(preview.body.rows).toHaveLength(2000);
    expect(preview.body.detectedEffectiveDate).toBe('2026-10-15');
    const saved = await importHoldings(s, big);
    expect(saved.version).toBe(1);
    const version = context.database.sqlite
      .prepare('SELECT supported_equity_count, holdings_effective_date FROM discovery_universe_versions WHERE id = ?')
      .get(saved.versionId) as { supported_equity_count: number; holdings_effective_date: string };
    expect(version).toEqual({ supported_equity_count: 2000, holdings_effective_date: '2026-10-15' });

    const oversized = await s.post('/api/discovery/universes/holdings/preview', { csvText: 'x'.repeat(3_600_000) });
    expect(oversized.status).toBe(413);
    const tooManyChars = await s.post('/api/discovery/universes/holdings/preview', { csvText: 'x'.repeat(2_600_000) });
    expect(tooManyChars.status).toBe(400);
    const malformed = await s.agent
      .post('/api/discovery/universes/holdings/preview')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s.csrf)
      .set('Content-Type', 'application/json')
      .send('{"csvText": ');
    expect(malformed.status).toBe(400);
    const anonymous = await request(createApp(context))
      .post('/api/discovery/universes/holdings/preview')
      .set('Origin', ORIGIN)
      .send({ csvText: big });
    expect(anonymous.status).toBe(401);
    const noCsrf = await s.agent.post('/api/discovery/universes/holdings/preview').set('Origin', ORIGIN).send({ csvText: big });
    expect(noCsrf.status).toBe(403);
    // Other routes keep the small global body limit.
    const otherRoute = await s.post('/api/discovery/universes', { name: 'x', tickers: Array(20000).fill('AAPL') });
    expect(otherRoute.status).toBe(413);

    const stale = await s.post('/api/discovery/universes/holdings', {
      name: 'Changed',
      holdingsEffectiveDate: '2026-10-15',
      csvText: `${big}\nZZZ,Zed,Industrials,Equity,0.1`,
      contentHash: preview.body.contentHash,
    });
    expect(stale.status).toBe(409);
    const noDate = await s.post('/api/discovery/universes/holdings', {
      name: 'No date',
      csvText: big,
      contentHash: preview.body.contentHash,
    });
    expect(noDate.status).toBe(400);
    const badTickers = await s.post('/api/discovery/universes/holdings/preview', {
      csvText: 'Ticker,Name,Asset Class\nT0001,Bad,Equity\nT0002,Bad,Equity\nGOOD,Good,Equity',
    });
    expect(badTickers.body.uniqueEquityTickers).toEqual(['GOOD']);
    expect(badTickers.body.counts.invalid).toBe(2);
  });

  it('10+11: repeated imports create immutable versions; historical sessions keep their version and strategy snapshot', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    const s = await signIn(context, true);
    const v1 = await importHoldings(s, holdingsCsv(40));
    expect(v1).toMatchObject({ version: 1, unchanged: false });

    const profileBefore = readStrategyProfile(context.database.db, PROFILE);
    const started = await s.post('/api/finder/smart-scans', { universeId: v1.universeId, profileId: PROFILE, evaluationBudget: 8 });
    const scanId = started.body.scanId as string;

    const v2 = await importHoldings(s, holdingsCsv(40, { offset: 100 }), { universeId: v1.universeId });
    expect(v2).toMatchObject({ universeId: v1.universeId, version: 2, unchanged: false });
    expect(v2.versionId).toBe(`${v1.universeId}@v2`);
    const again = await importHoldings(s, holdingsCsv(40, { offset: 100 }), { universeId: v1.universeId });
    expect(again).toMatchObject({ version: 2, unchanged: true, versionId: v2.versionId });
    const versionRows = context.database.sqlite
      .prepare('SELECT id, version, tickers_json FROM discovery_universe_versions WHERE universe_id = ? ORDER BY version')
      .all(v1.universeId) as Array<{ id: string; version: number; tickers_json: string }>;
    expect(versionRows.map((r) => r.version)).toEqual([1, 2]);
    expect(JSON.parse(versionRows[0]!.tickers_json)[0]).toBe('A');
    expect(JSON.parse(versionRows[1]!.tickers_json)[0]).toBe(letters(100));
    const listed = await s.agent.get('/api/discovery/universes');
    const saved = (listed.body.saved as Array<{ id: string; currentVersion: { version: number; holdingsEffectiveDate: string } }>).find(
      (u) => u.id === v1.universeId,
    )!;
    expect(saved.currentVersion).toMatchObject({ version: 2, holdingsEffectiveDate: '2026-10-15' });

    saveStrategyProfile(context.database.db, PROFILE, { name: 'Edited after the session started' });
    expect(readStrategyProfile(context.database.db, PROFILE).revision).toBe(profileBefore.revision + 1);

    mocks.chainCalls.length = 0;
    const next = await s.post(`/api/finder/smart-scans/${scanId}/next-companies`, { count: 12, evaluationBudget: 8 });
    expect(next.status).toBe(200);
    expect(next.body.universeVersionId).toBe(v1.versionId);
    expect(next.body.profileRevision).toBe(profileBefore.revision);
    expect(mocks.chainCalls).toEqual(Array.from({ length: 12 }, (_, i) => letters(12 + i)));
    const restored = await s.agent.get(`/api/research-sessions/${scanId}`);
    expect(restored.body.strategySnapshot.revision).toBe(profileBefore.revision);
    expect(restored.body.orderedTickerQueue[0]).toBe('A');
  });

  it('13: authenticated deletion removes only the chosen session', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    const s = await signIn(context, true);
    const one = await s.post('/api/finder/smart-scans', { tickers: ['AAPL'], profileId: PROFILE, evaluationBudget: 8 });
    const two = await s.post('/api/finder/smart-scans', { tickers: ['MSFT'], profileId: PROFILE, evaluationBudget: 8 });
    const count = (table: string) =>
      (context.database.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const before = {
      transactions: count('transactions'),
      brokerTransactions: count('broker_transactions'),
      positions: count('positions'),
      strategies: count('strategy_profiles'),
      revisions: count('strategy_profile_revisions'),
    };
    const anonymous = await request(createApp(context)).delete(`/api/research-sessions/${one.body.scanId}`).set('Origin', ORIGIN);
    expect(anonymous.status).toBe(401);
    const noCsrf = await s.agent.delete(`/api/research-sessions/${one.body.scanId}`).set('Origin', ORIGIN);
    expect(noCsrf.status).toBe(403);
    const deleted = await s.agent
      .delete(`/api/research-sessions/${one.body.scanId}`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s.csrf);
    expect(deleted.status).toBe(204);
    expect((await s.agent.get(`/api/research-sessions/${one.body.scanId}`)).status).toBe(404);
    const other = await s.agent.get(`/api/research-sessions/${two.body.scanId}`);
    expect(other.status).toBe(200);
    expect(other.body.result.candidates.length).toBeGreaterThan(0);
    expect({
      transactions: count('transactions'),
      brokerTransactions: count('broker_transactions'),
      positions: count('positions'),
      strategies: count('strategy_profiles'),
      revisions: count('strategy_profile_revisions'),
    }).toEqual(before);
  });

  it('14: startup and restore never call the brokerage or restart provider work', async () => {
    let context = await openAt(dbPath);
    installMocks(context, mocks);
    const s1 = await signIn(context, true);
    const started = await s1.post('/api/finder/smart-scans', { tickers: ['AAPL', 'MSFT'], profileId: PROFILE, evaluationBudget: 8 });
    // Leave a stale running claim behind, as a crash would.
    context.database.sqlite
      .prepare(`UPDATE research_sessions SET status = 'running', active_batch_id = 'stale', active_lock_until = '2999-01-01T00:00:00.000Z' WHERE id = ?`)
      .run(started.body.scanId);
    const callsBefore = { chain: mocks.chainCalls.length, quotes: mocks.quoteCalls };

    context = await restart(context, dbPath);
    installMocks(context, mocks);
    const s2 = await signIn(context, false);
    await new Promise((r) => setTimeout(r, 30));
    for (const url of [
      '/api/research-sessions?type=discover',
      '/api/research-sessions/latest?type=discover',
      `/api/research-sessions/${started.body.scanId}`,
      `/api/finder/smart-scans/${started.body.scanId}`,
    ]) {
      const res = await s2.agent.get(url);
      expect(res.status, url).toBe(200);
    }
    const prefs = await s2.agent
      .patch(`/api/research-sessions/${started.body.scanId}/ui-prefs`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s2.csrf)
      .send({ uiPrefs: { discoverView: 'list' } });
    expect(prefs.status).toBe(200);
    expect(sessionRow(context, started.body.scanId)).toMatchObject({ status: 'interrupted', active_batch_id: null });
    expect(mocks.chainCalls.length).toBe(callsBefore.chain);
    expect(mocks.quoteCalls).toBe(callsBefore.quotes);
    expect(mocks.brokerageCalls).toBe(0);
    expect(context.brokerage!.getJson).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------------------------
  // Final data integrity review: stale underlying prices, claim heartbeat/fencing, durability.
  // ---------------------------------------------------------------------------------------------

  const TUE = '2026-10-13T15:00:00.000Z'; // 11:00 ET, regular session
  const FRI = '2026-10-16T15:00:00.000Z';
  const MON = '2026-10-19T15:00:00.000Z';

  type Clock = { now: Date };

  function candidateSnapshots(context: AppContext, sessionId: string): Map<string, string> {
    const rows = context.database.sqlite
      .prepare('SELECT occ_symbol, snapshot_json FROM research_session_candidates WHERE session_id = ?')
      .all(sessionId) as Array<{ occ_symbol: string; snapshot_json: string }>;
    return new Map(rows.map((row) => [row.occ_symbol, row.snapshot_json]));
  }

  function installClockedSmartMocks(
    context: AppContext,
    clock: Clock,
    stock: { calls: string[]; fail: string | null; factor: number },
    gate?: () => Promise<void> | void,
  ): SmartScanDeps {
    installMocks(context, mocks);
    context.smartScanTestDeps = {
      ...context.smartScanTestDeps,
      now: () => clock.now,
      quoteSource: {
        fetchQuotes: async (symbols) => {
          mocks.quoteCalls += 1;
          await gate?.();
          return new SmartMockQuoteSource(clock.now.toISOString()).fetchQuotes(symbols);
        },
      },
      underlyingQuote: async (ticker) => {
        stock.calls.push(ticker);
        if (stock.fail) throw new Error(stock.fail);
        return {
          price: (Number(mockSpotForTicker(ticker)) * stock.factor).toFixed(2),
          quoteAt: clock.now.toISOString(),
          bid: null,
          ask: null,
        };
      },
    };
    return {
      smartScanLiveEnabled: false,
      liveScanEnabled: false,
      portfolioView: 'demo',
      smartScanMode: 'normal',
      readProfile: (id) => readStrategyProfile(context.database.db, id),
      database: context.database.db,
      persistSqlite: context.database.sqlite,
      ...context.smartScanTestDeps,
    };
  }

  const hasSessionMismatch = (candidate: FinderCandidate) =>
    candidate.validationIssues.some((issue) => issue.code === 'stock_option_session_mismatch');

  it('integrity 1: trading-session keys treat after-hours and weekends as the prior session', () => {
    expect(tradingSessionKey(new Date('2026-10-16T23:36:00.000Z'))).toBe('2026-10-16'); // Fri 19:36 ET
    expect(tradingSessionKey(new Date('2026-10-17T10:33:00.000Z'))).toBe('2026-10-16'); // Sat
    expect(tradingSessionKey(new Date('2026-10-19T12:00:00.000Z'))).toBe('2026-10-16'); // Mon 08:00 ET pre-open
    expect(tradingSessionKey(new Date('2026-10-19T13:30:00.000Z'))).toBe('2026-10-19'); // Mon 09:30 ET open
    expect(tradingSessionKey(new Date(TUE))).toBe('2026-10-13');
  });

  it('integrity 2: Smart Scan resumed days later re-observes the stock price and keeps earlier snapshots', async () => {
    let context = await openAt(dbPath);
    const clock: Clock = { now: new Date(TUE) };
    const stock = { calls: [] as string[], fail: null as string | null, factor: 1 };
    let deps = installClockedSmartMocks(context, clock, stock);

    const started = startSmartScan(deps, { tickers: ['AAPL', 'MSFT', 'CVX'], profileId: PROFILE, evaluationBudget: 4 });
    const first = (await waitForSmartScan(started.scanId))!;
    expect(first.status).toBe('completed');
    expect([...stock.calls].sort()).toEqual(['AAPL', 'CVX', 'MSFT']);
    const original = candidateSnapshots(context, started.scanId);
    expect(original.size).toBe(4);
    for (const candidate of first.candidates) expect(hasSessionMismatch(candidate)).toBe(false);

    // Three days later, Scan More Contracts in the same process.
    clock.now = new Date(FRI);
    stock.calls.length = 0;
    stock.factor = 0.99;
    const more = await runSmartScanMoreForTest(started.scanId, { count: 4 }, deps);
    expect(more.status, more.error ?? '').toBe('completed');
    const added = more.candidates.filter((c) => !original.has(c.occSymbol));
    expect(added.length).toBeGreaterThan(0);
    const addedTickers = new Set(added.map((c) => c.underlying));
    expect(new Set(stock.calls)).toEqual(addedTickers);
    expect(stock.calls.length).toBe(addedTickers.size); // one observation per company per operation
    for (const candidate of added) {
      expect(candidate.underlyingPrice).toBe((Number(mockSpotForTicker(candidate.underlying)) * 0.99).toFixed(2));
      expect(hasSessionMismatch(candidate)).toBe(false);
    }
    for (const ticker of addedTickers) {
      expect(more.tickers.find((t) => t.ticker === ticker)?.underlyingQuoteAt).toBe(FRI);
    }
    const afterMore = candidateSnapshots(context, started.scanId);
    for (const [occ, snapshot] of original) expect(afterMore.get(occ)).toBe(snapshot);

    // After a restart, on Monday, the stock quote fails: new rows are unverified with the reason.
    context = await restart(context, dbPath);
    clock.now = new Date(MON);
    stock.calls.length = 0;
    stock.fail = 'equity quote timed out';
    deps = installClockedSmartMocks(context, clock, stock);
    continueSmartScan(started.scanId, { count: 4 }, deps);
    const resumed = (await waitForSmartScan(started.scanId))!;
    expect(resumed.status, resumed.error ?? '').toBe('completed');
    const late = resumed.candidates.filter((c) => !afterMore.has(c.occSymbol));
    expect(late.length).toBeGreaterThan(0);
    expect(stock.calls.length).toBeGreaterThan(0);
    for (const candidate of late) {
      const issue = candidate.validationIssues.find((row) => row.code === 'stock_option_session_mismatch');
      expect(issue?.severity).toBe('reject');
      expect(issue?.message).toMatch(/different trading sessions/);
      expect(issue?.message).toMatch(/equity quote timed out/);
      expect(candidate.outcome).toBe('incomplete');
      expect(candidate.dataQuality).toBe('inconsistent');
      expect(candidate.usableForComparison).toBe(false);
    }
    const lateTickers = new Set(late.map((c) => c.underlying));
    for (const ticker of lateTickers) {
      expect(resumed.tickers.find((t) => t.ticker === ticker)?.message).toMatch(/could not be retrieved/);
    }
    const final = candidateSnapshots(context, started.scanId);
    for (const [occ, snapshot] of afterMore) expect(final.get(occ)).toBe(snapshot);
    expect(mocks.brokerageCalls).toBe(0);
  });

  it('integrity 3: Finder Scan More days later re-observes the stock price; a failed refresh marks rows unverified', async () => {
    let context = await openAt(dbPath);
    const clock: Clock = { now: new Date(TUE) };
    const stock = { fail: null as string | null, price: '100.00', calls: 0 };
    const finderDeps = () => ({
      now: () => clock.now,
      quoteSource: {
        fetchQuotes: (symbols: readonly string[]) =>
          new DemoFinderQuoteSource(stock.price, clock.now.toISOString(), { providerTimestamp: true }).fetchQuotes(symbols),
      },
      underlyingQuote: async () => {
        stock.calls += 1;
        if (stock.fail) throw new Error(stock.fail);
        return { price: stock.price, quoteAt: clock.now.toISOString(), bid: null, ask: null };
      },
    });
    context.finderTestDeps = finderDeps();
    let s = await signIn(context, true);
    const first = await s.post('/api/finder/scans', { underlying: DEMO_UNDERLYING, profileId: PROFILE, evaluationBudget: 4 });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);
    const scanId = first.body.scanId as string;
    await new Promise((r) => setTimeout(r, 30));
    const original = candidateSnapshots(context, scanId);
    expect(original.size).toBeGreaterThan(0);

    clock.now = new Date(FRI);
    stock.price = '101.00';
    stock.calls = 0;
    const more = await s.post(`/api/finder/scans/${scanId}/more`, { count: 4 });
    expect(more.status, JSON.stringify(more.body).slice(0, 300)).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    const afterMore = await s.agent.get(`/api/finder/scans/${scanId}`);
    expect(stock.calls).toBe(1);
    expect(afterMore.body.marketContext.underlyingQuoteAt).toBe(FRI);
    expect(afterMore.body.message).toMatch(/re-observed/);
    const added = (afterMore.body.candidates as FinderCandidate[]).filter((c) => !original.has(c.occSymbol));
    expect(added.length).toBeGreaterThan(0);
    for (const candidate of added) {
      expect(candidate.underlyingPrice).toBe('101.00');
      expect(hasSessionMismatch(candidate)).toBe(false);
    }
    const snapshotsAfterMore = candidateSnapshots(context, scanId);
    for (const [occ, snapshot] of original) expect(snapshotsAfterMore.get(occ)).toBe(snapshot);

    context = await restart(context, dbPath);
    clock.now = new Date(MON);
    stock.fail = 'equity quote timed out';
    context.finderTestDeps = finderDeps();
    s = await signIn(context, false);
    const late = await s.post(`/api/finder/scans/${scanId}/more`, { count: 4 });
    expect(late.status, JSON.stringify(late.body).slice(0, 300)).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    const resumed = await s.agent.get(`/api/finder/scans/${scanId}`);
    expect(resumed.body.message).toMatch(/could not be retrieved \(equity quote timed out\)/);
    const lateRows = (resumed.body.candidates as FinderCandidate[]).filter((c) => !snapshotsAfterMore.has(c.occSymbol));
    expect(lateRows.length).toBeGreaterThan(0);
    for (const candidate of lateRows) {
      expect(hasSessionMismatch(candidate)).toBe(true);
      expect(candidate.outcome).toBe('incomplete');
    }
    const final = candidateSnapshots(context, scanId);
    for (const [occ, snapshot] of snapshotsAfterMore) expect(final.get(occ)).toBe(snapshot);
  });

  it('integrity 4: the claim heartbeat keeps an active scan exclusive after its original lease time passes', async () => {
    const context = await openAt(dbPath);
    const clock: Clock = { now: new Date(TUE) };
    const stock = { calls: [] as string[], fail: null as string | null, factor: 1 };
    let hold: Promise<void> | null = null;
    let releaseHold: () => void = () => undefined;
    installClockedSmartMocks(context, clock, stock, () => hold ?? undefined);
    context.smartScanTestDeps = { ...context.smartScanTestDeps, claimHeartbeatMs: 10 };
    const s = await signIn(context, true);
    const imported = await importHoldings(s, holdingsCsv(40));
    const started = await s.post('/api/finder/smart-scans', { universeId: imported.universeId, profileId: PROFILE, evaluationBudget: 8 });
    expect(started.status).toBe(201);
    const scanId = started.body.scanId as string;

    hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const callsBefore = mocks.quoteCalls;
    const first = s.post(`/api/finder/smart-scans/${scanId}/next-companies`, { count: 12, evaluationBudget: 8 }).then((r) => r);
    for (let i = 0; i < 200 && mocks.quoteCalls === callsBefore; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(mocks.quoteCalls).toBeGreaterThan(callsBefore);

    // The provider call hangs for 40 minutes: far past the 15-minute lease taken at claim time.
    clock.now = new Date(Date.parse(TUE) + 40 * 60_000);
    await new Promise((r) => setTimeout(r, 40));
    const lease = context.database.sqlite
      .prepare('SELECT active_lock_until FROM research_sessions WHERE id = ?')
      .get(scanId) as { active_lock_until: string };
    expect(Date.parse(lease.active_lock_until)).toBeGreaterThan(clock.now.getTime());

    // A second operation with no in-memory state (as from another process) is still rejected.
    resetSmartScans();
    const second = await s.post(`/api/finder/smart-scans/${scanId}/next-companies`, { count: 12, evaluationBudget: 8 });
    expect(second.status).toBe(409);
    expect(sessionRow(context, scanId).company_cursor).toBe(24);

    hold = null;
    releaseHold();
    expect((await first).status).toBe(200);
    await new Promise((r) => setTimeout(r, 40));
    expect(sessionRow(context, scanId).active_batch_id).toBeNull();
    expect(batches(context, scanId).map((b) => b.status)).toEqual(['completed', 'completed']);
  });

  it('integrity 5: a scan whose claim is taken over stops and cannot write afterwards', async () => {
    const context = await openAt(dbPath);
    const clock: Clock = { now: new Date(TUE) };
    const stock = { calls: [] as string[], fail: null as string | null, factor: 1 };
    let release: () => void = () => undefined;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = { ...installClockedSmartMocks(context, clock, stock, () => (mocks.quoteCalls === 2 ? hang : undefined)), claimHeartbeatMs: 10 };
    const started = startSmartScan(deps, { tickers: ['AAPL', 'MSFT', 'CVX'], profileId: PROFILE, evaluationBudget: 24 });
    for (let i = 0; i < 200 && mocks.quoteCalls < 2; i += 1) await new Promise((r) => setTimeout(r, 5));
    const committedBefore = candidateSnapshots(context, started.scanId);
    expect(committedBefore.size).toBe(8);

    // Another owner takes the session (fencing token changes).
    context.database.sqlite
      .prepare(`UPDATE research_sessions SET active_batch_id = 'other-owner', active_lock_until = '2999-01-01T00:00:00.000Z' WHERE id = ?`)
      .run(started.scanId);
    await new Promise((r) => setTimeout(r, 40));
    release();
    const finished = (await waitForSmartScan(started.scanId))!;
    expect(finished.status).toBe('failed');
    expect(finished.persistenceError).toMatch(/no longer holds the session claim|lost its research claim/);
    expect(candidateSnapshots(context, started.scanId)).toEqual(committedBefore);
    expect(mocks.quoteCalls).toBe(2); // stopped: no further provider calls after losing the claim
    expect(sessionRow(context, started.scanId).active_batch_id).toBe('other-owner');
  });

  it('integrity 6: each evaluated contract is committed individually, so a mid-slice failure keeps earlier rows', async () => {
    const context = await openAt(dbPath);
    const clock: Clock = { now: new Date(TUE) };
    const stock = { calls: [] as string[], fail: null as string | null, factor: 1 };
    const deps = installClockedSmartMocks(context, clock, stock);
    context.database.sqlite.exec(`
      CREATE TEMP TRIGGER fail_fourth_candidate BEFORE INSERT ON research_session_candidates
      WHEN (SELECT COUNT(*) FROM research_session_candidates WHERE session_id = NEW.session_id) >= 3
      BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;
    `);
    const started = startSmartScan(deps, { tickers: ['AAPL', 'MSFT', 'CVX'], profileId: PROFILE, evaluationBudget: 8 });
    const finished = (await waitForSmartScan(started.scanId))!;
    expect(finished.status).toBe('failed');
    expect(finished.persistenceError).toMatch(/simulated disk failure/);
    expect(candidateSnapshots(context, started.scanId).size).toBe(3);
    const reconciled = reconcileBatch(context.database.sqlite, started.activeBatchId!)!;
    expect(reconciled.committed).toHaveLength(3);
    expect(reconciled.retryable.length).toBe(reconciled.planned.length - 3);
    expect(mocks.quoteCalls).toBe(1);
  });

  it('stores more than 3,000 holdings without truncating the queue, and the first batch stays 12', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    const s = await signIn(context, true);
    const csv = holdingsCsv(3200, { preamble: true });
    const preview = await s.post('/api/discovery/universes/holdings/preview', { csvText: csv });
    expect(preview.status).toBe(200);
    expect(preview.body.counts.equity).toBe(3200);
    expect(preview.body.truncated).toBe(false);
    expect(preview.body.rows.length).toBeLessThanOrEqual(4000);
    const saved = await importHoldings(s, csv, { fundTicker: 'VTI', name: 'Total U.S. market example' });
    const listed = await s.agent.get('/api/discovery/universes');
    const row = (listed.body.saved as Array<{ id: string; tickers: string[]; sectors: Record<string, string>; weights: Record<string, string> }>).find(
      (item) => item.id === saved.universeId,
    )!;
    expect(row.tickers).toHaveLength(3200);
    expect(row.sectors[row.tickers[0]!]).toBe('Industrials');
    expect(row.weights[row.tickers[0]!]).toBe('0.05');

    const started = await s.post('/api/finder/smart-scans', {
      universeId: saved.universeId,
      profileId: PROFILE,
      evaluationBudget: 4,
    });
    expect(started.status, JSON.stringify(started.body).slice(0, 400)).toBe(201);
    const scan = started.body as SmartScanResult;
    expect(scan.companiesInUniverseQueue).toBe(3200);
    expect(scan.companyCursor).toBe(12);
    expect(scan.canScanNextCompanies).toBe(true);
    expect(new Set(mocks.chainCalls).size).toBe(12);
    const rows = companyRows(context, scan.scanId);
    expect(rows).toHaveLength(3200);
    expect(rows[0]).toMatchObject({ queue_index: 0 });
    expect(rows[11]).toMatchObject({ queue_index: 11 });
    expect(rows[3199]?.status).toBe('pending');

    const next = await s.post(`/api/finder/smart-scans/${scan.scanId}/next-companies`, {
      count: 12,
      evaluationBudget: 4,
    });
    expect(next.status, JSON.stringify(next.body).slice(0, 400)).toBe(200);
    expect(next.body.companiesInUniverseQueue).toBe(3200);
    expect(next.body.companyCursor).toBe(24);
    const afterNext = companyRows(context, scan.scanId);
    expect(afterNext).toHaveLength(3200);
    expect(afterNext[3199]?.status).toBe('pending');
    const restored = await s.agent.get(`/api/research-sessions/${scan.scanId}`);
    expect(restored.status).toBe(200);
    expect(restored.body.summary.universeVersionId).toBe(saved.versionId);
    expect(restored.body.orderedTickerQueue).toHaveLength(3200);
  });

  it('reorders only the first batch and keeps an older session pinned to its original collection version', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    const s = await signIn(context, true);
    const weighted = `Ticker,Name,Weight (%)
C,Heavy Co,50
A,Mid Co,10
B,Light Co,1
D,Other Co,2
`;
    const first = await importHoldings(s, weighted, { name: 'S&P 500 exposure example', fundTicker: 'IVV' });
    const started = await s.post('/api/finder/smart-scans', {
      universeId: first.universeId,
      universeVersionId: first.versionId,
      profileId: PROFILE,
      evaluationBudget: 2,
      tickers: ['C', 'A'],
    });
    expect(started.status, JSON.stringify(started.body).slice(0, 400)).toBe(201);
    expect(companyRows(context, started.body.scanId).map((row) => row.ticker)).toEqual(['C', 'A', 'B', 'D']);

    const other = await importHoldings(s, holdingsCsv(8), { name: 'Nasdaq-100 example', fundTicker: 'QQQ' });
    const second = await s.post('/api/finder/smart-scans', {
      universeId: other.universeId,
      profileId: PROFILE,
      evaluationBudget: 2,
    });
    expect(second.status).toBe(201);
    expect(second.body.scanId).not.toBe(started.body.scanId);

    const revised = `Ticker,Name,Weight (%)
C,Heavy Co,40
E,Added Co,9
`;
    const nextVersion = await importHoldings(s, revised, {
      name: 'S&P 500 exposure example',
      fundTicker: 'IVV',
      universeId: first.universeId,
    });
    expect(nextVersion.version).toBe(2);
    expect(nextVersion.versionId).not.toBe(first.versionId);

    const still = await s.agent.get(`/api/research-sessions/${started.body.scanId}`);
    expect(still.body.summary.universeVersionId).toBe(first.versionId);
    expect(still.body.orderedTickerQueue).toEqual(['C', 'A', 'B', 'D']);
    const replacement = await s.agent.get(`/api/research-sessions/${second.body.scanId}`);
    expect(replacement.body.summary.universeVersionId).toBe(other.versionId);
    expect(replacement.body.orderedTickerQueue).toHaveLength(8);
  });

  it('returns a new running session immediately when wait=false and keeps the older session', async () => {
    const context = await openAt(dbPath);
    installMocks(context, mocks);
    const s = await signIn(context, true);
    const first = await s.post('/api/finder/smart-scans', {
      tickers: ['AAPL'],
      profileId: PROFILE,
      evaluationBudget: 4,
    });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('completed');

    const started = await s.post('/api/finder/smart-scans?wait=false', {
      tickers: ['MSFT'],
      profileId: PROFILE,
      evaluationBudget: 4,
    });
    expect(started.status).toBe(201);
    expect(started.body.scanId).not.toBe(first.body.scanId);
    expect(started.body.status).toBe('running');
    expect(started.body.progress.companiesWithEvaluatedContracts).toBe(0);
    expect(mocks.brokerageCalls).toBe(0);

    const finished = await waitForSmartScan(started.body.scanId);
    expect(finished?.status).toBe('completed');
    const older = await s.agent.get(`/api/research-sessions/${first.body.scanId}`);
    expect(older.status).toBe(200);
    expect(older.body.summary.id).toBe(first.body.scanId);
  });
});

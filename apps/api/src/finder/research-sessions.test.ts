import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_SAVED_PROFILE,
  SHOW_PROFILE_MISSES,
  SMART_SCAN_SESSION_NOTICE,
  buildWmtJan2029AcceptanceCandidate,
  type SmartScanResult,
} from '@optionscout/shared';
import { openDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import {
  ResearchClaimError,
  claimResearchBatch,
  commitResearchProgress,
  createDiscoverSession,
  deleteResearchSession,
  discoverSessionColumns,
  listResearchSessions,
  loadDiscoverRestore,
  markInterruptedRunningSessions,
  reconcileBatch,
} from './research-sessions.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-research-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const opened = openDatabase(dbPath);
  applyMigrations(opened.sqlite, migrationsDirectory());
  return { opened, dir };
}

function sampleResult(overrides: Partial<SmartScanResult> = {}): SmartScanResult {
  return {
    scanId: 'smart_test_persist_1',
    status: 'running',
    mode: 'simulated-fixture',
    profileId: ACCEPTANCE_SAVED_PROFILE.id,
    profileName: ACCEPTANCE_SAVED_PROFILE.name,
    profileRevision: ACCEPTANCE_SAVED_PROFILE.revision,
    scanPriority: 'closest-to-strategy',
    universeId: 'u1',
    universeVersionId: 'u1@v1',
    universeLabel: 'Test universe',
    startedAt: '2026-10-17T20:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-10-17T20:00:02.000Z',
    sessionPersistence: 'sqlite',
    sessionNotice: SMART_SCAN_SESSION_NOTICE,
    message: 'batch running',
    simulated: true,
    simulatedNotice: 'SIMULATED',
    dataSource: 'SIMULATED',
    progress: {
      companiesSelected: 3,
      companiesChainRetrieved: 1,
      companiesWithEvaluatedContracts: 1,
      companiesNotYetScanned: 2,
      companiesUnsupportedOrEmpty: 0,
      companiesRateLimitedOrError: 0,
      eligibleContractsDiscovered: 10,
      contractsFullyEvaluated: 1,
      contractsPartiallyEvaluated: 0,
      contractsNotYetEvaluated: 9,
      missingQuotesOrGreeks: 0,
      evaluationBudget: 24,
      evaluationBudgetUsed: 1,
      batchSize: 8,
      canScanMore: true,
      cancelled: false,
      plainSummary: 'checked',
      coverageNote: 'note',
    },
    tickers: ['WMT', 'CVX', 'QCOM'].map((ticker) => ({
      ticker,
      companyName: null,
      status: 'pending' as const,
      message: 'not yet',
      underlyingPrice: null,
      underlyingQuoteAt: null,
      eligibleContracts: 0,
      evaluatedContracts: 0,
      incompleteContracts: 0,
      exactMatches: 0,
      nearMatches: 0,
    })),
    insights: [],
    candidates: [],
    tolerances: SHOW_PROFILE_MISSES,
    error: null,
    ...overrides,
  };
}

const NOW = new Date('2026-10-17T20:00:00.000Z');

function seedSession(sqlite: ReturnType<typeof openDatabase>['sqlite'], id = 'smart_test_persist_1') {
  const result = sampleResult({ scanId: id });
  createDiscoverSession(sqlite, {
    result,
    strategySnapshot: ACCEPTANCE_SAVED_PROFILE,
    orderedTickerQueue: ['WMT', 'CVX', 'QCOM'],
    companies: result.tickers,
  });
  return result;
}

describe('research session persistence', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  function setup() {
    const { opened, dir } = tempDb();
    cleanup = () => {
      opened.close();
      fs.rmSync(dir, { recursive: true, force: true });
    };
    return opened;
  }

  it('commits incrementally under a claim and restores without brokerage', () => {
    const opened = setup();
    const result = seedSession(opened.sqlite);
    const claim = claimResearchBatch(opened.sqlite, {
      sessionId: result.scanId,
      batchKind: 'companies',
      tickers: ['WMT', 'CVX'],
      evaluationBudget: 24,
      cursor: { expected: 0, next: 2 },
      now: NOW,
    });
    expect(claim.batchId).toBe(`${result.scanId}:b1`);
    const candidate = buildWmtJan2029AcceptanceCandidate();
    const cols = discoverSessionColumns(result, 3, 2);
    commitResearchProgress(opened.sqlite, {
      sessionId: result.scanId,
      batchId: claim.batchId,
      status: 'running',
      progressJson: cols.progressJson,
      metaJson: cols.metaJson,
      finishedAt: null,
      companies: [
        {
          ticker: 'WMT',
          queueIndex: 0,
          progress: { ...result.tickers[0]!, status: 'evaluated', evaluatedContracts: 1 },
          remainingOcc: ['WMT_REMAINING_1'],
        },
      ],
      candidates: [candidate],
      evaluatedOcc: [candidate.occSymbol],
      plannedOcc: [candidate.occSymbol, 'WMT_REMAINING_1'],
      evaluationCount: 1,
      now: NOW,
    });
    commitResearchProgress(opened.sqlite, {
      sessionId: result.scanId,
      batchId: claim.batchId,
      status: 'completed',
      progressJson: cols.progressJson,
      metaJson: cols.metaJson,
      finishedAt: NOW.toISOString(),
      evaluationCount: 1,
      now: NOW,
      finish: { batchStatus: 'completed', error: null },
    });

    const listed = listResearchSessions(opened.sqlite, 'discover');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.companiesInUniverse).toBe(3);
    expect(listed[0]!.companiesRemaining).toBe(1);
    expect(listed[0]!.canScanNextCompanies).toBe(true);
    expect(listed[0]!.activeBatchId).toBeNull();

    const restored = loadDiscoverRestore(opened.sqlite, result.scanId)!;
    expect(restored.result.candidates).toHaveLength(1);
    expect(restored.result.universeVersionId).toBe('u1@v1');
    expect(restored.strategySnapshot.revision).toBe(ACCEPTANCE_SAVED_PROFILE.revision);
    expect(restored.orderedTickerQueue).toEqual(['WMT', 'CVX', 'QCOM']);
    expect(restored.evaluatedOcc).toContain(candidate.occSymbol);
    expect(restored.result.tickers.find((t) => t.ticker === 'CVX')?.attemptCount).toBe(1);
    expect(restored.result.tickers.find((t) => t.ticker === 'QCOM')?.attemptCount).toBe(0);
    expect(reconcileBatch(opened.sqlite, claim.batchId)).toMatchObject({
      status: 'completed',
      committed: [candidate.occSymbol],
      retryable: ['WMT_REMAINING_1'],
    });
  });

  it('rejects a second claim and a stale cursor', () => {
    const opened = setup();
    const result = seedSession(opened.sqlite);
    claimResearchBatch(opened.sqlite, {
      sessionId: result.scanId,
      batchKind: 'companies',
      tickers: ['WMT'],
      evaluationBudget: 8,
      cursor: { expected: 0, next: 1 },
      now: NOW,
    });
    expect(() =>
      claimResearchBatch(opened.sqlite, {
        sessionId: result.scanId,
        batchKind: 'companies',
        tickers: ['WMT'],
        evaluationBudget: 8,
        cursor: { expected: 0, next: 1 },
        now: NOW,
      }),
    ).toThrow(ResearchClaimError);
    // After the lease expires a new claim is allowed, but not with a stale cursor expectation.
    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(() =>
      claimResearchBatch(opened.sqlite, {
        sessionId: result.scanId,
        batchKind: 'companies',
        tickers: ['WMT'],
        evaluationBudget: 8,
        cursor: { expected: 0, next: 1 },
        now: later,
      }),
    ).toThrow(/moved on/);
    const row = opened.sqlite.prepare('SELECT company_cursor FROM research_sessions WHERE id = ?').get(result.scanId) as {
      company_cursor: number;
    };
    expect(row.company_cursor).toBe(1);
  });

  it('marks claimed work interrupted on boot and keeps unattempted companies retryable', () => {
    const opened = setup();
    const result = seedSession(opened.sqlite);
    const claim = claimResearchBatch(opened.sqlite, {
      sessionId: result.scanId,
      batchKind: 'companies',
      tickers: ['WMT', 'CVX'],
      evaluationBudget: 8,
      cursor: { expected: 0, next: 2 },
      now: NOW,
    });
    const cols = discoverSessionColumns(result, 3, 2);
    commitResearchProgress(opened.sqlite, {
      sessionId: result.scanId,
      batchId: claim.batchId,
      status: 'running',
      progressJson: cols.progressJson,
      metaJson: cols.metaJson,
      finishedAt: null,
      companies: [{ ticker: 'WMT', queueIndex: 0, progress: { ...result.tickers[0]!, status: 'chain-loaded' }, remainingOcc: ['A', 'B'] }],
      evaluatedOcc: ['A'],
      plannedOcc: ['A', 'B'],
      evaluationCount: 1,
      now: NOW,
    });
    expect(markInterruptedRunningSessions(opened.sqlite)).toBe(1);
    const restored = loadDiscoverRestore(opened.sqlite, result.scanId)!;
    expect(restored.result.status).toBe('interrupted');
    expect(restored.result.activeBatchId).toBeNull();
    expect(restored.result.message).toMatch(/1 of 2 planned contracts were saved/);
    expect(restored.result.tickers.find((t) => t.ticker === 'CVX')?.status).toBe('interrupted');
    expect(restored.result.tickers.find((t) => t.ticker === 'WMT')?.status).toBe('chain-loaded');
    expect(restored.summary.companiesRetryable).toBe(1);
    expect(reconcileBatch(opened.sqlite, claim.batchId)).toMatchObject({ status: 'interrupted', retryable: ['B'] });
    // A late write from the dead batch must not be accepted.
    expect(() =>
      commitResearchProgress(opened.sqlite, {
        sessionId: result.scanId,
        batchId: claim.batchId,
        status: 'running',
        progressJson: cols.progressJson,
        metaJson: cols.metaJson,
        finishedAt: null,
        evaluatedOcc: ['B'],
        evaluationCount: 2,
        now: NOW,
      }),
    ).toThrow(/no longer holds/);
  });

  it('deletes only the requested session and refuses while a claim is live', () => {
    const opened = setup();
    seedSession(opened.sqlite, 'smart_a');
    seedSession(opened.sqlite, 'smart_b');
    claimResearchBatch(opened.sqlite, {
      sessionId: 'smart_b',
      batchKind: 'contracts',
      tickers: [],
      evaluationBudget: 8,
      now: NOW,
    });
    expect(() => deleteResearchSession(opened.sqlite, 'smart_b', NOW)).toThrow(/in progress/);
    expect(deleteResearchSession(opened.sqlite, 'smart_a', NOW)).toBe(true);
    expect(loadDiscoverRestore(opened.sqlite, 'smart_a')).toBeNull();
    expect(loadDiscoverRestore(opened.sqlite, 'smart_b')).not.toBeNull();
    const companies = opened.sqlite
      .prepare('SELECT COUNT(*) AS n FROM research_session_companies WHERE session_id = ?')
      .get('smart_b') as { n: number };
    expect(companies.n).toBe(3);
  });
});

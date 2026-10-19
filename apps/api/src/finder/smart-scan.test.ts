import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAL_PMCC_DEEP_ITM, beginnerDiscoveryGroupForCandidate } from '@optionscout/shared';
import { openDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { ensureStrategyProfilesSeeded, readStrategyProfile } from '../strategy/profiles.js';
import { SMART_MOCK_SPECIAL, SmartMockQuoteSource, smartMockNestedChainPayload } from './smart-mock.js';
import {
  cancelSmartScan,
  interleaveTickerQueues,
  resetSmartScans,
  runSmartScanForTest,
  runSmartScanMoreForTest,
  scanNextCompanies,
  startSmartScan,
  waitForSmartScan,
  type SmartScanDeps,
} from './smart-scan.js';
import { createUniverse, createUniverseFromCsv, listAllUniverses } from './universes.js';
import type { NestedChainContract } from './chain.js';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-smart-'));
  const databasePath = path.join(dir, 'test.sqlite');
  const opened = openDatabase(databasePath);
  applyMigrations(opened.sqlite, migrationsDirectory());
  ensureStrategyProfilesSeeded(opened.db);
  return { dir, opened };
}

function deps(db: ReturnType<typeof openDatabase>['db']): SmartScanDeps {
  return {
    smartScanLiveEnabled: false,
    liveScanEnabled: false,
    portfolioView: 'demo',
    smartScanMode: 'normal',
    readProfile: (profileId) => readStrategyProfile(db, profileId),
  };
}

function fakeContract(ticker: string, id: string): NestedChainContract {
  return {
    underlying: ticker,
    rootSymbol: ticker,
    occSymbol: `${ticker}   280121C00040000${id}`,
    streamerSymbol: `.${ticker}280121C40${id}`,
    optionType: 'call',
    strike: '40.00',
    expiration: '2028-01-21',
    daysToExpiration: 463,
    multiplier: 100,
    chainType: 'Standard',
    settlementType: 'PM',
    expirationType: 'Regular',
    deliverables: [],
    standardContract: true,
    supportStatus: 'supported',
    supportNote: 'ok',
    active: true,
    closingOnly: false,
  };
}

describe('smart scan interleave', () => {
  it('round-robins companies instead of draining one ticker first', () => {
    const map = new Map<string, NestedChainContract[]>([
      ['AAA', [fakeContract('AAA', 'a'), fakeContract('AAA', 'b'), fakeContract('AAA', 'c')]],
      ['BBB', [fakeContract('BBB', 'a'), fakeContract('BBB', 'b')]],
      ['CCC', [fakeContract('CCC', 'a')]],
    ]);
    const interleaved = interleaveTickerQueues(map);
    expect(interleaved.slice(0, 3).map((row) => row.ticker)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(interleaved.map((row) => row.ticker).filter((t) => t === 'AAA').length).toBe(3);
  });
});

describe('smart scan orchestrator', () => {
  let dir: string;
  let opened: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    resetSmartScans();
    const temp = tempDb();
    dir = temp.dir;
    opened = temp.opened;
  });

  afterEach(() => {
    resetSmartScans();
    opened.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('covers 20 selected companies as 12 then 8', async () => {
    const tickers = 'ABCDEFGHIJKLMNOPQRST'.split('').map((letter) => `Z${letter}`);
    const universe = {
      universeId: 'selected',
      universeVersionId: 'selected@v1',
      label: 'Selected companies',
      tickers,
      companyNames: {},
    };
    const first = await runSmartScanForTest(
      deps(opened.db),
      {
        tickers: tickers.slice(0, 12),
        profileId: SAL_PMCC_DEEP_ITM.id,
        universeId: 'selected',
        evaluationBudget: 24,
        scanPriority: 'closest-to-strategy',
      },
      universe,
    );
    expect(first.companiesInUniverseQueue).toBe(20);
    expect(first.companyCursor).toBe(12);
    const started = scanNextCompanies(first.scanId, { count: 8, evaluationBudget: 24 }, deps(opened.db));
    const second = (await waitForSmartScan(started.scanId))!;
    expect(second.companyCursor).toBe(20);
    expect(new Set(second.tickers.map((row) => row.ticker)).size).toBe(20);
  });

  it('places labeled practice tickers in each beginner result group', async () => {
    const result = await runSmartScanForTest(deps(opened.db), {
      tickers: [
        SMART_MOCK_SPECIAL.BEST,
        SMART_MOCK_SPECIAL.NEAR,
        SMART_MOCK_SPECIAL.NOGREEKS,
        SMART_MOCK_SPECIAL.OUTSIDE,
        SMART_MOCK_SPECIAL.INCONSISTENT,
      ],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 24,
      scanPriority: 'closest-to-strategy',
      universeLabel: 'DEMO classification cases',
    });
    const group = (ticker: string) => {
      const row = result.candidates.find((candidate) => candidate.underlying === ticker);
      expect(row, ticker).toBeTruthy();
      return beginnerDiscoveryGroupForCandidate(row!, SAL_PMCC_DEEP_ITM);
    };
    expect(group('ZZBEST')).toBe('best-matches');
    expect(group('ZZNEAR')).toBe('near-matches');
    expect(group('ZZGRK')).toBe('need-more-data');
    expect(group('ZZOUT')).toBe('outside-plan');
    expect(group('ZZINV')).toBe('invalid-quotes');
  });

  it('keeps missing Greeks and crossed quotes labeled as simulated fixtures', async () => {
    const result = await runSmartScanForTest(deps(opened.db), {
      tickers: [SMART_MOCK_SPECIAL.NOGREEKS, SMART_MOCK_SPECIAL.INCONSISTENT, 'F'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 24,
      scanPriority: 'closest-to-strategy',
      universeLabel: 'DEMO labeled cases',
    });
    expect(result.simulated).toBe(true);
    expect(result.candidates.some((row) => row.underlying === 'ZZGRK' && row.delta == null)).toBe(true);
    expect(
      result.candidates.some(
        (row) =>
          row.underlying === 'ZZINV' &&
          (row.validationIssues ?? []).some((issue) => issue.code === 'crossed_option_market'),
      ),
    ).toBe(true);
    expect(result.candidates.some((row) => row.outcome === 'outside-profile' || row.outcome === 'exact' || row.outcome === 'near')).toBe(
      true,
    );
  });

  it('evaluates diversified contracts across multiple companies with simulated fixtures', async () => {
    const result = await runSmartScanForTest(deps(opened.db), {
      tickers: ['AAPL', 'MSFT', 'CVX', SMART_MOCK_SPECIAL.EMPTY, SMART_MOCK_SPECIAL.UNSUPPORTED],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 12,
      scanPriority: 'closest-to-strategy',
      universeLabel: 'Test explore group',
      companyNames: { AAPL: 'Apple', MSFT: 'Microsoft', CVX: 'Chevron' },
    });
    expect(result.mode).toBe('simulated-fixture');
    expect(result.simulated).toBe(true);
    expect(result.sessionPersistence).toBe('in-memory');
    expect(result.progress.companiesSelected).toBe(5);
    expect(result.progress.companiesUnsupportedOrEmpty).toBeGreaterThanOrEqual(2);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(12);
    const underlyings = new Set(result.candidates.map((row) => row.underlying));
    expect(underlyings.has('AAPL')).toBe(true);
    expect(underlyings.size).toBeGreaterThan(1);
    expect(result.progress.plainSummary).toMatch(/does not mean the entire market/i);
    expect(result.candidates.every((row) => row.calculations.estimatedPurchaseCost == null || row.ask != null || row.outcome === 'incomplete')).toBe(
      true,
    );
  });

  it('marks missing greeks as incomplete and supports Scan More without duplicates', async () => {
    const first = await runSmartScanForTest(deps(opened.db), {
      tickers: [SMART_MOCK_SPECIAL.NOGREEKS, 'QCOM', 'WMT'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 6,
    });
    const incomplete = first.candidates.filter((row) => row.underlying === SMART_MOCK_SPECIAL.NOGREEKS);
    expect(incomplete.some((row) => row.outcome === 'incomplete' || row.flags.missingGreeks)).toBe(true);

    const before = new Set(first.candidates.map((row) => row.occSymbol));
    const more = await runSmartScanMoreForTest(first.scanId, { count: 6, mode: 'diversified' });
    expect(more.candidates.length).toBeGreaterThanOrEqual(first.candidates.length);
    const after = more.candidates.map((row) => row.occSymbol);
    expect(new Set(after).size).toBe(after.length);
    for (const occ of before) expect(after).toContain(occ);
  });

  it('cancels an in-flight session safely', async () => {
    const started = startSmartScan(deps(opened.db), {
      tickers: ['AAPL', 'MSFT', 'NVDA', 'AMD', 'AVGO', 'QCOM'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 24,
    });
    cancelSmartScan(started.scanId);
    const finished = await waitForSmartScan(started.scanId);
    expect(finished?.status === 'cancelled' || finished?.status === 'completed').toBe(true);
  });

  it('persists custom and csv universes without touching brokerage tables', () => {
    const custom = createUniverse(opened.db, { name: 'My list', tickers: ['cvx', 'CVX', 'wmt', '123'] });
    expect(custom.tickers).toEqual(['CVX', 'WMT']);
    const csv = createUniverseFromCsv(opened.db, 'From CSV', 'ticker\nQCOM\nAAPL\n');
    expect(csv.tickers).toEqual(['QCOM', 'AAPL']);
    const all = listAllUniverses(opened.db);
    expect(all.curated.length).toBeGreaterThan(0);
    expect(all.saved.map((row) => row.id)).toEqual(expect.arrayContaining([custom.id, csv.id]));
    expect(all.curated[0]!.sourceLabel).toMatch(/not an official/i);
  });
});

describe('smart scan live diagnostic caps', () => {
  let dir: string;
  let opened: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    resetSmartScans();
    const temp = tempDb();
    dir = temp.dir;
    opened = temp.opened;
  });

  afterEach(() => {
    resetSmartScans();
    opened.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function liveDeps(mode: 'diagnostic' | 'normal' = 'diagnostic'): SmartScanDeps {
    return {
      smartScanLiveEnabled: true,
      liveScanEnabled: true,
      portfolioView: 'brokerage',
      smartScanMode: mode,
      readProfile: (profileId) => readStrategyProfile(opened.db, profileId),
      // Fixture overrides only — never hit live brokerage in these tests.
      chainPayloadForTicker: (ticker) => smartMockNestedChainPayload(ticker),
      quoteSource: new SmartMockQuoteSource('2026-10-15T14:00:00.000Z'),
      now: () => new Date('2026-10-15T14:00:00.000Z'),
    };
  }

  it('rejects non-allowlist tickers and budgets above 24 in live diagnostic mode', () => {
    expect(() =>
      startSmartScan(liveDeps('diagnostic'), {
        tickers: ['AAPL'],
        profileId: SAL_PMCC_DEEP_ITM.id,
        evaluationBudget: 12,
      }),
    ).toThrow(/restricted to CVX, QCOM, WMT/i);

    expect(() =>
      startSmartScan(liveDeps('diagnostic'), {
        tickers: ['CVX', 'QCOM', 'WMT'],
        profileId: SAL_PMCC_DEEP_ITM.id,
        evaluationBudget: 25,
      }),
    ).toThrow(/cannot exceed 24/i);
  });

  it('allows CVX, QCOM, WMT with budget 24 in live-gated diagnostic mode without live brokerage calls', async () => {
    const result = await runSmartScanForTest(liveDeps('diagnostic'), {
      tickers: ['CVX', 'QCOM', 'WMT'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 24,
    });
    expect(result.mode).toBe('live-gated');
    expect(result.simulated).toBe(false);
    expect(result.status).toBe('completed');
    expect(result.progress.evaluationBudget).toBe(24);
    expect(result.progress.companiesSelected).toBe(3);
  });

  it('allows AAPL in normal live mode without allowlist (fixture chainPayload)', async () => {
    const result = await runSmartScanForTest(liveDeps('normal'), {
      tickers: ['AAPL', 'MSFT'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 24,
    });
    expect(result.mode).toBe('live-gated');
    expect(result.simulated).toBe(false);
    expect(result.status).toBe('completed');
    expect(result.progress.evaluationBudget).toBe(24);
    expect(result.progress.companiesSelected).toBe(2);
  });

  it('clamps initial normal live budget to 24 and allows Scan More without a 24-total session cap', async () => {
    const first = await runSmartScanForTest(liveDeps('normal'), {
      tickers: ['AAPL', 'MSFT', 'QCOM'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 48,
    });
    expect(first.progress.evaluationBudget).toBe(24);
    const more = await runSmartScanMoreForTest(first.scanId, { count: 24, mode: 'diversified' });
    expect(more.status).toBe('completed');
    expect(more.error).toBeNull();
    // Diagnostic live would throw once 24 session evals are used; normal must accept the request.
    expect(more.message).not.toMatch(/no further evaluations allowed/i);
  });

  it('still allows other tickers in simulated mode', async () => {
    const result = await runSmartScanForTest(deps(opened.db), {
      tickers: ['AAPL', 'MSFT'],
      profileId: SAL_PMCC_DEEP_ITM.id,
      evaluationBudget: 8,
    });
    expect(result.mode).toBe('simulated-fixture');
    expect(result.simulated).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.progress.companiesSelected).toBe(2);
  });
});

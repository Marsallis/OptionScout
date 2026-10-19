import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAL_PMCC_DEEP_ITM } from '@optionscout/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { setupOwnerPassphrase } from '../auth/owner.js';
import { assertReadOnlyPath } from '../brokerage/client.js';
import { parseConfig } from '../config.js';
import { openAppContext, type AppContext } from '../context.js';
import { deleteFinderBookmark, listFinderBookmarks, saveFinderBookmark } from './bookmarks.js';
import { nestedChainPath, parseNestedOptionChain } from './chain.js';
import { demoNestedChainPayload, DemoFinderQuoteSource } from './demo-chain.js';
import { equityPath, parseEquityInstrument } from './equities.js';
import { assessScreeningFreshness } from './freshness.js';
import { resetFinderScans, runFinderScanForTest, runFinderScanMoreForTest, startFinderScan, cancelFinderScan, waitForFinderScan } from './scan.js';
import type { FinderQuoteSource } from './quotes.js';
import { buildBudgetAwareQueue, selectCallableContracts } from './selection.js';

const contexts: AppContext[] = [];
const directories: string[] = [];
const passphrase = 'correct horse battery staple';

afterEach(() => {
  resetFinderScans();
  for (const context of contexts.splice(0)) context.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  resetFinderScans();
});

async function opened(): Promise<AppContext> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'optionscout-finder-'));
  directories.push(directory);
  const context = await openAppContext(
    parseConfig(
      {
        NODE_ENV: 'test',
        PORT: '3180',
        BIND_HOST: '127.0.0.1',
        DATABASE_PATH: path.join(directory, 'optionscout.sqlite'),
        DATA_MODE: 'demo',
        AUTH_MODE: 'local-owner',
        ENABLE_ORDER_EXECUTION: 'false',
        TELEMETRY_ENABLED: 'false',
        RUNNING_IN_DOCKER: 'false',
        STATIC_DIR: '',
        FINDER_LIVE_SCAN: 'false',
      },
      { secretFilePath: path.join(directory, 'missing.env') },
    ),
  );
  contexts.push(context);
  return context;
}

describe('finder chain parsing', () => {
  it('allowlists nested chains and equity instruments only', () => {
    expect(() => assertReadOnlyPath('GET', nestedChainPath('qcom'))).not.toThrow();
    expect(() => assertReadOnlyPath('GET', equityPath('AMZN'))).not.toThrow();
    expect(() => assertReadOnlyPath('GET', '/option-chains/QCOM')).toThrow(/not available/);
  });

  it('parses standard calls, puts, adjusted contracts, missing streamers, and duplicates', () => {
    const parsed = parseNestedOptionChain(demoNestedChainPayload('DEMO'), 'DEMO');
    expect(parsed.discovered).toBeGreaterThan(5);
    expect(parsed.putsDiscovered).toBeGreaterThan(0);
    expect(parsed.unsupportedAdjusted).toBe(1);
    expect(parsed.missingStreamer).toBe(1);
    expect(parsed.contracts.some((row) => row.supportStatus === 'unsupported-adjusted')).toBe(true);
    expect(parsed.contracts.some((row) => row.supportStatus === 'missing-streamer')).toBe(true);
    expect(parsed.contracts.every((row) => row.active === null && row.closingOnly === null)).toBe(true);
    const selected = selectCallableContracts(parsed.contracts, 6, 365, '100.00');
    expect(selected).toHaveLength(6);
    const selectedExpirations = new Set(selected.map((row) => row.expiration));
    expect(selectedExpirations.size).toBeGreaterThan(1);
    expect(selected.some((row) => ['40.00', '45.00', '35.00', '50.00'].includes(row.strike))).toBe(true);
    const duplicatePayload = {
      data: {
        items: [
          {
            'underlying-symbol': 'DUP',
            'root-symbol': 'DUP',
            'option-chain-type': 'Standard',
            'shares-per-contract': 100,
            deliverables: [],
            expirations: [
              {
                'expiration-date': '2028-01-21',
                'days-to-expiration': 400,
                strikes: [
                  {
                    'strike-price': 100,
                    call: 'DUP   280121C00100000',
                    'call-streamer-symbol': '.DUP280121C100',
                  },
                  {
                    'strike-price': 100,
                    call: 'DUP   280121C00100000',
                    'call-streamer-symbol': '.DUP280121C100',
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(parseNestedOptionChain(duplicatePayload, 'DUP').discovered).toBe(1);
  });

  it('handles empty chains and requires official equity streamer symbols', () => {
    expect(parseNestedOptionChain(demoNestedChainPayload('EMPTY'), 'EMPTY').discovered).toBe(0);
    expect(() => parseEquityInstrument('AMZN', { data: { symbol: 'AMZN', 'streamer-symbol': '' } })).toThrow(/streamer/);
    expect(parseEquityInstrument('AMZN', { data: { symbol: 'AMZN', 'streamer-symbol': 'AMZN' } }).streamerSymbol).toBe('AMZN');
  });
});

describe('finder screening freshness', () => {
  it('does not treat a local receipt as provider-confirmed fresh', () => {
    const now = new Date('2026-10-15T14:00:00.000Z');
    const missing = assessScreeningFreshness({
      providerEventAt: null,
      greekEventAt: null,
      receivedAt: now.toISOString(),
      now,
      screeningFreshnessSeconds: 60,
    });
    expect(missing.missingProviderTimestamp).toBe(true);
    expect(missing.actionable).toBe(false);

    const mismatch = assessScreeningFreshness({
      providerEventAt: '2026-10-15T13:59:50.000Z',
      greekEventAt: '2026-10-15T13:50:00.000Z',
      receivedAt: now.toISOString(),
      now,
      screeningFreshnessSeconds: 60,
    });
    expect(mismatch.quoteGreekMismatch).toBe(true);
    expect(mismatch.actionable).toBe(false);
  });
});

describe('finder scan service', () => {
  it('classifies deltas across hard, near, and outside-profile bands with unconfigured liquidity', async () => {
    const result = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 8 },
    );
    expect(result.status).toBe('completed');
    expect(result.mode).toBe('demo-fixture');
    expect(result.marketContext.simulated).toBe(true);
    expect(result.marketContext.simulatedNotice).toMatch(/SIMULATED DATA/i);
    expect(result.marketContext.underlyingPrice).toBe('100.00');
    expect(result.underlying).toBe('DEMO');
    expect(result.progress.coverageSummary).toMatch(/eligible LEAPS/i);
    expect(result.progress.notYetEvaluated).toBeGreaterThan(0);
    expect(result.progress.fullyEvaluated + result.progress.partiallyEvaluated).toBeGreaterThan(0);
    expect(result.progress.remaining).toBeGreaterThan(0);
    expect(result.progress.canScanMore).toBe(true);
    expect(result.progress.partial).toBe(true);
    // Continue until enough contracts are evaluated for classification coverage.
    let classified = result;
    let guard = 0;
    while (classified.progress.canScanMore && guard < 10) {
      classified = await runFinderScanMoreForTest(classified.scanId, 8);
      guard += 1;
    }
    const supported = classified.candidates.filter((row) => row.supportStatus === 'supported');
    expect(supported.some((row) => row.strike === '40.00' && Number(row.calculations.estimatedPurchaseCost) <= 7000)).toBe(true);
    expect(supported.some((row) => row.delta === '0.78' && (row.outcome === 'near' || row.outcome === 'exact'))).toBe(true);
    expect(supported.some((row) => row.delta === '0.82')).toBe(true);
    expect(supported.some((row) => row.outcome === 'outside-profile')).toBe(true);
    expect(supported.some((row) => row.meetsConfiguredNumericRequirements && row.liquidityUnassessed)).toBe(true);
    expect(supported.some((row) => row.expiration === '2026-12-18')).toBe(false);
    expect(classified.candidates.every((row) => row.visible)).toBe(true);
    expect(classified.candidates.some((row) => row.reasons.some((reason) => reason.kind === 'unconfigured'))).toBe(true);
    expect(classified.candidates.some((row) => row.supportStatus === 'unsupported-adjusted')).toBe(true);
    expect(classified.candidates.some((row) => row.supportStatus === 'missing-streamer')).toBe(true);
    // Intrinsic/cost stay coherent with DEMO spot 100.
    const deep = supported.find((row) => row.strike === '40.00' && row.ask != null);
    expect(deep?.underlyingPrice).toBe('100.00');
    expect(deep?.calculations.intrinsicValue).toBe('60.00');
    expect(Number(deep?.calculations.estimatedPurchaseCost)).toBe(Number(deep?.ask) * 100);
  });

  it('refuses to relabel the demo fixture as a real issuer ticker', async () => {
    const result = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'AAPL', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 8 },
    );
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/fictional ticker DEMO/i);
    expect(result.candidates).toHaveLength(0);
  });

  it('progressively evaluates remaining eligible contracts with Scan More', async () => {
    const first = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 5 },
    );
    expect(first.progress.evaluated).toBe(5);
    expect(first.progress.remaining).toBeGreaterThan(0);
    const second = await runFinderScanMoreForTest(first.scanId, 5);
    expect(second.progress.evaluated).toBe(10);
    const ids = second.candidates.filter((row) => row.supportStatus === 'supported').map((row) => row.occSymbol);
    expect(new Set(ids).size).toBe(ids.length);
    let current = second;
    let guard = 0;
    while (current.progress.canScanMore && guard < 20) {
      current = await runFinderScanMoreForTest(current.scanId, 8);
      guard += 1;
    }
    expect(current.progress.exhausted).toBe(true);
    expect(current.progress.remaining).toBe(0);
    expect(current.progress.evaluated).toBe(current.progress.eligibleLeaps);
  });

  it('honors evaluation budgets, batch size, cancellation, and crossed markets', async () => {
    const context = await opened();
    const slow: FinderQuoteSource = {
      async fetchQuotes(streamerSymbols) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const demo = new DemoFinderQuoteSource('100.00', '2026-10-15T14:00:00.000Z');
        return demo.fetchQuotes(streamerSymbols);
      },
    };
    const started = startFinderScan(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        quoteSource: slow,
        delayBetweenBatchesMs: 30,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 16 },
    );
    cancelFinderScan(started.scanId);
    const cancelled = await waitForFinderScan(started.scanId);
    expect(cancelled?.status).toMatch(/cancelled|completed/);
    if (cancelled?.status === 'cancelled') {
      expect(cancelled.progress.cancelled).toBe(true);
      expect(cancelled.message).toMatch(/not processed|cancellation/i);
    }

    const budgeted = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 2 },
    );
    expect(budgeted.progress.selectedForEvaluation).toBe(2);
    expect(budgeted.progress.batchSize).toBe(8);
    expect(budgeted.progress.partial).toBe(true);

    const crossed = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 24 },
    );
    const crossedRow = crossed.candidates.find((row) => row.flags.crossedMarket);
    expect(crossedRow?.outcome).toBe('incomplete');
    expect(crossedRow?.usableForComparison).toBe(false);
    expect(context.config.finderLiveScan).toBe(false);
  });

  it('pins profileRevision for the scan lifetime so Scan More keeps the same strategy revision', async () => {
    let liveRevision = 1;
    const first = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => ({ ...SAL_PMCC_DEEP_ITM, revision: liveRevision }),
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 4 },
    );
    expect(first.profileRevision).toBe(1);
    expect(first.profileId).toBe('sal-pmcc-deep-itm');

    liveRevision = 99;
    const more = await runFinderScanMoreForTest(first.scanId, 4);
    expect(more.profileRevision).toBe(1);
    expect(more.profileId).toBe(first.profileId);
    expect(more.profileName).toBe(first.profileName);
    expect(more.candidates.length).toBeGreaterThan(first.candidates.length);
  });

  it('persists bookmarks without writing brokerage tables', async () => {
    const context = await opened();
    const result = await runFinderScanForTest(
      {
        liveScanEnabled: false,
        brokerage: null,
        portfolioView: 'demo',
        readProfile: () => SAL_PMCC_DEEP_ITM,
        underlyingPrice: '100.00',
        now: () => new Date('2026-10-15T14:00:00.000Z'),
      },
      { underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm' },
    );
    const usable = result.candidates.find((row) => row.supportStatus === 'supported' && row.ask != null)!;
    const saved = saveFinderBookmark(context.database.db, usable, '2026-10-15T14:05:00.000Z');
    expect(listFinderBookmarks(context.database.db).bookmarks).toHaveLength(1);
    expect(saved.snapshot.occSymbol).toBe(usable.occSymbol);
    const brokerCount = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(brokerCount.count).toBe(0);
    expect(deleteFinderBookmark(context.database.db, saved.id)).toBe(true);
    expect(listFinderBookmarks(context.database.db).bookmarks).toHaveLength(0);
  });
});

describe('finder HTTP routes', () => {
  it('rejects unauthenticated access and serves demo scans when signed in', async () => {
    const context = await opened();
    const app = createApp(context);
    expect((await request(app).post('/api/finder/scans').set('Origin', 'http://127.0.0.1').send({ underlying: 'QCOM', profileId: 'sal-pmcc-deep-itm' })).status).toBe(401);
    expect((await request(app).get('/api/finder/bookmarks')).status).toBe(401);

    setupOwnerPassphrase(context.database.db, passphrase);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase });
    const scan = await agent
      .post('/api/finder/scans')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({ underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 10 });
    expect(scan.status).toBe(201);
    expect(scan.body.mode).toBe('demo-fixture');
    expect(scan.body.underlying).toBe('DEMO');
    expect(scan.body.marketContext.simulated).toBe(true);
    expect(scan.body.marketContext.simulatedNotice).toMatch(/SIMULATED DATA/i);
    expect(scan.body.profileName).toBe('Sal PMCC — Deep ITM');
    expect(scan.body.tolerances.loosensSavedProfile).toBe(false);
    expect(scan.body.candidates.length).toBeGreaterThan(0);

    const aaplBlocked = await agent
      .post('/api/finder/scans')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({ underlying: 'AAPL', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 8 });
    expect(aaplBlocked.status).toBe(201);
    expect(aaplBlocked.body.status).toBe('failed');
    expect(aaplBlocked.body.message).toMatch(/fictional ticker DEMO/i);

    const leadingDot = await agent
      .post('/api/finder/scans')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({
        underlying: 'DEMO',
        profileId: 'sal-pmcc-deep-itm',
        evaluationBudget: 10,
        tolerances: {
          name: 'Exploratory delta window',
          note: 'Exploratory window only.',
          loosensSavedProfile: false,
          minLongDelta: '.80',
          maxContractCost: null,
          minExpirationDays: null,
          minIntrinsicPercent: null,
          maxBidAskSpreadPercent: null,
          minOpenInterest: null,
          minVolume: null,
        },
      });
    expect(leadingDot.status).toBe(201);
    expect(leadingDot.body.tolerances.minLongDelta).toBe('0.80');
    expect(leadingDot.body.tolerances.loosensSavedProfile).toBe(false);

    const invalidDelta = await agent
      .post('/api/finder/scans')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({
        underlying: 'DEMO',
        profileId: 'sal-pmcc-deep-itm',
        tolerances: {
          name: 'Exploratory delta window',
          note: 'Exploratory window only.',
          loosensSavedProfile: false,
          minLongDelta: '1.5',
          maxContractCost: null,
          minExpirationDays: null,
          minIntrinsicPercent: null,
          maxBidAskSpreadPercent: null,
          minOpenInterest: null,
          minVolume: null,
        },
      });
    expect(invalidDelta.status).toBe(400);
    expect(invalidDelta.body.error).toMatch(/between 0 and 1/i);
    expect(JSON.stringify(invalidDelta.body)).not.toMatch(/ZodError|"issues"/);

    const candidate = scan.body.candidates.find((row: { supportStatus: string; ask: string | null }) => row.supportStatus === 'supported' && row.ask);
    const bookmark = await agent
      .post('/api/finder/bookmarks')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({ candidate });
    expect(bookmark.status).toBe(201);
    const listed = await agent.get('/api/finder/bookmarks');
    expect(listed.status).toBe(200);
    expect(listed.body.bookmarks).toHaveLength(1);
    expect(listed.body.warnings).toEqual([]);
  });

  it('restores a labeled DEMO finder session without brokerage requests', async () => {
    const context = await opened();
    let brokerageCalls = 0;
    context.brokerage = {
      async getJson() {
        brokerageCalls += 1;
        throw new Error('brokerage must not be called');
      },
    };
    setupOwnerPassphrase(context.database.db, passphrase);
    const app = createApp(context);
    const agent = request.agent(app);
    const loggedIn = await agent.post('/api/session').set('Origin', 'http://127.0.0.1').send({ passphrase });
    const scan = await agent
      .post('/api/finder/scans')
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({ underlying: 'DEMO', profileId: 'sal-pmcc-deep-itm', evaluationBudget: 2 });
    expect(scan.status).toBe(201);
    expect(scan.body.mode).toBe('demo-fixture');
    expect(scan.body.underlying).toBe('DEMO');
    expect(scan.body.marketContext.simulated).toBe(true);
    expect(brokerageCalls).toBe(0);

    const restored = await agent.get(`/api/research-sessions/${scan.body.scanId}`);
    expect(restored.status).toBe(200);
    expect(restored.body.kind).toBe('finder');
    expect(restored.body.result.mode).toBe('demo-fixture');
    expect(restored.body.result.underlying).toBe('DEMO');
    expect(restored.body.result.candidates).toHaveLength(scan.body.candidates.length);
    expect(restored.body.result.progress.canScanMore).toBe(scan.body.progress.canScanMore);
    expect(restored.body.summary.canScanMoreContracts).toBe(scan.body.progress.canScanMore);
    expect(restored.body.summary.simulated).toBe(true);
    expect(brokerageCalls).toBe(0);

    const prefs = await agent
      .patch(`/api/research-sessions/${scan.body.scanId}/ui-prefs`)
      .set('Origin', 'http://127.0.0.1')
      .set('X-CSRF-Token', loggedIn.body.csrfToken)
      .send({
        uiPrefs: {
          finderView: 'list',
          finderSort: 'delta:higher',
          finderPresentation: 'advanced',
          finderFilters: { outcome: 'near' },
        },
      });
    expect(prefs.status).toBe(200);
    const again = await agent.get(`/api/research-sessions/${scan.body.scanId}`);
    expect(again.body.uiPrefs).toMatchObject({ finderView: 'list', finderSort: 'delta:higher', finderPresentation: 'advanced' });
    expect(again.body.result.candidates).toHaveLength(scan.body.candidates.length);
    expect(brokerageCalls).toBe(0);
    const brokerCount = context.database.sqlite.prepare('SELECT COUNT(*) AS count FROM broker_transactions').get() as { count: number };
    expect(brokerCount.count).toBe(0);
  });
});

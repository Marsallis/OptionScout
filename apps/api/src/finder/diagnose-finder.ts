import { createHash } from 'node:crypto';
import {
  FINDER_DEFAULT_EVALUATION_BUDGET,
  SAL_PMCC_DEEP_ITM,
  bidAskSpreadDollars,
  bidAskSpreadPercent,
  daysToExpiration,
  downsideMoneynessPercent,
  estimatedPurchaseCost,
  expirationBreakEven,
  extrinsicValue,
  intrinsicPercent,
  intrinsicValue,
  type FinderCandidate,
} from '@optionscout/shared';
import { brokerageBaseUrl, TastytradeClient } from '../brokerage/client.js';
import { isRegularUsEquitySession } from '../brokerage/market-hours.js';
import { parseConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applyMigrations, migrationsDirectory } from '../db/migrate.js';
import { brokerTransactions, quoteSnapshots } from '../db/schema.js';
import { readStrategyProfile } from '../strategy/profiles.js';
import { nestedChainPath, parseNestedOptionChain } from './chain.js';
import { resolveEquityStreamer } from './equities.js';
import { LiveFinderQuoteSource } from './live-quotes.js';
import { resetFinderScans, runFinderScanForTest } from './scan.js';
import { buildBudgetAwareQueue } from './selection.js';

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Finder live diagnostic failed.';
  if (/bearer|token|secret|refresh|authorization/i.test(message)) return 'Finder live diagnostic failed.';
  return message;
}

function digestRows(rows: Array<{ id?: string; rawJson?: string | null; symbol?: string; mark?: string | null }>): string {
  const hash = createHash('sha256');
  for (const row of rows) {
    hash.update(String(row.id ?? ''));
    hash.update('|');
    hash.update(String(row.rawJson ?? row.symbol ?? ''));
    hash.update('|');
    hash.update(String(row.mark ?? ''));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function verifyCandidate(candidate: FinderCandidate, stockPrice: string | null) {
  const ask = candidate.ask;
  const strike = candidate.strike;
  const expectedIntrinsic = intrinsicValue(stockPrice, strike);
  const expectedCost = estimatedPurchaseCost(ask, candidate.multiplier);
  const expectedExtrinsicShare = extrinsicValue(ask, expectedIntrinsic);
  const expectedExtrinsicContract = estimatedPurchaseCost(expectedExtrinsicShare, candidate.multiplier);
  const expectedIntrinsicPct = intrinsicPercent(expectedIntrinsic, ask);
  const expectedSpread = bidAskSpreadDollars(candidate.bid, ask);
  const expectedSpreadPct = bidAskSpreadPercent(candidate.bid, ask);
  const expectedBreakEven = expirationBreakEven(strike, ask);
  const expectedDte = daysToExpiration(candidate.expiration, candidate.receivedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const down15 = downsideMoneynessPercent(stockPrice, strike, '15');
  const mismatches: string[] = [];
  if (candidate.calculations.intrinsicValue !== expectedIntrinsic) {
    mismatches.push(`intrinsic ${candidate.calculations.intrinsicValue} vs ${expectedIntrinsic}`);
  }
  if (candidate.calculations.estimatedPurchaseCost !== expectedCost) {
    mismatches.push(`cost ${candidate.calculations.estimatedPurchaseCost} vs ${expectedCost}`);
  }
  if (candidate.calculations.extrinsicValue !== expectedExtrinsicShare) {
    mismatches.push(`extrinsic/share ${candidate.calculations.extrinsicValue} vs ${expectedExtrinsicShare}`);
  }
  if (candidate.calculations.intrinsicPercent !== expectedIntrinsicPct) {
    mismatches.push(`intrinsic% ${candidate.calculations.intrinsicPercent} vs ${expectedIntrinsicPct}`);
  }
  if (candidate.calculations.bidAskSpreadDollars !== expectedSpread) {
    mismatches.push(`spread$ ${candidate.calculations.bidAskSpreadDollars} vs ${expectedSpread}`);
  }
  if (candidate.calculations.bidAskSpreadPercent !== expectedSpreadPct) {
    mismatches.push(`spread% ${candidate.calculations.bidAskSpreadPercent} vs ${expectedSpreadPct}`);
  }
  if (candidate.calculations.expirationBreakEven !== expectedBreakEven) {
    mismatches.push(`breakeven ${candidate.calculations.expirationBreakEven} vs ${expectedBreakEven}`);
  }
  return {
    occSymbol: candidate.occSymbol.trim(),
    ask,
    delta: candidate.delta,
    expectedIntrinsicPerShare: expectedIntrinsic,
    expectedIntrinsicPerContract: estimatedPurchaseCost(expectedIntrinsic, candidate.multiplier),
    expectedExtrinsicPerShare: expectedExtrinsicShare,
    expectedExtrinsicPerContract: expectedExtrinsicContract,
    expectedCost,
    expectedIntrinsicPct,
    expectedSpread,
    expectedSpreadPct,
    expectedBreakEven,
    expectedDte,
    downsideMoneyness15: down15,
    reported: {
      intrinsic: candidate.calculations.intrinsicValue,
      cost: candidate.calculations.estimatedPurchaseCost,
      extrinsicPerShare: candidate.calculations.extrinsicValue,
      intrinsicPercent: candidate.calculations.intrinsicPercent,
      spreadDollars: candidate.calculations.bidAskSpreadDollars,
      dte: candidate.calculations.daysToExpiration,
      outcome: candidate.outcome,
    },
    mismatches,
    ok: mismatches.length === 0,
  };
}

export async function main(): Promise<void> {
  if (process.argv[2] !== '--confirm-live-finder') {
    console.error('Refusing to run live Finder scan. Pass --confirm-live-finder.');
    process.exitCode = 2;
    return;
  }
  const config = parseConfig(process.env);
  if (!config.finderLiveScan || !config.liveEnabled || !config.tastytrade || config.tastytradeEnvironment === 'unset') {
    console.error('Finder live scan is disabled.');
    process.exitCode = 2;
    return;
  }
  if (config.ordersEnabled || config.scheduledSyncEnabled) {
    console.error('Orders or scheduled sync must stay disabled.');
    process.exitCode = 2;
    return;
  }

  const database = openDatabase(config.databasePath);
  applyMigrations(database.sqlite, migrationsDirectory());
  resetFinderScans();
  const startedAt = new Date();
  const marketSession = isRegularUsEquitySession(startedAt) ? 'regular' : 'closed';

  const beforeTx = database.db.select().from(brokerTransactions).all();
  const beforeQuotes = database.db.select().from(quoteSnapshots).all();
  const beforeDigest = {
    transactionCount: beforeTx.length,
    transactionDigest: digestRows(beforeTx.map((row) => ({ id: row.id, rawJson: row.rawJson }))),
    quoteCount: beforeQuotes.length,
    quoteDigest: digestRows(beforeQuotes.map((row) => ({ id: row.id, symbol: row.symbol, mark: row.mark }))),
  };

  let quoteSource: LiveFinderQuoteSource | null = null;
  try {
    const client = new TastytradeClient({
      baseUrl: brokerageBaseUrl(config.tastytradeEnvironment),
      credentials: config.tastytrade,
    });
    const profile = readStrategyProfile(database.db);
    if (profile.id !== SAL_PMCC_DEEP_ITM.id || profile.name !== SAL_PMCC_DEEP_ITM.name) {
      throw new Error('Saved profile is not Sal PMCC — Deep ITM.');
    }

    const chainPath = nestedChainPath('QCOM');
    const chainPayload = await client.getJson(chainPath);
    const parsed = parseNestedOptionChain(chainPayload, 'QCOM');
    const longDatedCalls = parsed.contracts.filter(
      (row) => row.optionType === 'call' && row.supportStatus === 'supported' && (row.daysToExpiration ?? 0) >= 365,
    ).length;
    const equity = await resolveEquityStreamer(client, 'QCOM');
    // Underlying quote for Stage A prioritization (REST only, before full scan).
    const restSymbolByStreamer = new Map<string, { symbol: string; kind: 'equity' | 'equity-option' }>();
    restSymbolByStreamer.set(equity.streamerSymbol, { symbol: equity.returnedSymbol, kind: 'equity' });
    quoteSource = new LiveFinderQuoteSource({
      client,
      restSymbolByStreamer,
      collectMs: marketSession === 'regular' ? 4000 : 6000,
      now: () => new Date(),
    });
    await quoteSource.start();
    const equityQuotes = await quoteSource.fetchQuotes([equity.streamerSymbol]);
    const underlyingPrice =
      equityQuotes.get(equity.streamerSymbol)?.ask ??
      equityQuotes.get(equity.streamerSymbol)?.mark ??
      equityQuotes.get(equity.streamerSymbol)?.bid ??
      null;
    const plan = buildBudgetAwareQueue(parsed.contracts, underlyingPrice, { idealCost: 6000, hardMaxCost: 7000 });
    const selected = plan.queue.slice(0, FINDER_DEFAULT_EVALUATION_BUDGET);
    for (const contract of plan.queue) {
      if (contract.streamerSymbol) {
        quoteSource.registerRestSymbol(contract.streamerSymbol, contract.occSymbol, 'equity-option');
      }
    }

    const result = await runFinderScanForTest(
      {
        liveScanEnabled: true,
        brokerage: client,
        portfolioView: 'brokerage',
        readProfile: () => profile,
        chainPayload,
        quoteSource,
        underlyingPrice: underlyingPrice ?? undefined,
        now: () => new Date(),
      },
      {
        underlying: 'QCOM',
        profileId: 'sal-pmcc-deep-itm',
        evaluationBudget: FINDER_DEFAULT_EVALUATION_BUDGET,
        screeningFreshnessSeconds: 60,
      },
    );

    const liveRequestCounts = { ...quoteSource.requestCount };
    await quoteSource.stop();
    quoteSource = null;

    const afterTx = database.db.select().from(brokerTransactions).all();
    const afterQuotes = database.db.select().from(quoteSnapshots).all();
    const afterDigest = {
      transactionCount: afterTx.length,
      transactionDigest: digestRows(afterTx.map((row) => ({ id: row.id, rawJson: row.rawJson }))),
      quoteCount: afterQuotes.length,
      quoteDigest: digestRows(afterQuotes.map((row) => ({ id: row.id, symbol: row.symbol, mark: row.mark }))),
    };

    const evaluated = result.candidates.filter((row) => row.supportStatus === 'supported');
    const withAsk = evaluated.filter((row) => row.ask != null);
    const withDelta = evaluated.filter((row) => row.delta != null);
    const stockPrice = evaluated.find((row) => row.underlyingPrice)?.underlyingPrice ?? null;
    const samples = evaluated
      .filter((row) => row.ask != null)
      .slice(0, 5)
      .map((row) => verifyCandidate(row, stockPrice));

    const near078 = evaluated.find((row) => {
      const delta = row.delta == null ? null : Number(row.delta);
      return delta != null && delta >= 0.775 && delta < 0.8;
    });

    const classification = {
      exact: result.candidates.filter((row) => row.outcome === 'exact').length,
      near: result.candidates.filter((row) => row.outcome === 'near').length,
      outsideProfile: result.candidates.filter((row) => row.outcome === 'outside-profile').length,
      incomplete: result.candidates.filter((row) => row.outcome === 'incomplete').length,
    };

    const selectedExpirations = [...new Set(selected.map((row) => row.expiration))].sort();
    const leapsExpirations = [
      ...new Set(
        parsed.contracts
          .filter((row) => row.optionType === 'call' && row.supportStatus === 'supported' && (row.daysToExpiration ?? 0) >= 365)
          .map((row) => row.expiration),
      ),
    ].sort();

    const sampleTable = samples.map((sample) => ({
      occ: sample.occSymbol,
      ask: sample.ask,
      cost: sample.expectedCost,
      delta: sample.delta,
      intrinsicPct: sample.expectedIntrinsicPct,
      expiration: evaluated.find((row) => row.occSymbol.trim() === sample.occSymbol)?.expiration ?? null,
      outcome: sample.reported.outcome,
      calcOk: sample.ok,
    }));

    const finishedAt = new Date();
    const report = {
      diagnostic: 'finder-live-qcom',
      switch: {
        finderLiveScanProcessOnly: true,
        composeUnchanged: true,
        ordersEnabled: false,
        scheduledSyncEnabled: false,
      },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      marketSession,
      actionablePolicy: 'Closed-session and stale quotes are not labeled actionable.',
      underlying: 'QCOM',
      equityStreamerSymbol: equity.streamerSymbol,
      profile: { id: profile.id, name: profile.name },
      requestCounts: {
        nestedChain: 1,
        equityInstrument: 1,
        ...liveRequestCounts,
      },
      underlyingPrice,
      provider: {
        totalOptionsReturned: parsed.discovered,
        callContracts: parsed.contracts.filter((row) => row.optionType === 'call').length,
        putContracts: parsed.putsDiscovered,
        standardSupportedCalls: parsed.standardCalls,
        longDatedSupportedCalls: longDatedCalls,
        unsupportedAdjusted: parsed.unsupportedAdjusted,
        missingStreamer: parsed.missingStreamer,
      },
      selection: {
        algorithm: plan.algorithm,
        evaluationBudget: FINDER_DEFAULT_EVALUATION_BUDGET,
        batchSize: 8,
        selectedForEvaluation: selected.length,
        remaining: result.progress.remaining,
        canScanMore: result.progress.canScanMore,
        notEvaluatedDueToBudget: Math.max(0, longDatedCalls - selected.length),
        selectedExpirations,
        leapsExpirationsInChain: leapsExpirations,
        allLeapsExpirationsRepresented:
          leapsExpirations.length === 0 || leapsExpirations.every((expiration) => selectedExpirations.includes(expiration)),
        initialFloors: selected.slice(0, 12).map((row) => {
          const ranked = plan.ranked.find((item) => item.contract.occSymbol === row.occSymbol);
          return {
            occ: row.occSymbol.trim(),
            strike: row.strike,
            expiration: row.expiration,
            band: ranked?.band ?? null,
            estimatedFloorCost: ranked?.estimatedFloorCost ?? null,
          };
        }),
        partial: result.progress.partial,
        exhaustiveClaim: false,
        coverageSummary: result.progress.coverageSummary,
      },
      evaluation: {
        candidatesInResult: result.candidates.length,
        supportedEvaluated: evaluated.length,
        withUsableAsk: withAsk.length,
        withDelta: withDelta.length,
        inBudgetAskCost: evaluated.filter((row) => row.calculations.estimatedPurchaseCost != null && Number(row.calculations.estimatedPurchaseCost) <= 7000).length,
        overBudgetAskCost: evaluated.filter((row) => row.calculations.estimatedPurchaseCost != null && Number(row.calculations.estimatedPurchaseCost) > 7000).length,
        deltaMin: withDelta.reduce((min, row) => Math.min(min, Number(row.delta)), Number.POSITIVE_INFINITY),
        deltaMax: withDelta.reduce((max, row) => Math.max(max, Number(row.delta)), 0),
        openInterestAvailable: evaluated.filter((row) => row.openInterest != null).length,
        volumeAvailable: evaluated.filter((row) => row.volume != null).length,
      },
      classification,
      coverageNotes: result.coverageNotes,
      liquidityNote:
        'Profile bid/ask, open-interest, and volume thresholds remain unconfigured. That blocks Exact Match and is reported as unconfigured, not invented.',
      delta078Check: near078
        ? {
            found: true,
            occSymbol: near078.occSymbol.trim(),
            delta: near078.delta,
            outcome: near078.outcome,
            notExcludedForPreferenceOnly: near078.outcome === 'near' || near078.outcome === 'exact',
          }
        : { found: false, note: 'No evaluated contract landed in the 0.775–0.799 delta band this run.' },
      calculationAudit: {
        samplesChecked: samples.length,
        allMatched: samples.every((sample) => sample.ok),
        samples,
      },
      sampleTable,
      freshness: {
        afterHoursSnapshots: evaluated.filter((row) => row.flags.afterHoursSnapshot).length,
        missingProviderTimestamp: evaluated.filter((row) => row.flags.missingProviderTimestamp).length,
        actionableTrue: evaluated.filter((row) => row.flags.actionable).length,
        quoteGreekMismatch: evaluated.filter((row) => row.flags.quoteGreekMismatch).length,
      },
      accounting: {
        transactionCountBefore: beforeDigest.transactionCount,
        transactionCountAfter: afterDigest.transactionCount,
        transactionDigestUnchanged: beforeDigest.transactionDigest === afterDigest.transactionDigest,
        quoteSnapshotDigestUnchanged: beforeDigest.quoteDigest === afterDigest.quoteDigest,
        quoteCountUnchanged: beforeDigest.quoteCount === afterDigest.quoteCount,
        bookmarksAreNotBrokerPositions: true,
      },
      status: result.status,
      message: result.message,
      readyForControlledBrowserTest:
        result.status === 'completed' &&
        beforeDigest.transactionDigest === afterDigest.transactionDigest &&
        samples.every((sample) => sample.ok),
      limitations: [
        'Open interest is not subscribed (Summary events omitted).',
        'Scan budget 24 is not exhaustive.',
        marketSession === 'closed' ? 'Market was closed; quotes are after-hours snapshots and not actionable.' : null,
      ].filter(Boolean),
    };

    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(safeMessage(error));
    process.exitCode = 1;
  } finally {
    try {
      await quoteSource?.stop();
    } catch {
      // ignore close errors
    }
    resetFinderScans();
    database.sqlite.close();
  }
}

const entry = process.argv[1]?.replaceAll('\\', '/');
if (entry?.endsWith('/diagnose-finder.js') || entry?.endsWith('/diagnose-finder.ts')) {
  await main();
}

import { describe, expect, it } from 'vitest';
import {
  buildSmartScanInsights,
  buildSmartScanPlainSummary,
  buildSmartScanPolicy,
  listCuratedStarterUniverses,
  normalizeTickerList,
  parseTickerCsv,
  SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST,
  SMART_SCAN_MAX_TICKERS,
} from './smart-scan.js';

describe('smart scan shared helpers', () => {
  it('deduplicates and validates tickers', () => {
    const { tickers, rejected } = normalizeTickerList(['aapl', 'AAPL', '123', 'MSFT', '']);
    expect(tickers).toEqual(['AAPL', 'MSFT']);
    expect(rejected).toContain('123');
  });

  it('parses csv ticker lists', () => {
    const { tickers } = parseTickerCsv('ticker\nCVX\nWMT,extra\n# comment\nQCOM');
    expect(tickers).toEqual(['CVX', 'WMT', 'QCOM']);
  });

  it('keeps every ticker in a one-line comma list and a Ticker column', () => {
    expect(parseTickerCsv('AAPL,MSFT,NVDA,QCOM,WMT').tickers).toEqual(['AAPL', 'MSFT', 'NVDA', 'QCOM', 'WMT']);
    const column = parseTickerCsv('Ticker,Name\nAAPL,Apple\nMSFT,Microsoft\n123,Nope');
    expect(column.tickers).toEqual(['AAPL', 'MSFT']);
    expect(column.rejected).toContain('123');
  });

  it('exposes curated starters with provenance and real tickers', () => {
    const starters = listCuratedStarterUniverses();
    expect(starters.length).toBeGreaterThan(0);
    expect(starters[0]!.tickers.length).toBeGreaterThan(SMART_SCAN_MAX_TICKERS);
    expect(starters[0]!.sourceLabel).toMatch(/not an official/i);
    expect(starters[0]!.sourceKind).toBe('curated-starter');
    expect(starters[0]!.tickers).toContain('CVX');
  });

  it('builds insights only from evaluated candidates', () => {
    const progress = {
      companiesSelected: 3,
      companiesChainRetrieved: 3,
      companiesWithEvaluatedContracts: 2,
      companiesNotYetScanned: 0,
      companiesUnsupportedOrEmpty: 0,
      companiesRateLimitedOrError: 0,
      eligibleContractsDiscovered: 40,
      contractsFullyEvaluated: 6,
      contractsPartiallyEvaluated: 0,
      contractsNotYetEvaluated: 34,
      missingQuotesOrGreeks: 0,
      evaluationBudget: 24,
      evaluationBudgetUsed: 6,
      batchSize: 8,
      canScanMore: true,
      cancelled: false,
      plainSummary: 'x',
      coverageNote: 'y',
    };
    expect(buildSmartScanInsights({ tickers: [], candidates: [], progress })).toEqual([]);
    expect(buildSmartScanPlainSummary(progress)).toMatch(/does not mean the entire market/i);
    expect(buildSmartScanPlainSummary(progress)).toMatch(/Counts: attempted/i);
  });

  it('builds diagnostic vs normal smart scan policies', () => {
    const diagnostic = buildSmartScanPolicy({
      smartScanLive: true,
      mode: 'diagnostic',
      liveScanEnabled: true,
      portfolioView: 'brokerage',
    });
    expect(diagnostic.mode).toBe('diagnostic');
    expect(diagnostic.allowlist).toEqual([...SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST]);
    expect(diagnostic.maxTickers).toBe(3);
    expect(diagnostic.scanMoreSessionCap).toBe(24);
    expect(diagnostic.liveModeActive).toBe(true);

    const normal = buildSmartScanPolicy({
      smartScanLive: true,
      mode: 'normal',
      liveScanEnabled: true,
      portfolioView: 'brokerage',
    });
    expect(normal.mode).toBe('normal');
    expect(normal.allowlist).toEqual([]);
    expect(normal.maxTickers).toBe(SMART_SCAN_MAX_TICKERS);
    expect(normal.scanMoreSessionCap).toBeNull();
    expect(normal.statusLabel).toBe('Smart Scan Ready');
  });
});

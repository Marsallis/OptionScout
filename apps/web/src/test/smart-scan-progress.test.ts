import { describe, expect, it } from 'vitest';
import type { SmartScanResult } from '@optionscout/shared';
import { deriveScanUiStage, scanProgressIsOpen } from '../components/SmartScanProgressPanel';

function baseProgress(overrides: Partial<SmartScanResult['progress']> = {}): SmartScanResult['progress'] {
  return {
    companiesSelected: 3,
    companiesChainRetrieved: 0,
    companiesWithEvaluatedContracts: 0,
    companiesNotYetScanned: 3,
    companiesUnsupportedOrEmpty: 0,
    companiesRateLimitedOrError: 0,
    eligibleContractsDiscovered: 0,
    contractsFullyEvaluated: 0,
    contractsPartiallyEvaluated: 0,
    contractsNotYetEvaluated: 0,
    missingQuotesOrGreeks: 0,
    evaluationBudget: 24,
    evaluationBudgetUsed: 0,
    batchSize: 8,
    canScanMore: false,
    cancelled: false,
    plainSummary: 'Starting…',
    coverageNote: 'note',
    ...overrides,
  };
}

function baseScan(overrides: Partial<SmartScanResult> = {}): SmartScanResult {
  return {
    scanId: 's1',
    status: 'running',
    mode: 'simulated-fixture',
    profileId: 'p',
    profileName: 'p',
    profileRevision: 1,
    scanPriority: 'closest-to-strategy',
    universeId: null,
    universeLabel: 'u',
    startedAt: '2026-10-17T12:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-10-17T12:00:00.000Z',
    sessionPersistence: 'in-memory',
    sessionNotice: '',
    message: '',
    simulated: true,
    simulatedNotice: null,
    dataSource: 'SIMULATED',
    tickers: [],
    insights: [],
    candidates: [],
    tolerances: { showProfileMisses: true },
    error: null,
    progress: baseProgress(),
    ...overrides,
  } as SmartScanResult;
}

describe('deriveScanUiStage', () => {
  it('keeps the progress indicator open while contracts are still being retrieved', () => {
    expect(scanProgressIsOpen('running', false)).toBe(true);
    expect(scanProgressIsOpen('completed', true)).toBe(true);
    expect(scanProgressIsOpen('completed', false)).toBe(false);
  });

  it('returns idle without a scan', () => {
    expect(deriveScanUiStage(null)).toBe('idle');
  });

  it('animates only while status is running', () => {
    expect(deriveScanUiStage(baseScan({ status: 'completed' }))).toBe('completed');
    expect(deriveScanUiStage(baseScan({ status: 'failed' }))).toBe('failed');
    expect(deriveScanUiStage(baseScan({ status: 'cancelled', progress: baseProgress({ cancelled: true }) }))).toBe(
      'cancelled',
    );
  });

  it('uses preparing when nothing retrieved yet', () => {
    expect(deriveScanUiStage(baseScan({ status: 'running' }))).toBe('preparing');
  });

  it('uses retrieving when chains exist but no evaluations', () => {
    expect(
      deriveScanUiStage(
        baseScan({
          status: 'running',
          progress: baseProgress({ companiesChainRetrieved: 1, companiesNotYetScanned: 2 }),
        }),
      ),
    ).toBe('retrieving');
  });

  it('uses evaluating when budget or evaluations advance', () => {
    expect(
      deriveScanUiStage(
        baseScan({
          status: 'running',
          progress: baseProgress({
            evaluationBudgetUsed: 2,
            contractsFullyEvaluated: 1,
            companiesChainRetrieved: 2,
          }),
        }),
      ),
    ).toBe('evaluating');
  });

  it('falls back to generic scanning when counters do not map to a named stage', () => {
    expect(
      deriveScanUiStage(
        baseScan({
          status: 'running',
          progress: baseProgress({
            companiesChainRetrieved: 2,
            evaluationBudgetUsed: 0,
            contractsFullyEvaluated: 0,
            companiesNotYetScanned: 0,
          }),
        }),
      ),
    ).toBe('scanning');
  });
});

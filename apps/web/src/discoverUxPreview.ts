/**
 * Client-only Discover UX preview fixtures for browser verification.
 * Does not call brokerage APIs or start live Smart Scans.
 */
import {
  ACCEPTANCE_SAVED_PROFILE,
  PLAN_FIT_ACCEPTANCE_NOTICE,
  SHOW_PROFILE_MISSES,
  SMART_SCAN_SESSION_NOTICE,
  buildCvxJan2029AcceptanceCandidate,
  buildWmtJan2029AcceptanceCandidate,
  type SmartScanResult,
} from '@optionscout/shared';

export function readDiscoverUxPreviewMode(): 'off' | 'completed' | 'running' {
  try {
    const mode = new URLSearchParams(window.location.search).get('uxPreview');
    if (mode === '1' || mode === 'completed') return 'completed';
    if (mode === 'running') return 'running';
  } catch {
    /* ignore */
  }
  return 'off';
}

export function buildDiscoverUxPreviewScan(mode: 'completed' | 'running'): SmartScanResult {
  const wmt = buildWmtJan2029AcceptanceCandidate();
  const cvx = buildCvxJan2029AcceptanceCandidate();
  const running = mode === 'running';
  return {
    scanId: 'ux-preview-discover',
    status: running ? 'running' : 'completed',
    mode: 'simulated-fixture',
    profileId: ACCEPTANCE_SAVED_PROFILE.id,
    profileName: ACCEPTANCE_SAVED_PROFILE.name,
    profileRevision: ACCEPTANCE_SAVED_PROFILE.revision,
    scanPriority: 'closest-to-strategy',
    universeId: 'ux-preview',
    universeLabel: 'UX preview fixtures (not live)',
    startedAt: '2026-10-17T18:00:00.000Z',
    finishedAt: running ? null : '2026-10-17T18:00:02.000Z',
    updatedAt: '2026-10-17T18:00:02.000Z',
    sessionPersistence: 'in-memory',
    sessionNotice: SMART_SCAN_SESSION_NOTICE,
    message: running
      ? 'UX preview — simulated running scan (no brokerage request).'
      : 'UX preview — simulated completed batch (no brokerage request).',
    simulated: true,
    simulatedNotice: PLAN_FIT_ACCEPTANCE_NOTICE,
    dataSource: 'SIMULATED',
    progress: {
      companiesSelected: 3,
      companiesChainRetrieved: running ? 2 : 3,
      companiesWithEvaluatedContracts: running ? 1 : 2,
      companiesNotYetScanned: running ? 1 : 0,
      companiesUnsupportedOrEmpty: 0,
      companiesRateLimitedOrError: 0,
      eligibleContractsDiscovered: 18,
      contractsFullyEvaluated: running ? 2 : 6,
      contractsPartiallyEvaluated: 0,
      contractsNotYetEvaluated: running ? 16 : 12,
      missingQuotesOrGreeks: 0,
      evaluationBudget: 24,
      evaluationBudgetUsed: running ? 2 : 6,
      batchSize: 8,
      canScanMore: true,
      cancelled: false,
      plainSummary: running
        ? 'We are evaluating contracts across the selected companies (UX preview counters).'
        : 'We checked 3 companies and fully evaluated 6 options contracts (UX preview).',
      coverageNote: 'UX preview fixtures only — not a live market scan.',
    },
    tickers: [
      {
        ticker: 'WMT',
        companyName: 'Walmart',
        status: 'evaluated',
        message: 'ok',
        underlyingPrice: '127.00',
        underlyingQuoteAt: '2026-10-17T18:00:00.000Z',
        eligibleContracts: 6,
        evaluatedContracts: 1,
        incompleteContracts: 0,
        exactMatches: 1,
        nearMatches: 0,
      },
      {
        ticker: 'CVX',
        companyName: 'Chevron',
        status: 'evaluated',
        message: 'ok',
        underlyingPrice: '155.00',
        underlyingQuoteAt: '2026-10-17T18:00:00.000Z',
        eligibleContracts: 6,
        evaluatedContracts: 1,
        incompleteContracts: 0,
        exactMatches: 0,
        nearMatches: 1,
      },
      {
        ticker: 'QCOM',
        companyName: 'Qualcomm',
        status: running ? 'pending' : 'evaluated',
        message: running ? 'not yet scanned' : 'ok',
        underlyingPrice: null,
        underlyingQuoteAt: null,
        eligibleContracts: 0,
        evaluatedContracts: 0,
        incompleteContracts: 0,
        exactMatches: 0,
        nearMatches: 0,
      },
    ],
    insights: [
      {
        id: 'ux-preview',
        text: 'Client-only UX preview using labeled acceptance fixtures. No brokerage Smart Scan was started.',
      },
    ],
    candidates: [wmt, cvx],
    tolerances: SHOW_PROFILE_MISSES,
    error: null,
  };
}

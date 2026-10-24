import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router-dom';
import {
  SHOW_PROFILE_MISSES,
  listCuratedStarterUniverses,
  SAL_PMCC_DEEP_ITM,
  SMART_SCAN_SESSION_NOTICE,
  type SessionView,
  type SettingsView,
} from '@optionscout/shared';
import { DiscoverOpportunitiesPage, resetDiscoverSelectionDraft } from '../pages/DiscoverOpportunitiesPage';
import { ResearchWorkspaceProvider } from '../state/ResearchWorkspace';
import { theme } from '../theme';
import { brokerFixture, settingsFixture } from './fixtures';

const mocks = vi.hoisted(() => ({
  appState: {
    status: 'ready' as 'loading' | 'ready' | 'error',
    session: null as SessionView | null,
    error: null as string | null,
    settings: null as SettingsView | null,
    broker: null as typeof brokerFixture | null,
  },
  fetchStrategyProfiles: vi.fn(),
  fetchDiscoveryUniverses: vi.fn(),
  fetchSmartScanPolicy: vi.fn(),
  createSmartScan: vi.fn(),
  scanSmartNextCompanies: vi.fn(),
  fetchSmartScan: vi.fn(),
  scanSmartMore: vi.fn(),
  cancelSmartScan: vi.fn(),
  createDiscoveryUniverse: vi.fn(),
  importDiscoveryUniverseCsv: vi.fn(),
  previewHoldingsCsvImport: vi.fn(),
  commitHoldingsCsvImport: vi.fn(),
  deleteDiscoveryUniverse: vi.fn(),
  saveFinderBookmark: vi.fn(),
  fetchResearchSessions: vi.fn(),
  fetchLatestResearchSession: vi.fn(),
  fetchResearchSession: vi.fn(),
  deleteResearchSession: vi.fn(),
  patchResearchSessionUiPrefs: vi.fn(),
}));

vi.mock('../state/AppState', () => ({
  useAppState: () => mocks.appState,
}));

vi.mock('../api/client', () => ({
  fetchStrategyProfiles: mocks.fetchStrategyProfiles,
  fetchDiscoveryUniverses: mocks.fetchDiscoveryUniverses,
  fetchSmartScanPolicy: mocks.fetchSmartScanPolicy,
  createSmartScan: mocks.createSmartScan,
  scanSmartNextCompanies: mocks.scanSmartNextCompanies,
  fetchSmartScan: mocks.fetchSmartScan,
  scanSmartMore: mocks.scanSmartMore,
  cancelSmartScan: mocks.cancelSmartScan,
  createDiscoveryUniverse: mocks.createDiscoveryUniverse,
  importDiscoveryUniverseCsv: mocks.importDiscoveryUniverseCsv,
  previewHoldingsCsvImport: mocks.previewHoldingsCsvImport,
  commitHoldingsCsvImport: mocks.commitHoldingsCsvImport,
  deleteDiscoveryUniverse: mocks.deleteDiscoveryUniverse,
  saveFinderBookmark: mocks.saveFinderBookmark,
  fetchResearchSessions: mocks.fetchResearchSessions,
  fetchLatestResearchSession: mocks.fetchLatestResearchSession,
  fetchResearchSession: mocks.fetchResearchSession,
  deleteResearchSession: mocks.deleteResearchSession,
  patchResearchSessionUiPrefs: mocks.patchResearchSessionUiPrefs,
}));

/** Full-page MUI interactions take about 3–6s on a GitHub runner. Vitest's default test limit is 5s. */
const SLOW_UI_MS = 15_000;

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ResearchWorkspaceProvider>
          <DiscoverOpportunitiesPage />
        </ResearchWorkspaceProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Discover Opportunities page', () => {
  beforeEach(() => {
    resetDiscoverSelectionDraft();
    cleanup();
    mocks.appState.status = 'ready';
    mocks.appState.error = null;
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    mocks.appState.settings = { ...settingsFixture, portfolioView: 'brokerage' };
    mocks.appState.broker = brokerFixture;
    mocks.fetchStrategyProfiles.mockReset().mockResolvedValue({
      profiles: [SAL_PMCC_DEEP_ITM],
      defaultProfileId: SAL_PMCC_DEEP_ITM.id,
    });
    mocks.fetchDiscoveryUniverses.mockReset().mockResolvedValue({
      curated: listCuratedStarterUniverses(),
      saved: [],
      bookmarkDerived: null,
    });
    mocks.fetchSmartScanPolicy.mockReset().mockResolvedValue({
      enabled: false,
      mode: 'normal',
      allowlist: [],
      maxBudget: 24,
      maxTickers: 12,
      liveModeActive: false,
      scanMoreSessionCap: null,
      statusLabel: 'Normal Mode (simulated)',
    });
    mocks.fetchResearchSessions.mockReset().mockResolvedValue({ sessions: [] });
    mocks.fetchLatestResearchSession.mockReset().mockRejectedValue(new Error('No saved research session yet.'));
    mocks.fetchResearchSession.mockReset().mockRejectedValue(new Error('not found'));
    mocks.deleteResearchSession.mockReset().mockResolvedValue(undefined);
    mocks.patchResearchSessionUiPrefs.mockReset().mockResolvedValue({ ok: true });
    mocks.createDiscoveryUniverse.mockReset().mockResolvedValue({
      id: 'univ-search',
      name: 'This search',
      sourceKind: 'custom',
      sourceLabel: 'Selected companies for one search',
      retrievedAt: '2026-10-18',
      tickers: ['AAPL'],
      companyNames: { AAPL: 'Apple' },
      sectors: {},
      weights: {},
      weightReading: 'unspecified',
      weightPercents: {},
      editable: true,
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      currentVersion: { id: 'univ-search@v1', version: 1 },
    });
    mocks.scanSmartNextCompanies.mockReset();
    mocks.cancelSmartScan.mockReset();
    mocks.createSmartScan.mockReset().mockResolvedValue({
      scanId: 'smart_1',
      status: 'completed',
      mode: 'simulated-fixture',
      profileId: SAL_PMCC_DEEP_ITM.id,
      profileName: SAL_PMCC_DEEP_ITM.name,
      profileRevision: 1,
      scanPriority: 'closest-to-strategy',
      universeId: 'curated-explore-liquid-us-2026-10-17',
      universeLabel: 'Explore: Liquid US examples',
      startedAt: '2026-10-17T12:00:00.000Z',
      finishedAt: '2026-10-17T12:00:01.000Z',
      updatedAt: '2026-10-17T12:00:01.000Z',
      sessionPersistence: 'in-memory',
      sessionNotice: SMART_SCAN_SESSION_NOTICE,
      message: 'Initial Smart Scan batch complete.',
      simulated: true,
      simulatedNotice: 'SIMULATED DATA — NOT ACTUAL MARKET PRICES',
      dataSource: 'SIMULATED',
      progress: {
        companiesSelected: 3,
        companiesChainRetrieved: 3,
        companiesWithEvaluatedContracts: 2,
        companiesNotYetScanned: 0,
        companiesUnsupportedOrEmpty: 0,
        companiesRateLimitedOrError: 0,
        eligibleContractsDiscovered: 18,
        contractsFullyEvaluated: 6,
        contractsPartiallyEvaluated: 0,
        contractsNotYetEvaluated: 12,
        missingQuotesOrGreeks: 0,
        evaluationBudget: 24,
        evaluationBudgetUsed: 6,
        batchSize: 8,
        canScanMore: true,
        cancelled: false,
        plainSummary: 'We checked 3 companies and fully evaluated 6 options contracts.',
        coverageNote: 'A finished evaluation batch does not mean every company was examined.',
      },
      tickers: [
        {
          ticker: 'AAPL',
          companyName: 'Apple',
          status: 'evaluated',
          message: 'ok',
          underlyingPrice: '180.00',
          underlyingQuoteAt: '2026-10-17T12:00:00.000Z',
          eligibleContracts: 6,
          evaluatedContracts: 2,
          incompleteContracts: 0,
          exactMatches: 1,
          nearMatches: 1,
        },
      ],
      insights: [{ id: 'exact-near-companies', text: '1 company has contracts that meet your currently assessable Exact or Near Match rules.' }],
      candidates: [],
      tolerances: SHOW_PROFILE_MISSES,
      error: null,
    });
  });

  afterEach(() => cleanup());

  it('loads curated explore universes and starts a mocked smart scan', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Explore Stocks' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your strategy')).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchDiscoveryUniverses).toHaveBeenCalled());
    await user.click(await screen.findByRole('checkbox', { name: /AAPL/i }));
    expect(mocks.createSmartScan).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Find Matching LEAPS' }));
    await waitFor(() => expect(mocks.createSmartScan).toHaveBeenCalled());
    const body = mocks.createSmartScan.mock.calls.at(-1)?.[0] as { tickers?: string[]; universeId?: string; universeLabel?: string };
    expect(body.tickers?.length).toBeLessThanOrEqual(12);
    expect(body.universeId).toBe('univ-search');
    expect(body.universeLabel).toBe('AAPL');
    expect(mocks.createDiscoveryUniverse.mock.calls.at(-1)?.[0]).toMatchObject({ name: 'AAPL' });
    expect(await screen.findByText(/We checked 3 companies/i)).toBeInTheDocument();
    expect(screen.getByText(/Filter and compare results/i)).toBeInTheDocument();
    expect(screen.getByText(/Research so far/i)).toBeInTheDocument();
  }, SLOW_UI_MS);

  it('selects a ready collection without requesting market data', async () => {
    const user = userEvent.setup();
    mocks.fetchDiscoveryUniverses.mockResolvedValue({
      curated: [],
      saved: [
        {
          id: 'univ-vti',
          name: 'Vanguard Total Stock Market ETF',
          sourceKind: 'csv-import',
          sourceLabel: 'Vanguard holdings for VTI',
          retrievedAt: '2026-10-15',
          tickers: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'],
          companyNames: { AAPL: 'Apple' },
          sectors: {},
          weights: { AAPL: '7.1%' },
          weightReading: 'percentage-points',
          weightPercents: { AAPL: '7.1', MSFT: '6.2' },
          editable: true,
          createdAt: '2026-10-15T00:00:00.000Z',
          updatedAt: '2026-10-15T00:00:00.000Z',
          currentVersion: {
            id: 'univ-vti@v1',
            version: 1,
            universeType: 'etf_holdings',
            provider: 'Vanguard',
            sourceLabel: 'Vanguard holdings for VTI',
            fundTicker: 'VTI',
            holdingsEffectiveDate: '2026-10-15',
            importedAt: '2026-10-18T00:00:00.000Z',
            rowCount: 6,
            supportedEquityCount: 6,
            unsupportedCount: 0,
          },
        },
      ],
      bookmarkDerived: null,
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'VTI' }));
    expect(mocks.createSmartScan).not.toHaveBeenCalled();
    expect(await screen.findByRole('checkbox', { name: /AAPL/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /META/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search ticker or company'), 'meta');
    expect(screen.getByRole('checkbox', { name: /META/i })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /AAPL/i })).not.toBeInTheDocument();
  });

  it('shows S&P 500, Nasdaq-100, and VTI lists in the public simulated demo without an import', async () => {
    const user = userEvent.setup();
    mocks.appState.session = {
      authenticated: false,
      ownerConfigured: false,
      expiresAt: null,
      csrfToken: null,
      publicSimulatedDemo: true,
    };
    mocks.fetchDiscoveryUniverses.mockResolvedValue({ curated: [], saved: [], bookmarkDerived: null });
    renderPage();
    expect(await screen.findByRole('checkbox', { name: /AAPL/i })).toBeInTheDocument();
    expect(screen.getAllByText(/503 companies/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Not installed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in required/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nasdaq-100' }));
    expect((await screen.findAllByText(/101 companies/)).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Search ticker or company'), 'NVDA');
    expect(await screen.findByRole('checkbox', { name: /NVDA/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'VTI' }));
    expect(await screen.findByRole('checkbox', { name: /AAPL/i })).toBeInTheDocument();
    expect(screen.getAllByText(/3,463 companies/).length).toBeGreaterThan(0);
  }, SLOW_UI_MS);

  it('requires sign-in before searching', async () => {
    mocks.appState.session = null;
    renderPage();
    expect(await screen.findByText(/Sign in required/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Broker & Data/i })).toBeInTheDocument();
  });

  it('shows diagnostic mode banner and blocks unsupported tickers client-side', async () => {
    const user = userEvent.setup();
    mocks.fetchSmartScanPolicy.mockResolvedValue({
      enabled: true,
      mode: 'diagnostic',
      allowlist: ['CVX', 'QCOM', 'WMT'],
      maxBudget: 24,
      maxTickers: 3,
      liveModeActive: true,
      scanMoreSessionCap: 24,
      statusLabel: 'Diagnostic Mode',
    });
    renderPage();
    expect(await screen.findByText(/Diagnostic Mode — CVX, QCOM, WMT only/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Select CVX, QCOM, WMT/i }));
    await user.click(screen.getByRole('button', { name: 'Advanced Research' }));
    const paste = screen.getByLabelText(/paste tickers/i);
    await user.clear(paste);
    await user.type(paste, 'AAPL');
    expect(screen.getByText(/Cannot start scan with unsupported tickers/i)).toBeInTheDocument();
    expect(screen.getByText(/not because credentials failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find Matching LEAPS' })).toBeDisabled();
    expect(mocks.createSmartScan).not.toHaveBeenCalled();
  }, SLOW_UI_MS);

  it('shows normal mode ready banner and company search when policy is normal live', async () => {
    const user = userEvent.setup();
    mocks.fetchSmartScanPolicy.mockResolvedValue({
      enabled: true,
      mode: 'normal',
      allowlist: [],
      maxBudget: 24,
      maxTickers: 12,
      liveModeActive: true,
      scanMoreSessionCap: null,
      statusLabel: 'Smart Scan Ready',
    });
    renderPage();
    expect(await screen.findByText(/Choose a strategy, check up to 20 companies/i)).toBeInTheDocument();
    expect(screen.queryByText(/Smart Scan Ready/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search ticker or company')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Advanced Research' }));
    expect(screen.getByText(/Each step examines at most 12 companies/i)).toBeInTheDocument();
    expect(screen.queryByText(/Diagnostic Mode —/i)).not.toBeInTheDocument();
  });

  it('keeps a new search on screen when an older restore arrives late', async () => {
    const user = userEvent.setup();
    let releaseLatest: (value: unknown) => void = () => undefined;
    mocks.fetchLatestResearchSession.mockReturnValue(new Promise((resolve) => {
      releaseLatest = resolve;
    }));
    let releaseCreate: (value: unknown) => void = () => undefined;
    mocks.createSmartScan.mockReturnValue(new Promise((resolve) => {
      releaseCreate = resolve;
    }));
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /AAPL/i }));
    await user.click(screen.getByRole('button', { name: 'Find Matching LEAPS' }));
    expect(await screen.findByText(/This search does not use View Previous Results/i)).toBeInTheDocument();
    releaseLatest(savedSession('OLD SESSION MARKER', 'old_session'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText('OLD SESSION MARKER')).not.toBeInTheDocument();
    expect(screen.getByText(/This search does not use View Previous Results/i)).toBeInTheDocument();
    const created = savedSession('NEW SESSION MARKER', 'smart_new').result;
    created.tickers = [{ ...created.tickers[0]!, ticker: 'AAPL', companyName: 'Apple' }];
    releaseCreate(created);
    expect((await screen.findAllByText('NEW SESSION MARKER')).length).toBeGreaterThan(0);
    expect(screen.queryByText('OLD SESSION MARKER')).not.toBeInTheDocument();
    expect(screen.getByText(/Open research: AAPL/i)).toBeInTheDocument();
    expect(mocks.createSmartScan).toHaveBeenCalledTimes(1);
    expect(mocks.createSmartScan.mock.calls[0]?.[1]).toEqual({ wait: false });
    const callsBefore = mocks.createSmartScan.mock.calls.length;
    await user.click(screen.getAllByRole('button', { name: 'View Previous Results' })[0]!);
    expect(mocks.createSmartScan.mock.calls.length).toBe(callsBefore);
  }, SLOW_UI_MS);

  it('restores the latest saved session on mount without starting research', async () => {
    mocks.fetchLatestResearchSession.mockResolvedValue(savedSession('OLD SESSION MARKER', 'old_session'));
    renderPage();
    expect(await screen.findByText('OLD SESSION MARKER')).toBeInTheDocument();
    expect(mocks.createSmartScan).not.toHaveBeenCalled();
  });

  it('does not present a final empty outcome while the new research is still running', async () => {
    const user = userEvent.setup();
    const running = savedSession('Scan starting.', 'smart_run').result;
    running.status = 'running';
    running.finishedAt = null;
    running.progress.companiesWithEvaluatedContracts = 0;
    running.progress.contractsFullyEvaluated = 0;
    running.tickers = [{ ...running.tickers[0]!, ticker: 'AAPL', status: 'pending', attemptCount: 1, evaluatedContracts: 0 }];
    mocks.createSmartScan.mockResolvedValue(running);
    let releaseFetch: (value: unknown) => void = () => undefined;
    mocks.fetchSmartScan.mockReturnValue(new Promise((resolve) => {
      releaseFetch = resolve;
    }));
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /AAPL/i }));
    await user.click(screen.getByRole('button', { name: 'Find Matching LEAPS' }));
    expect(await screen.findByText(/Research is still running/i)).toBeInTheDocument();
    expect(screen.queryByText(/No Best Matches/i)).not.toBeInTheDocument();
    expect(screen.getByText('Companies attempted')).toBeInTheDocument();
    expect(screen.getByText('Companies with contracts evaluated')).toBeInTheDocument();
    const finished = savedSession('Batch finished.', 'smart_run').result;
    finished.tickers = running.tickers;
    releaseFetch(finished);
    expect(await screen.findByText(/No Best Matches in the contracts evaluated so far/i)).toBeInTheDocument();
  }, SLOW_UI_MS);

  it('pauses without cancelling the session and leaves remaining companies resumable', async () => {
    const user = userEvent.setup();
    const running = savedSession('Scan starting.', 'smart_pause').result;
    running.status = 'running';
    running.finishedAt = null;
    running.companiesInUniverseQueue = 20;
    running.companyCursor = 12;
    running.canScanNextCompanies = false;
    mocks.createSmartScan.mockResolvedValue(running);
    let releaseFetch: (value: unknown) => void = () => undefined;
    mocks.fetchSmartScan.mockReturnValue(new Promise((resolve) => {
      releaseFetch = resolve;
    }));
    mocks.cancelSmartScan.mockResolvedValue({ ...running, status: 'cancelled', message: 'cancelled' });
    mocks.scanSmartNextCompanies.mockResolvedValue(running);
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /AAPL/i }));
    await user.click(screen.getByRole('button', { name: 'Find Matching LEAPS' }));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const finished = savedSession('Batch finished.', 'smart_pause').result;
    finished.companiesInUniverseQueue = 20;
    finished.companyCursor = 12;
    finished.canScanNextCompanies = true;
    finished.tickers = running.tickers;
    releaseFetch(finished);
    expect(await screen.findByRole('button', { name: 'Continue Search' })).toBeInTheDocument();
    expect(mocks.cancelSmartScan).not.toHaveBeenCalled();
    expect(mocks.scanSmartNextCompanies).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/Batch finished/i)).length).toBeGreaterThan(0);
  }, SLOW_UI_MS);

  it('starts a second session for the same companies without replacing the first request', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: /AAPL/i }));
    await user.click(screen.getByRole('button', { name: 'Find Matching LEAPS' }));
    await screen.findByText(/We checked 3 companies/i);
    const second = savedSession('Second search.', 'smart_2').result;
    second.tickers = [{ ...second.tickers[0]!, ticker: 'AAPL', companyName: 'Apple' }];
    mocks.createSmartScan.mockResolvedValueOnce(second);
    await user.click(screen.getByRole('button', { name: 'Run New Search' }));
    expect((await screen.findAllByText('Second search.')).length).toBeGreaterThan(0);
    expect(mocks.createSmartScan).toHaveBeenCalledTimes(2);
    expect(mocks.createSmartScan.mock.calls[1]?.[0]).toMatchObject({ tickers: ['AAPL'] });
    expect(mocks.cancelSmartScan).not.toHaveBeenCalled();
  }, SLOW_UI_MS);

  it('does not start or cancel research when the page is left during a running search', async () => {
    const running = savedSession('Scan starting.', 'smart_leave').result;
    running.status = 'running';
    running.finishedAt = null;
    mocks.createSmartScan.mockReturnValue(new Promise(() => undefined));
    const view = renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /AAPL/i }));
    await user.click(screen.getByRole('button', { name: 'Find Matching LEAPS' }));
    expect(await screen.findByText(/This search does not use View Previous Results/i)).toBeInTheDocument();
    view.unmount();
    expect(mocks.cancelSmartScan).not.toHaveBeenCalled();
    expect(mocks.scanSmartNextCompanies).not.toHaveBeenCalled();
  });
});

function savedSession(marker: string, scanId: string) {
  const ticker = {
    ticker: 'IBM',
    companyName: 'IBM',
    status: 'evaluated' as 'evaluated' | 'pending' | 'chain-loaded' | 'unsupported' | 'empty' | 'error' | 'rate-limited' | 'interrupted',
    message: 'ok',
    underlyingPrice: null,
    underlyingQuoteAt: null,
    eligibleContracts: 0,
    evaluatedContracts: 0,
    incompleteContracts: 0,
    exactMatches: 0,
    nearMatches: 0,
    attemptCount: 1,
  };
  return {
    kind: 'discover' as const,
    summary: {
      id: scanId,
      scanType: 'discover' as const,
      status: 'completed' as const,
      universeId: null,
      universeVersionId: null,
      universeLabel: marker,
      profileId: SAL_PMCC_DEEP_ITM.id,
      profileName: SAL_PMCC_DEEP_ITM.name,
      profileRevision: SAL_PMCC_DEEP_ITM.revision,
      scanPriority: 'closest-to-strategy' as const,
      companiesProcessed: 1,
      companiesRemaining: 0,
      companiesInUniverse: 1,
      contractsEvaluated: 0,
      canScanNextCompanies: false,
      canScanMoreContracts: false,
      persistence: 'sqlite' as const,
      simulated: true,
      startedAt: '2026-10-17T12:00:00.000Z',
      updatedAt: '2026-10-17T12:00:01.000Z',
      finishedAt: '2026-10-17T12:00:01.000Z',
      lastSuccessfulBatchAt: null,
      nextActionHint: 'Review saved results.',
      historicalNotice: 'Saved results. No market data was requested.',
    },
    result: {
      scanId,
      status: 'completed' as 'completed' | 'running' | 'cancelled' | 'failed' | 'interrupted',
      mode: 'simulated-fixture' as const,
      profileId: SAL_PMCC_DEEP_ITM.id,
      profileName: SAL_PMCC_DEEP_ITM.name,
      profileRevision: SAL_PMCC_DEEP_ITM.revision,
      scanPriority: 'closest-to-strategy' as const,
      universeId: null,
      universeLabel: marker,
      startedAt: '2026-10-17T12:00:00.000Z',
      finishedAt: '2026-10-17T12:00:01.000Z' as string | null,
      updatedAt: '2026-10-17T12:00:01.000Z',
      sessionPersistence: 'sqlite' as const,
      sessionNotice: 'saved',
      message: marker,
      simulated: true,
      simulatedNotice: null,
      dataSource: 'SIMULATED',
      canScanNextCompanies: false,
      companyCursor: 1,
      companiesInUniverseQueue: 1,
      tickers: [ticker],
      insights: [],
      candidates: [],
      tolerances: SHOW_PROFILE_MISSES,
      error: null,
      progress: {
        companiesSelected: 1,
        companiesChainRetrieved: 1,
        companiesWithEvaluatedContracts: 0,
        companiesNotYetScanned: 0,
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
        plainSummary: marker,
        coverageNote: 'saved',
      },
    },
    strategySnapshot: SAL_PMCC_DEEP_ITM,
    orderedTickerQueue: ['IBM'],
    companyCursor: 1,
    evaluatedOcc: [] as string[],
    uiPrefs: {},
    viewMode: 'view-saved' as const,
  };
}

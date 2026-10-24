import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHOW_PROFILE_MISSES,
  type FinderCandidate,
  type FinderResearchRestore,
  type FinderScanResult,
  type ResearchUiPrefs,
  type SessionView,
  type SettingsView,
} from '@optionscout/shared';
import { LeapsFinderPage } from '../pages/LeapsFinderPage';
import { ResearchWorkspaceProvider } from '../state/ResearchWorkspace';
import { brokerFixture, settingsFixture } from './fixtures';
import { theme } from '../theme';

const mocks = vi.hoisted(() => ({
  createFinderScan: vi.fn(),
  fetchFinderBookmarks: vi.fn(),
  fetchStrategyProfiles: vi.fn(),
  scanFinderMore: vi.fn(),
  retryFinderMissingData: vi.fn(),
  saveFinderBookmark: vi.fn(),
  cancelFinderScan: vi.fn(),
  deleteFinderBookmark: vi.fn(),
  fetchResearchSessions: vi.fn(),
  fetchLatestResearchSession: vi.fn(),
  fetchResearchSession: vi.fn(),
  deleteResearchSession: vi.fn(),
  patchResearchSessionUiPrefs: vi.fn(),
  appState: {
    status: 'loading' as 'loading' | 'ready' | 'error',
    error: null as string | null,
    session: null as SessionView | null,
    settings: null as SettingsView | null,
    broker: null as typeof brokerFixture | null,
  },
}));

vi.mock('../api/client', () => ({
  createFinderScan: mocks.createFinderScan,
  fetchFinderBookmarks: mocks.fetchFinderBookmarks,
  fetchStrategyProfiles: mocks.fetchStrategyProfiles,
  scanFinderMore: mocks.scanFinderMore,
  retryFinderMissingData: mocks.retryFinderMissingData,
  saveFinderBookmark: mocks.saveFinderBookmark,
  cancelFinderScan: mocks.cancelFinderScan,
  deleteFinderBookmark: mocks.deleteFinderBookmark,
  fetchResearchSessions: mocks.fetchResearchSessions,
  fetchLatestResearchSession: mocks.fetchLatestResearchSession,
  fetchResearchSession: mocks.fetchResearchSession,
  deleteResearchSession: mocks.deleteResearchSession,
  patchResearchSessionUiPrefs: mocks.patchResearchSessionUiPrefs,
}));

vi.mock('../state/AppState', () => ({
  useAppState: () => mocks.appState,
}));

function renderFinder() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ResearchWorkspaceProvider>
          <LeapsFinderPage />
        </ResearchWorkspaceProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function candidateFixture(overrides: Partial<FinderCandidate> = {}): FinderCandidate {
  return {
    id: 'cand-1',
    underlying: 'DEMO',
    occSymbol: 'DEMO  280121C00040000',
    streamerSymbol: '.DEMO280121C40',
    optionType: 'call',
    strike: '40.00',
    expiration: '2028-01-21',
    multiplier: 100,
    chainType: 'Standard',
    standardContract: true,
    supportStatus: 'supported',
    supportNote: 'Standard contract.',
    active: true,
    closingOnly: false,
    underlyingPrice: '100.00',
    bid: '61.00',
    ask: '61.50',
    mark: '61.25',
    delta: '0.82',
    theta: '-0.0200',
    gamma: '0.0100',
    vega: '0.1500',
    impliedVolatility: '0.2800',
    volume: 12,
    openInterest: 400,
    providerEventAt: '2026-10-15T14:00:00.000Z',
    receivedAt: '2026-10-15T14:00:01.000Z',
    marketSession: 'regular',
    dataQuality: 'usable',
    flags: {
      crossedMarket: false,
      missingBid: false,
      missingAsk: false,
      invalidPrice: false,
      staleInputs: false,
      missingProviderTimestamp: false,
      quoteGreekMismatch: false,
      missingGreeks: false,
      unverifiedGreeks: false,
      afterHoursSnapshot: false,
      fromCache: false,
      actionable: true,
    },
    calculations: {
      intrinsicValue: '55.00',
      estimatedPurchaseCost: '5500.00',
      extrinsicValue: '0.00',
      intrinsicPercent: '100.00',
      bidAskSpreadDollars: '1.00',
      bidAskSpreadPercent: '1.82',
      expirationBreakEven: '165.00',
      daysToExpiration: 463,
      strikeDistance: '55.00',
      downsideMoneyness15: '12.00',
      downsideMoneyness20: '18.00',
      downsideMoneyness30: '28.00',
      deltaCapitalExposure: '0.4500',
      midpoint: '54.50',
      quoteSourceLabel: 'demo',
    },
    outcome: 'near',
    label: 'Near Match',
    visible: true,
    usableForComparison: true,
    withinExploration: true,
    reasons: [],
    metrics: {
      purchaseCost: 5500,
      delta: 0.82,
      intrinsicPercent: 100,
      extrinsicValue: 0,
      bidAskSpread: 1,
      liquidity: 400,
      dte: 463,
      theta: -0.02,
      downsideMoneyness: 18,
      pmccCompatibility: null,
    },
    pmccReason: null,
    meetsConfiguredNumericRequirements: true,
    liquidityUnassessed: false,
    observationFreshness: 'current-session',
    greekVerification: 'aligned',
    greekProviderEventAt: '2026-10-15T14:00:00.000Z',
    validationIssues: [],
    ...overrides,
  };
}

function scanFixture(overrides: Partial<FinderScanResult> = {}): FinderScanResult {
  return {
    scanId: 'scan-1',
    status: 'completed',
    mode: 'demo-fixture',
    underlying: 'DEMO',
    profileId: 'sal-pmcc-deep-itm',
    profileName: 'Sal PMCC — Deep ITM',
    startedAt: '2026-10-15T14:00:00.000Z',
    finishedAt: '2026-10-15T14:00:01.000Z',
    asOfDate: '2026-10-15',
    screeningFreshnessSeconds: 60,
    message: 'Demo scan complete.',
    progress: {
      discovered: 20,
      standardCalls: 18,
      putsDiscovered: 0,
      unsupportedAdjusted: 0,
      missingStreamer: 0,
      eligibleLeaps: 10,
      evaluationBudget: 24,
      selectedForEvaluation: 10,
      evaluated: 10,
      fullyEvaluated: 10,
      partiallyEvaluated: 0,
      notYetEvaluated: 0,
      remaining: 0,
      awaitingData: 0,
      unavailableData: 0,
      missingProviderGreeks: 0,
      missingValidQuotes: 0,
      withinHardBudget: 4,
      meetsAssessableNumericRequirements: 3,
      incompleteMissingData: 1,
      expirationsEligible: 3,
      expirationsRepresented: 3,
      estimatedRequestBudgetUsed: 0,
      canRetryMissingData: false,
      lastScanPriority: 'closest-to-strategy',
      partial: false,
      cancelled: false,
      exhausted: true,
      canScanMore: false,
      batchSize: 8,
      coverageSummary: 'Evaluated 10 of 10 eligible LEAPS.',
      selectionAlgorithm: 'unified',
      plain: {
        headline: 'Finished examining all 10 eligible long-dated calls for this scan.',
        eligibleMeaning: 'Eligible means supported long-dated calls.',
        batchStatus: 'universe-examined',
        eligibleLongDatedCalls: 10,
        uniqueContractsAttempted: 10,
        fullyEvaluated: 10,
        partiallyEvaluated: 0,
        notYetEvaluated: 0,
        withinHardBudget: 4,
        meetsAssessableNumericRequirements: 3,
        incompleteMissingData: 1,
        expirationCoverage: '3 of 3 expirations represented.',
        moneynessCoverage: 'Moneyness coverage sample.',
        snapshotSource: 'demo',
        snapshotAt: '2026-10-15T14:00:00.000Z',
        nextStepHint: 'Review contracts below.',
      },
    },
    profileRevision: 1,
    scanPriority: 'closest-to-strategy',
    coverageNotes: [],
    marketContext: {
      underlyingPrice: '100.00',
      underlyingQuoteAt: '2026-10-15T14:00:00.000Z',
      marketSession: 'closed',
      dataSource: 'SIMULATED demo-fixture (local labeled universe — not a brokerage chain)',
      simulated: true,
      simulatedNotice: 'SIMULATED DATA — NOT ACTUAL MARKET PRICES',
      quoteSkewWarning: null,
    },
    tolerances: { ...SHOW_PROFILE_MISSES },
    candidates: [candidateFixture()],
    error: null,
    ...overrides,
  };
}

describe('LEAPS Finder page', () => {
  beforeEach(() => {
    mocks.appState.status = 'loading';
    mocks.appState.error = null;
    mocks.appState.session = null;
    mocks.appState.settings = { ...settingsFixture };
    mocks.appState.broker = { ...brokerFixture };
    mocks.createFinderScan.mockReset();
    mocks.fetchResearchSessions.mockReset().mockResolvedValue({ sessions: [] });
    mocks.fetchLatestResearchSession.mockReset().mockRejectedValue(new Error('none'));
    mocks.fetchResearchSession.mockReset().mockRejectedValue(new Error('none'));
    mocks.deleteResearchSession.mockReset().mockResolvedValue(undefined);
    mocks.patchResearchSessionUiPrefs.mockReset().mockResolvedValue({ ok: true });
    mocks.fetchFinderBookmarks.mockReset().mockResolvedValue({ bookmarks: [], warnings: [] });
    mocks.fetchStrategyProfiles.mockReset().mockResolvedValue({
      profiles: [
        {
          version: 2,
          id: 'sal-pmcc-deep-itm',
          name: 'Sal PMCC — Deep ITM',
          revision: 1,
          kind: 'builtin-template',
          originTemplateId: null,
          isDefault: true,
          authority: 'implementation-spec',
          referenceNote: 'test',
          references: [],
          hard: {
            maxContractCost: '7000.00',
            minContractCost: null,
            minLongDelta: '0.75',
            minExpirationDays: 365,
            maxExpirationDays: null,
          },
          preferences: {
            idealContractCost: '6000.00',
            preferredLongDelta: '0.80',
            minIntrinsicPercent: '80',
            preferredExpirationDays: 365,
            longerExpirationDays: 730,
            maxBidAskSpreadPercent: null,
            minOpenInterest: null,
            minVolume: null,
            maxExtrinsicDollars: null,
            maxExtrinsicPercent: null,
            maxTheta: null,
            maxThetaRelativeToCapital: null,
            maxImpliedVolatility: null,
            maxVega: null,
            maxStrikeDistancePercent: null,
            downsidePercents: ['15', '20', '30'],
            shortDte: { min: 7, max: 21 },
            shortDelta: { min: '0.10', max: '0.18' },
            shortManagementDelta: { min: '0.30', max: '0.35' },
            shortPremiumCapturePercent: { min: '50', max: '70' },
            leapsReassessmentPercent: ['20', '25', '30', '40'],
          },
        },
      ],
      defaultProfileId: 'sal-pmcc-deep-itm',
    });
    mocks.scanFinderMore.mockReset();
    mocks.retryFinderMissingData.mockReset();
    mocks.saveFinderBookmark.mockReset();
    mocks.cancelFinderScan.mockReset();
    mocks.deleteFinderBookmark.mockReset();
  });

  it('survives loading → ready without React hook order errors', () => {
    const { rerender } = renderFinder();
    expect(screen.getByText('Loading Find One Stock.')).toBeInTheDocument();

    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: false,
      ownerConfigured: true,
      expiresAt: null,
      csrfToken: null,
      publicSimulatedDemo: false,
    };
    expect(() =>
      rerender(
        <MemoryRouter>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <ResearchWorkspaceProvider>
              <LeapsFinderPage />
            </ResearchWorkspaceProvider>
          </ThemeProvider>
        </MemoryRouter>,
      ),
    ).not.toThrow();
    expect(screen.getByRole('heading', { name: 'Find One Stock' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign In to Search' })).toBeInTheDocument();
    expect(screen.getByText(/Sign in required/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /WMT analysis fixture/i })).not.toBeInTheDocument();
  });

  it('renders a friendly error state', () => {
    mocks.appState.status = 'error';
    mocks.appState.error = 'API unavailable.';
    renderFinder();
    expect(screen.getByText('API unavailable.')).toBeInTheDocument();
  });

  it('explains demo-mode real tickers, install gate, and owner toggle without duplicate setup panels', async () => {
    const user = userEvent.setup();
    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    mocks.appState.settings = { ...settingsFixture, portfolioView: 'demo' };
    renderFinder();
    await user.clear(screen.getByLabelText('Stock ticker'));
    await user.type(screen.getByLabelText('Stock ticker'), 'CVX');
    expect(screen.getByText(/Demo mode only searches DEMO/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find LEAPS' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('heading', { name: 'Set up your search' })).not.toBeInTheDocument();
    cleanup();

    mocks.appState.settings = {
      ...settingsFixture,
      portfolioView: 'brokerage',
      finderLiveScanInstallAllowed: false,
      finderOnDemandSearchEnabled: false,
    };
    mocks.appState.broker = {
      ...brokerFixture,
      portfolioView: 'brokerage',
      connection: { ...brokerFixture.connection, liveEnabled: true, secretFilePresent: true, state: 'disconnected' },
    };
    renderFinder();
    expect(screen.getByText(/Live search not authorized for this installation/i)).toBeInTheDocument();
    cleanup();

    mocks.appState.settings = {
      ...settingsFixture,
      portfolioView: 'brokerage',
      finderLiveScanInstallAllowed: true,
      finderOnDemandSearchEnabled: false,
    };
    renderFinder();
    expect(screen.getByText(/Enable on-demand searches/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find LEAPS' })).toHaveAttribute('href', '/settings');
  });

  it('labels simulated fixture bookmarks and never presents them as live opportunities', async () => {
    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    mocks.appState.settings = {
      ...settingsFixture,
      portfolioView: 'brokerage',
      finderLiveScanInstallAllowed: true,
      finderOnDemandSearchEnabled: true,
    };
    mocks.appState.broker = {
      ...brokerFixture,
      portfolioView: 'brokerage',
      connection: { ...brokerFixture.connection, liveEnabled: true, secretFilePresent: true, state: 'connected' },
    };
    const fixtureCandidate = candidateFixture({
      underlying: 'WMT',
      calculations: {
        ...candidateFixture().calculations,
        quoteSourceLabel: 'SIMULATED WMT analysis fixture (not live)',
      },
    });
    mocks.fetchFinderBookmarks.mockResolvedValue({
      bookmarks: [
        {
          id: 'bm-wmt-fixture',
          underlying: 'WMT',
          occSymbol: fixtureCandidate.occSymbol,
          streamerSymbol: fixtureCandidate.streamerSymbol,
          savedAt: '2026-10-15T14:05:00.000Z',
          profileId: null,
          profileRevision: null,
          scanId: null,
          quoteAsOf: null,
          snapshot: fixtureCandidate,
        },
      ],
      warnings: [
        {
          id: 'bm-legacy',
          underlying: 'WMT',
          occSymbol: 'WMT   280121C00080000',
          savedAt: '2026-10-16T18:28:17.154Z',
          code: 'legacy-reconstructed',
          message:
            'Saved candidate WMT is missing recorded fields, shown as unavailable: observationFreshness. Nothing was estimated.',
          missingFields: ['observationFreshness'],
        },
      ],
    });
    renderFinder();
    expect(await screen.findByText(/Simulated sample — not live market data/i)).toBeInTheDocument();
    expect(await screen.findByText(/shown as unavailable: observationFreshness/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was estimated/)).toBeInTheDocument();
  });

  it('blocks invalid exploratory delta and accepts leading-dot values for demo scans', async () => {
    const user = userEvent.setup();
    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    mocks.createFinderScan.mockResolvedValue(
      scanFixture({
        tolerances: { ...SHOW_PROFILE_MISSES, name: 'Exploratory delta window', minLongDelta: '0.80' },
        message: 'Demo scan with exploratory delta.',
      }),
    );

    renderFinder();
    await user.click(screen.getByRole('button', { name: /Optional advanced filters/i }));
    const deltaField = screen.getByLabelText('Exploratory min delta');
    const start = screen.getByRole('button', { name: 'Find LEAPS' });

    await user.clear(deltaField);
    await user.type(deltaField, '1.5');
    expect(screen.getAllByText(/between 0 and 1/i).length).toBeGreaterThan(0);
    expect(start).toBeDisabled();
    expect(mocks.createFinderScan).not.toHaveBeenCalled();

    await user.clear(deltaField);
    await user.type(deltaField, '.80');
    expect(screen.queryByText(/Fix exploratory delta/i)).not.toBeInTheDocument();
    expect(start).toBeEnabled();

    await user.click(start);
    await waitFor(() => expect(mocks.createFinderScan).toHaveBeenCalledTimes(1));
    const request = mocks.createFinderScan.mock.calls[0][0] as { tolerances: { minLongDelta: string | null; loosensSavedProfile: boolean } };
    expect(request.tolerances.minLongDelta).toBe('0.80');
    expect(request.tolerances.loosensSavedProfile).toBe(false);
    expect((await screen.findAllByText('Demo scan with exploratory delta.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Near Match').length).toBeGreaterThan(0);
  });

  it('supports sort/filter, Scan More, compare, and bookmark after a demo scan', async () => {
    const user = userEvent.setup();
    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    const first = candidateFixture({ id: 'a', label: 'Near Match', outcome: 'near', metrics: { ...candidateFixture().metrics, purchaseCost: 5500, delta: 0.82 } });
    const second = candidateFixture({
      id: 'b',
      label: 'Outside Profile',
      outcome: 'outside-profile',
      occSymbol: 'DEMO  280121C00050000',
      ask: '48.00',
      metrics: { ...candidateFixture().metrics, purchaseCost: 4800, delta: 0.7 },
      usableForComparison: true,
    });
    mocks.createFinderScan.mockResolvedValue(
      scanFixture({
        candidates: [first, second],
        message: 'Partial coverage.',
        progress: {
          ...scanFixture().progress,
          exhausted: false,
          canScanMore: true,
          remaining: 5,
          notYetEvaluated: 5,
          coverageSummary: 'Partial coverage.',
          plain: {
            ...scanFixture().progress.plain,
            headline: 'Partial coverage.',
            batchStatus: 'batch-finished',
            notYetEvaluated: 5,
          },
        },
      }),
    );
    mocks.scanFinderMore.mockResolvedValue(
      scanFixture({
        message: 'Scan More complete.',
        candidates: [first, second, candidateFixture({ id: 'c', label: 'Exact Match', outcome: 'exact' })],
        progress: { ...scanFixture().progress, canScanMore: false, exhausted: true },
      }),
    );
    mocks.saveFinderBookmark.mockResolvedValue({
      id: 'bm-1',
      underlying: 'DEMO',
      occSymbol: first.occSymbol,
      streamerSymbol: first.streamerSymbol,
      savedAt: '2026-10-15T14:05:00.000Z',
      snapshot: first,
    });

    renderFinder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find LEAPS' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Find LEAPS' }));
    await waitFor(() => expect(mocks.createFinderScan).toHaveBeenCalled());
    expect((await screen.findAllByText(/Partial coverage/i)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Table View' }));
    expect(screen.getByLabelText('Matches to My Strategy')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort within groups')).toBeInTheDocument();
    expect(screen.getByText(/Matches to My Strategy groups evaluated contracts/i)).toBeInTheDocument();
    const resultsTable = screen.getByRole('columnheader', { name: 'Class' }).closest('table')!;

    const compareBoxes = within(resultsTable).getAllByRole('checkbox');
    await user.click(compareBoxes[0]!);
    await user.click(compareBoxes[1]!);
    expect(screen.getByRole('heading', { name: 'Side-by-side comparison' })).toBeInTheDocument();
    expect(screen.getByText(/factual differences only/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Scan More' }));
    expect((await screen.findAllByText('Scan More complete.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Eligible|Meets All Hard Requirements|Core Plan Fit/i).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByText(/Saved .* locally/i)).toBeInTheDocument();
    expect(mocks.saveFinderBookmark).toHaveBeenCalled();
  });

  it('acceptance 12: Finder preferences and compare selection survive navigation and refresh, per session', async () => {
    const user = userEvent.setup();
    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    const server = new Map<string, ResearchUiPrefs>([
      [
        'finder_1',
        { finderView: 'list', finderPresentation: 'advanced', finderSort: 'delta:higher', selectedCompareIds: ['a', 'gone'] },
      ],
    ]);
    const first = candidateFixture({ id: 'a' });
    const second = candidateFixture({ id: 'b', occSymbol: 'DEMO  280121C00050000' });
    const profiles = (await mocks.fetchStrategyProfiles()) as { profiles: Array<FinderResearchRestore['strategySnapshot']> };
    const restore = (): FinderResearchRestore => ({
      kind: 'finder',
      summary: {
        id: 'finder_1',
        scanType: 'finder',
        status: 'completed',
        universeId: null,
        universeVersionId: null,
        universeLabel: 'DEMO',
        profileId: 'sal-pmcc-deep-itm',
        profileName: 'Sal PMCC — Deep ITM',
        profileRevision: 1,
        scanPriority: 'closest-to-strategy',
        companiesProcessed: 1,
        companiesRemaining: 0,
        companiesInUniverse: 1,
        contractsEvaluated: 2,
        canScanNextCompanies: false,
        canScanMoreContracts: false,
        persistence: 'sqlite',
        simulated: true,
        startedAt: '2026-10-15T14:00:00.000Z',
        updatedAt: '2026-10-15T14:00:01.000Z',
        finishedAt: '2026-10-15T14:00:01.000Z',
        lastSuccessfulBatchAt: '2026-10-15T14:00:01.000Z',
        nextActionHint: 'Review saved results.',
        historicalNotice: 'Restored saved research.',
      },
      result: scanFixture({ scanId: 'finder_1', candidates: [first, second] }),
      strategySnapshot: profiles.profiles[0]!,
      evaluatedOcc: [first.occSymbol, second.occSymbol],
      uiPrefs: server.get('finder_1') ?? {},
      viewMode: 'view-saved',
    });
    mocks.fetchLatestResearchSession.mockImplementation(async (type: string) => {
      if (type !== 'finder') throw new Error('none');
      return restore();
    });
    mocks.patchResearchSessionUiPrefs.mockImplementation(async (id: string, body: { uiPrefs: ResearchUiPrefs }) => {
      server.set(id, body.uiPrefs);
      return { ok: true };
    });
    const tree = (showPage: boolean) => (
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <ResearchWorkspaceProvider>{showPage ? <LeapsFinderPage /> : <div>Elsewhere</div>}</ResearchWorkspaceProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    const isPressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

    const view = render(tree(true));
    await waitFor(() => expect(isPressed('Advanced Mode')).toBe('true'));
    expect(isPressed('Table View')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Highest delta');
    expect(screen.getByText(/1 saved comparison selection is not part of this session's results/)).toBeInTheDocument();
    await waitFor(() => expect(server.get('finder_1')?.selectedCompareIds).toEqual(['a']));

    await user.click(screen.getByRole('button', { name: 'Beginner Mode' }));
    await waitFor(() => expect(server.get('finder_1')?.finderPresentation).toBe('beginner'));
    expect(server.get('finder_1')?.finderView).toBe('gallery');

    view.rerender(tree(false));
    view.rerender(tree(true));
    await waitFor(() => expect(isPressed('Beginner Mode')).toBe('true'));
    expect(isPressed('Card View')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Table View' }));
    view.unmount();
    expect(server.get('finder_1')?.finderView).toBe('gallery');

    render(tree(true));
    await waitFor(() => expect(isPressed('Table View')).toBe('true'));
    expect(isPressed('Beginner Mode')).toBe('true');
    await waitFor(() => expect(server.get('finder_1')?.finderView).toBe('list'));
    expect(server.get('finder_1')?.selectedCompareIds).toEqual(['a']);
    expect(mocks.createFinderScan).not.toHaveBeenCalled();
    expect(mocks.scanFinderMore).not.toHaveBeenCalled();
  }, 30_000);

  it('restores a DEMO finder session from Recent Searches with coverage-matched Scan More and no provider calls', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    mocks.appState.status = 'ready';
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-15T20:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    const profiles = (await mocks.fetchStrategyProfiles()) as { profiles: Array<FinderResearchRestore['strategySnapshot']> };
    const partialCandidate = candidateFixture({ id: 'partial', label: 'Near Match', outcome: 'near' });
    const doneCandidate = candidateFixture({ id: 'done', label: 'Exact Match', outcome: 'exact', occSymbol: 'DEMO  280121C00060000' });
    const summary = (id: string, label: string, canScanMore: boolean, evaluated: number): FinderResearchRestore['summary'] => ({
      id,
      scanType: 'finder',
      status: 'completed',
      universeId: null,
      universeVersionId: null,
      universeLabel: label,
      profileId: 'sal-pmcc-deep-itm',
      profileName: 'Sal PMCC — Deep ITM',
      profileRevision: 1,
      scanPriority: 'closest-to-strategy',
      companiesProcessed: 1,
      companiesRemaining: 0,
      companiesInUniverse: 1,
      contractsEvaluated: evaluated,
      canScanNextCompanies: false,
      canScanMoreContracts: canScanMore,
      persistence: 'sqlite',
      simulated: true,
      startedAt: '2026-10-15T14:00:00.000Z',
      updatedAt: id === 'finder-demo-partial' ? '2026-10-15T15:00:00.000Z' : '2026-10-15T14:00:00.000Z',
      finishedAt: '2026-10-15T14:00:01.000Z',
      lastSuccessfulBatchAt: '2026-10-15T14:00:01.000Z',
      nextActionHint: canScanMore ? 'Unevaluated DEMO contracts remain.' : 'Saved DEMO coverage is complete.',
      historicalNotice: 'Restored saved research — not a live market refresh.',
    });
    const partial = (): FinderResearchRestore => ({
      kind: 'finder',
      summary: summary('finder-demo-partial', 'DEMO partial', true, 2),
      result: scanFixture({
        scanId: 'finder-demo-partial',
        message: 'DEMO partial coverage.',
        candidates: [partialCandidate],
        progress: {
          ...scanFixture().progress,
          canScanMore: true,
          exhausted: false,
          remaining: 6,
          notYetEvaluated: 6,
          evaluated: 2,
          coverageSummary: '2 of 8 DEMO contracts evaluated.',
          plain: { ...scanFixture().progress.plain, headline: 'DEMO partial: 2 of 8 evaluated.', notYetEvaluated: 6, batchStatus: 'batch-finished' },
        },
      }),
      strategySnapshot: profiles.profiles[0]!,
      evaluatedOcc: [partialCandidate.occSymbol],
      uiPrefs: { finderPresentation: 'advanced', finderView: 'list', finderSort: 'delta:higher', finderFilters: { outcome: 'near' } },
      viewMode: 'continue-ready',
    });
    const done = (): FinderResearchRestore => ({
      kind: 'finder',
      summary: summary('finder-demo-done', 'DEMO finished', false, 8),
      result: scanFixture({
        scanId: 'finder-demo-done',
        message: 'DEMO coverage complete.',
        candidates: [doneCandidate],
        progress: {
          ...scanFixture().progress,
          canScanMore: false,
          exhausted: true,
          remaining: 0,
          notYetEvaluated: 0,
          evaluated: 8,
          coverageSummary: '8 of 8 DEMO contracts evaluated.',
          plain: { ...scanFixture().progress.plain, headline: 'DEMO finished: 8 of 8 evaluated.', notYetEvaluated: 0 },
        },
      }),
      strategySnapshot: profiles.profiles[0]!,
      evaluatedOcc: [doneCandidate.occSymbol],
      uiPrefs: { finderPresentation: 'advanced', finderView: 'gallery', finderSort: 'purchaseCost:lower', finderFilters: { outcome: 'exact' } },
      viewMode: 'view-saved',
    });
    mocks.fetchResearchSessions.mockImplementation(async (type: string) => ({
      sessions: type === 'finder' ? [partial().summary, done().summary] : [],
    }));
    mocks.fetchLatestResearchSession.mockImplementation(async (type: string) => {
      if (type !== 'finder') throw new Error('none');
      return partial();
    });
    mocks.fetchResearchSession.mockImplementation(async (id: string) => (id === 'finder-demo-done' ? done() : partial()));

    const tree = (showFinder: boolean) => (
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <ResearchWorkspaceProvider>{showFinder ? <LeapsFinderPage /> : <div>My Positions</div>}</ResearchWorkspaceProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
    const view = render(tree(true));
    expect(await screen.findByText('DEMO partial: 2 of 8 evaluated.')).toBeInTheDocument();
    expect(screen.getByText(/SIMULATED DATA — NOT ACTUAL MARKET PRICES/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Highest delta');
    expect(screen.getByRole('combobox', { name: 'Class filter' })).toHaveTextContent('Near Match');
    expect(screen.getByRole('button', { name: 'Scan More' })).toBeEnabled();
    expect(screen.getByText(/Unevaluated DEMO contracts remain/)).toBeInTheDocument();

    const readsBeforeNav = mocks.fetchResearchSession.mock.calls.length;
    view.rerender(tree(false));
    expect(screen.getByText('My Positions')).toBeInTheDocument();
    view.rerender(tree(true));
    expect(await screen.findByText('DEMO partial: 2 of 8 evaluated.')).toBeInTheDocument();
    expect(mocks.fetchResearchSession.mock.calls.length).toBe(readsBeforeNav);
    expect(screen.getByRole('button', { name: 'Scan More' })).toBeEnabled();

    await user.click(screen.getAllByRole('button', { name: 'View Saved Results' })[1]!);
    expect(await screen.findByText('DEMO finished: 8 of 8 evaluated.')).toBeInTheDocument();
    expect(screen.getByText('Viewing saved Finder results — no provider request.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Card View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Class filter' })).toHaveTextContent('Exact Match');
    expect(screen.getByRole('button', { name: 'Scan More' })).toBeDisabled();
    expect(screen.getByText(/Saved DEMO coverage is complete/)).toBeInTheDocument();

    view.unmount();
    render(tree(true));
    expect(await screen.findByText('DEMO partial: 2 of 8 evaluated.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Highest delta');
    expect(screen.getByRole('combobox', { name: 'Class filter' })).toHaveTextContent('Near Match');
    expect(screen.getByRole('button', { name: 'Scan More' })).toBeEnabled();
    expect(mocks.createFinderScan).not.toHaveBeenCalled();
    expect(mocks.scanFinderMore).not.toHaveBeenCalled();
    expect(mocks.retryFinderMissingData).not.toHaveBeenCalled();
    localStorage.clear();
  }, 30_000);
});

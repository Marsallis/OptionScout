/**
 * Acceptance 12 (Discover): saved UI preferences survive route navigation and a full browser refresh,
 * stay scoped to their research session, and drop comparison selections that no longer exist.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPTANCE_SAVED_PROFILE,
  RESEARCH_HISTORICAL_NOTICE,
  listCuratedStarterUniverses,
  type DiscoverResearchRestore,
  type ResearchSessionSummary,
  type ResearchUiPrefs,
  type SessionView,
} from '@optionscout/shared';
import { buildDiscoverUxPreviewScan } from '../discoverUxPreview';
import { DiscoverOpportunitiesPage, resetDiscoverSelectionDraft } from '../pages/DiscoverOpportunitiesPage';
import { ResearchWorkspaceProvider } from '../state/ResearchWorkspace';
import { theme } from '../theme';
import { brokerFixture, settingsFixture } from './fixtures';

const mocks = vi.hoisted(() => ({
  appState: {
    status: 'ready' as const,
    session: null as SessionView | null,
    error: null as string | null,
    settings: null as unknown,
    broker: null as unknown,
  },
  server: new Map<string, ResearchUiPrefs>(),
  fetchStrategyProfiles: vi.fn(),
  fetchDiscoveryUniverses: vi.fn(),
  fetchSmartScanPolicy: vi.fn(),
  fetchResearchSessions: vi.fn(),
  fetchLatestResearchSession: vi.fn(),
  fetchResearchSession: vi.fn(),
  patchResearchSessionUiPrefs: vi.fn(),
  createSmartScan: vi.fn(),
  fetchSmartScan: vi.fn(),
}));

vi.mock('../state/AppState', () => ({ useAppState: () => mocks.appState }));

vi.mock('../api/client', () => ({
  fetchStrategyProfiles: mocks.fetchStrategyProfiles,
  fetchDiscoveryUniverses: mocks.fetchDiscoveryUniverses,
  fetchSmartScanPolicy: mocks.fetchSmartScanPolicy,
  fetchResearchSessions: mocks.fetchResearchSessions,
  fetchLatestResearchSession: mocks.fetchLatestResearchSession,
  fetchResearchSession: mocks.fetchResearchSession,
  patchResearchSessionUiPrefs: mocks.patchResearchSessionUiPrefs,
  deleteResearchSession: vi.fn(),
  createSmartScan: mocks.createSmartScan,
  fetchSmartScan: mocks.fetchSmartScan,
  scanSmartMore: vi.fn(),
  scanSmartNextCompanies: vi.fn(),
  retrySmartScanCompanies: vi.fn(),
  cancelSmartScan: vi.fn(),
  createDiscoveryUniverse: vi.fn(),
  deleteDiscoveryUniverse: vi.fn(),
  importDiscoveryUniverseCsv: vi.fn(),
  previewHoldingsCsvImport: vi.fn(),
  commitHoldingsCsvImport: vi.fn(),
  saveFinderBookmark: vi.fn(),
}));

const scanTemplate = buildDiscoverUxPreviewScan('completed');
const [wmt] = scanTemplate.candidates;

function summary(id: string, label: string): ResearchSessionSummary {
  return {
    id,
    scanType: 'discover',
    status: 'completed',
    universeId: 'saved-ivv',
    universeVersionId: 'saved-ivv@v1',
    universeLabel: label,
    profileId: ACCEPTANCE_SAVED_PROFILE.id,
    profileName: ACCEPTANCE_SAVED_PROFILE.name,
    profileRevision: ACCEPTANCE_SAVED_PROFILE.revision,
    scanPriority: 'closest-to-strategy',
    companiesProcessed: 3,
    companiesRemaining: 9,
    companiesInUniverse: 12,
    companiesRetryable: 0,
    activeBatchId: null,
    contractsEvaluated: 2,
    canScanNextCompanies: true,
    canScanMoreContracts: true,
    persistence: 'sqlite',
    simulated: true,
    startedAt: '2026-10-17T18:00:00.000Z',
    updatedAt: '2026-10-17T18:00:02.000Z',
    finishedAt: '2026-10-17T18:00:02.000Z',
    lastSuccessfulBatchAt: '2026-10-17T18:00:02.000Z',
    nextActionHint: 'Scan Next Companies when ready.',
    historicalNotice: RESEARCH_HISTORICAL_NOTICE,
  };
}

const SUMMARIES = [summary('sess_a', 'Session A collection'), summary('sess_b', 'Session B collection')];

function restore(id: string): DiscoverResearchRestore {
  const row = SUMMARIES.find((s) => s.id === id)!;
  return {
    kind: 'discover',
    summary: row,
    result: { ...scanTemplate, scanId: id, universeLabel: row.universeLabel, sessionPersistence: 'sqlite' },
    strategySnapshot: ACCEPTANCE_SAVED_PROFILE,
    orderedTickerQueue: scanTemplate.tickers.map((t) => t.ticker),
    companyCursor: 3,
    evaluatedOcc: scanTemplate.candidates.map((c) => c.occSymbol),
    uiPrefs: mocks.server.get(id) ?? {},
    viewMode: 'view-saved',
  };
}

function tree(showPage: boolean) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ResearchWorkspaceProvider>{showPage ? <DiscoverOpportunitiesPage /> : <div>Another page</div>}</ResearchWorkspaceProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function pressed(name: string): string | null {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed');
}

function patchesFor(id: string): ResearchUiPrefs[] {
  return mocks.patchResearchSessionUiPrefs.mock.calls
    .filter(([sessionId]) => sessionId === id)
    .map(([, body]) => (body as { uiPrefs: ResearchUiPrefs }).uiPrefs);
}

describe('Acceptance 12 — Discover preferences survive navigation and refresh', () => {
  beforeEach(() => {
    resetDiscoverSelectionDraft();
    mocks.server.clear();
    mocks.appState.session = {
      authenticated: true,
      ownerConfigured: true,
      expiresAt: '2026-10-17T23:00:00.000Z',
      csrfToken: 'csrf-test',
      publicSimulatedDemo: false,
    };
    mocks.appState.settings = { ...settingsFixture, portfolioView: 'brokerage' };
    mocks.appState.broker = brokerFixture;
    mocks.fetchStrategyProfiles.mockReset().mockResolvedValue({
      profiles: [ACCEPTANCE_SAVED_PROFILE],
      defaultProfileId: ACCEPTANCE_SAVED_PROFILE.id,
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
    mocks.fetchResearchSessions.mockReset().mockImplementation(async (type: string) => ({
      sessions: type === 'discover' ? SUMMARIES : [],
    }));
    mocks.fetchLatestResearchSession.mockReset().mockImplementation(async (type: string) => {
      if (type !== 'discover') throw new Error('No saved research session yet.');
      return restore('sess_a');
    });
    mocks.fetchResearchSession.mockReset().mockImplementation(async (id: string) => restore(id));
    mocks.patchResearchSessionUiPrefs.mockReset().mockImplementation(async (id: string, body: { uiPrefs: ResearchUiPrefs }) => {
      mocks.server.set(id, body.uiPrefs);
      return { ok: true };
    });
    mocks.createSmartScan.mockReset();
    mocks.fetchSmartScan.mockReset();
  });

  it('restores, persists, and scopes view/sort/compare across route changes and refresh without scans', async () => {
    const user = userEvent.setup();
    mocks.server.set('sess_a', {
      discoverView: 'list',
      discoverSortValue: 'delta',
      selectedCompareIds: [wmt!.id, 'contract-from-another-session'],
    });
    mocks.server.set('sess_b', { discoverView: 'list', discoverSortValue: 'dte' });

    const view = render(tree(true));
    await waitFor(() => expect(pressed('List')).toBe('true'));
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Highest delta');
    expect(screen.getByText(/1 saved comparison selection is not part of this session's results/)).toBeInTheDocument();
    // The incompatible selection is pruned and the correction is saved back to the same session.
    await waitFor(() => expect(patchesFor('sess_a').at(-1)?.selectedCompareIds).toEqual([wmt!.id]));

    await user.click(screen.getByRole('button', { name: 'Gallery' }));
    await waitFor(() => expect(patchesFor('sess_a').at(-1)?.discoverView).toBe('gallery'));

    // Route change: the provider survives, the page remounts.
    const restoreCalls = mocks.fetchLatestResearchSession.mock.calls.length;
    view.rerender(tree(false));
    expect(screen.getByText('Another page')).toBeInTheDocument();
    view.rerender(tree(true));
    await waitFor(() => expect(pressed('Gallery')).toBe('true'));
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Highest delta');
    expect(mocks.fetchLatestResearchSession.mock.calls.length).toBe(restoreCalls);

    // Change sort, then refresh before the debounced save can reach the server.
    await user.click(screen.getByRole('combobox', { name: 'Sort' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Lowest cost' }));
    expect(mocks.server.get('sess_a')?.discoverSortValue).toBe('delta');
    view.unmount();

    const refreshed = render(tree(true));
    await waitFor(() => expect(pressed('Gallery')).toBe('true'));
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Lowest cost');
    await waitFor(() => expect(mocks.server.get('sess_a')?.discoverSortValue).toBe('purchaseCost'));
    expect(mocks.server.get('sess_a')?.selectedCompareIds).toEqual([wmt!.id]);

    // Session scoping: B keeps its own preferences; A's are untouched.
    const patchesBefore = patchesFor('sess_b').length;
    await user.click(screen.getByRole('button', { name: 'Previous Results' }));
    await user.click(screen.getAllByRole('button', { name: 'View Saved Results' })[1]!);
    await waitFor(() => expect(pressed('List')).toBe('true'));
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Longest DTE');
    expect(patchesFor('sess_b').length).toBe(patchesBefore);

    await user.click(screen.getAllByRole('button', { name: 'View Saved Results' })[0]!);
    await waitFor(() => expect(pressed('Gallery')).toBe('true'));
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('Lowest cost');

    expect(mocks.createSmartScan).not.toHaveBeenCalled();
    refreshed.unmount();
  }, 30_000);

  it('restores selected tickers after navigation and refresh', async () => {
    const user = userEvent.setup();
    mocks.fetchLatestResearchSession.mockRejectedValue(new Error('No saved research session yet.'));
    const [starter] = listCuratedStarterUniverses();
    const small = { ...starter!, tickers: starter!.tickers.slice(0, 3) };
    mocks.fetchDiscoveryUniverses.mockResolvedValue({ curated: [small], saved: [], bookmarkDerived: null });
    const view = render(tree(true));
    const addTicker = await screen.findByLabelText('Add ticker');
    await screen.findByRole('checkbox', { name: new RegExp(small.tickers[0]!) });
    await user.type(addTicker, 'brk-b');
    await user.click(screen.getByRole('button', { name: 'Add Ticker' }));
    expect(await screen.findByRole('button', { name: /^BRK\.B/ })).toBeInTheDocument();

    await user.type(addTicker, 'BAD$');
    await user.click(screen.getByRole('button', { name: 'Add Ticker' }));
    const invalid = await screen.findByText(/Invalid ticker format: BAD\$/);
    expect(invalid.textContent?.match(/Invalid ticker format/g)).toHaveLength(1);
    expect(invalid.textContent).toMatch(/never altered/i);

    let loads = mocks.fetchDiscoveryUniverses.mock.calls.length;
    view.rerender(tree(false));
    view.rerender(tree(true));
    await waitFor(() => expect(mocks.fetchDiscoveryUniverses.mock.calls.length).toBeGreaterThan(loads));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await screen.findByRole('button', { name: /^BRK\.B/ })).toBeInTheDocument();
    view.unmount();

    loads = mocks.fetchDiscoveryUniverses.mock.calls.length;
    render(tree(true));
    await waitFor(() => expect(mocks.fetchDiscoveryUniverses.mock.calls.length).toBeGreaterThan(loads));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await screen.findByRole('button', { name: /^BRK\.B/ })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: new RegExp(small.tickers[0]!) }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/BAD\$/)).not.toBeInTheDocument();
  }, 20_000);

  it('keeps checked companies when navigating away from Explore Stocks and back', async () => {
    const user = userEvent.setup();
    mocks.fetchLatestResearchSession.mockRejectedValue(new Error('No saved research session yet.'));
    const [starter] = listCuratedStarterUniverses();
    const small = { ...starter!, tickers: starter!.tickers.slice(0, 3) };
    mocks.fetchDiscoveryUniverses.mockResolvedValue({ curated: [small], saved: [], bookmarkDerived: null });
    const ticker = small.tickers[0]!;

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <ResearchWorkspaceProvider>
            <Routes>
              <Route path="/discover" element={<DiscoverOpportunitiesPage />} />
              <Route
                path="/leaps"
                element={
                  <div>
                    Finder page
                    <Link to="/discover">Back to Explore</Link>
                  </div>
                }
              />
            </Routes>
          </ResearchWorkspaceProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const checkbox = await screen.findByRole('checkbox', { name: new RegExp(ticker) });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/Selected 1\/20/)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Find One Stock' }));
    expect(await screen.findByText('Finder page')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: new RegExp(ticker) })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to Explore' }));
    const restored = await screen.findByRole('checkbox', { name: new RegExp(ticker) });
    expect(restored).toBeChecked();
    expect(screen.getByText(/Selected 1\/20/)).toBeInTheDocument();
    expect(mocks.createSmartScan).not.toHaveBeenCalled();
  }, 20_000);

  it('keeps an added ticker when the company list has not loaded', async () => {
    const user = userEvent.setup();
    mocks.fetchLatestResearchSession.mockRejectedValue(new Error('No saved research session yet.'));
    mocks.fetchDiscoveryUniverses.mockRejectedValue(new Error('Sign in required'));

    render(
      <MemoryRouter initialEntries={['/discover']}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <ResearchWorkspaceProvider>
            <Routes>
              <Route path="/discover" element={<DiscoverOpportunitiesPage />} />
              <Route
                path="/leaps"
                element={
                  <div>
                    Finder page
                    <Link to="/discover">Back to Explore</Link>
                  </div>
                }
              />
            </Routes>
          </ResearchWorkspaceProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );

    const addTicker = await screen.findByLabelText('Add ticker');
    await user.type(addTicker, 'aapl');
    await user.click(screen.getByRole('button', { name: 'Add Ticker' }));
    expect(await screen.findByRole('button', { name: /^AAPL/ })).toBeInTheDocument();
    expect(screen.getByText(/Selected 1\/20/)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Find One Stock' }));
    expect(await screen.findByText('Finder page')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to Explore' }));
    expect(await screen.findByRole('button', { name: /^AAPL/ })).toBeInTheDocument();
    expect(screen.getByText(/Selected 1\/20/)).toBeInTheDocument();
    expect(mocks.createSmartScan).not.toHaveBeenCalled();
  }, 20_000);
});

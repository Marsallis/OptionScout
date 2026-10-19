import { useEffect, useMemo, useState } from 'react';
import {
  DISCOVERY_METRICS,
  DISCOVERY_OUTCOME_LABELS,
  FINDER_METRIC_TOOLTIPS,
  FINDER_PROGRESS_CHIP_TOOLTIPS,
  SAL_PMCC_DEEP_ITM,
  SCAN_MORE_PRIORITIES,
  SCAN_MORE_PRIORITY_LABELS,
  SHOW_PROFILE_MISSES,
  TRADEOFF_CRITERION_LABELS,
  assessCandidate,
  assignRankingBadges,
  buildPlanFitSummary,
  explainContractTradeoff,
  exploreTradeoffs,
  filterDiscovery,
  formatContractDisplay,
  formatDelta,
  formatPercentMetric,
  formatSpreadDisplay,
  formatUsd,
  greekVerificationLabel,
  groupCandidatesForStrategyMatch,
  isUnverifiedOrIncompleteCandidate,
  isVerifiedConfiguredMatch,
  normalizeExploratoryDelta,
  observationFreshnessLabel,
  paretoFront,
  resolveFinderSearchState,
  sortDiscovery,
  summarizePreferenceGaps,
  toTradeoffView,
  type DiscoveryMetric,
  type DiscoveryOutcome,
  type DiscoveryRow,
  type DiscoveryTolerances,
  type FactualSortMetric,
  type FinderBookmark,
  type FinderBookmarkWarning,
  type FinderCandidate,
  type FinderScanResult,
  type PlanFitRankingBadge,
  type ScanMorePriority,
  type StrategyMatchGroupId,
  type StrategyProfile,
  type TradeoffCriterion,
} from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  cancelFinderScan,
  createFinderScan,
  deleteFinderBookmark,
  fetchFinderBookmarks,
  fetchStrategyProfiles,
  retryFinderMissingData,
  saveFinderBookmark,
  scanFinderMore,
} from '../api/client';
import { CandidateResultCard } from '../components/CandidateResultCard';
import { CompareTray } from '../components/CompareTray';
import { ContractComparisonPanel } from '../components/ContractComparisonPanel';
import { ContractReviewPanel } from '../components/ContractReviewPanel';
import { PmccExplainer } from '../components/PmccExplainer';
import { useAppState } from '../state/AppState';
import { useResearchWorkspace } from '../state/ResearchWorkspace';
import { RecentSearchesPanel } from '../components/RecentSearchesPanel';
import { Link as RouterLink } from 'react-router-dom';
import Link from '@mui/material/Link';

const FINDER_TICKER_DRAFT_KEY = 'optionscout.finderTickerDraft';

const BEGINNER_SORT_OPTIONS: ReadonlyArray<{ metric: FactualSortMetric; label: string }> = [
  { metric: 'purchaseCost', label: 'Lowest estimated cost' },
  { metric: 'preferred-cost-distance', label: 'Closest to preferred budget' },
  { metric: 'delta', label: 'Highest delta' },
  { metric: 'intrinsicPercent', label: 'Highest intrinsic %' },
  { metric: 'extrinsicValue', label: 'Lowest extrinsic value' },
  { metric: 'dte', label: 'Longest expiration' },
  { metric: 'bidAskSpread', label: 'Tightest bid/ask spread' },
];

const MATCH_GROUP_FILTERS: ReadonlyArray<{ id: 'all' | StrategyMatchGroupId; label: string }> = [
  { id: 'all', label: 'All strategy groups' },
  { id: 'eligible-all-prefs-met', label: 'Eligible — All Preferences Met' },
  { id: 'eligible-preference-differences', label: 'Eligible — Preference Differences' },
  { id: 'cannot-verify', label: 'Cannot Verify Eligibility' },
  { id: 'outside-strategy', label: 'Outside My Strategy' },
  { id: 'invalid-data', label: 'Invalid or Inconsistent Data' },
];

const SORT_OPTIONS: Array<{ metric: DiscoveryMetric; direction: 'higher' | 'lower'; label: string }> = [
  { metric: 'purchaseCost', direction: 'lower', label: 'Lowest capital required' },
  { metric: 'delta', direction: 'higher', label: 'Highest delta' },
  { metric: 'intrinsicPercent', direction: 'higher', label: 'Highest intrinsic %' },
  { metric: 'extrinsicValue', direction: 'lower', label: 'Lowest extrinsic value' },
  { metric: 'bidAskSpread', direction: 'lower', label: 'Tightest bid/ask spread' },
  { metric: 'liquidity', direction: 'higher', label: 'Best available liquidity' },
  { metric: 'dte', direction: 'higher', label: 'Longest expiration' },
  { metric: 'dte', direction: 'lower', label: 'Shortest eligible expiration' },
  { metric: 'theta', direction: 'higher', label: 'Lowest relative theta decay (less negative)' },
  { metric: 'downsideMoneyness', direction: 'higher', label: 'Best downside moneyness' },
];

function candidateToRow(candidate: FinderCandidate): DiscoveryRow {
  const metrics = Object.fromEntries(DISCOVERY_METRICS.map((metric) => [metric, candidate.metrics[metric] ?? null])) as DiscoveryRow['metrics'];
  return {
    id: candidate.id,
    underlying: candidate.underlying,
    symbol: candidate.occSymbol,
    outcome: candidate.outcome,
    label: candidate.label,
    visible: true,
    usableForComparison: candidate.usableForComparison,
    withinExploration: candidate.withinExploration,
    reasons: candidate.reasons as DiscoveryRow['reasons'],
    metrics,
    pmccReason: candidate.pmccReason ?? 'No short call was supplied for comparison.',
  };
}

function outcomeColor(outcome: DiscoveryOutcome): 'success' | 'info' | 'warning' | 'default' {
  if (outcome === 'exact') return 'success';
  if (outcome === 'near') return 'info';
  if (outcome === 'outside-profile') return 'warning';
  return 'default';
}

function contractTitle(candidate: FinderCandidate): string {
  return formatContractDisplay({
    underlying: candidate.underlying,
    strike: candidate.strike,
    optionType: candidate.optionType,
    expiration: candidate.expiration,
  });
}

function preferenceGapColor(severity: 'met' | 'small' | 'significant' | 'none'): 'default' | 'info' | 'warning' {
  if (severity === 'small') return 'info';
  if (severity === 'significant') return 'warning';
  return 'default';
}

/** Detect demo/fixture bookmarks so they are never shown as live market opportunities. */
function isSimulatedBookmark(bookmark: FinderBookmark): boolean {
  if (bookmark.underlying.trim().toUpperCase() === 'DEMO') return true;
  const quoteLabel = bookmark.snapshot.calculations.quoteSourceLabel.toLowerCase();
  return quoteLabel.includes('simulated') || quoteLabel.includes('fixture') || quoteLabel.includes('demo');
}

export function LeapsFinderPage() {
  const { status, session, error, settings, broker } = useAppState();
  const research = useResearchWorkspace();
  const [ticker, setTicker] = useState(() => {
    try {
      return localStorage.getItem(FINDER_TICKER_DRAFT_KEY) || 'DEMO';
    } catch {
      return 'DEMO';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FINDER_TICKER_DRAFT_KEY, ticker);
    } catch {
      /* storage unavailable */
    }
  }, [ticker]);
  const [busy, setBusy] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const scan = research.finder.scan;
  const notice = localNotice ?? research.finder.notice;
  const setNotice = (value: string | null) => {
    setLocalNotice(value);
    research.setFinderNotice(value);
  };
  const setScan = (result: FinderScanResult | null) => {
    research.setFinderScan(result, { notice: result?.message ?? null });
  };
  const [bookmarks, setBookmarks] = useState<FinderBookmark[]>([]);
  const [bookmarkWarnings, setBookmarkWarnings] = useState<FinderBookmarkWarning[]>([]);
  const [profiles, setProfiles] = useState<StrategyProfile[]>([SAL_PMCC_DEEP_ITM]);
  const [profilesFromServer, setProfilesFromServer] = useState(false);
  const [profileId, setProfileId] = useState(SAL_PMCC_DEEP_ITM.id);
  const [scanPriority, setScanPriority] = useState<ScanMorePriority>('closest-to-strategy');
  const [showTechnicalProgress, setShowTechnicalProgress] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const finderPrefs = research.finder.uiPrefs;
  const finderFilterPrefs = finderPrefs.finderFilters ?? {};
  const updateFinderPrefs = research.updateFinderUiPrefs;
  const updateFinderFilterPrefs = (patch: Record<string, unknown>) =>
    updateFinderPrefs((current) => ({ finderFilters: { ...(current.finderFilters ?? {}), ...patch } }));
  const outcomeFilter: 'all' | DiscoveryOutcome =
    typeof finderFilterPrefs.outcome === 'string' && finderFilterPrefs.outcome in DISCOVERY_OUTCOME_LABELS
      ? (finderFilterPrefs.outcome as DiscoveryOutcome)
      : 'all';
  const setOutcomeFilter = (value: 'all' | DiscoveryOutcome) => updateFinderFilterPrefs({ outcome: value });
  const sortKey = SORT_OPTIONS.some((option) => `${option.metric}:${option.direction}` === finderPrefs.finderSort)
    ? finderPrefs.finderSort!
    : 'purchaseCost:lower';
  const setSortKey = (value: string) => updateFinderPrefs({ finderSort: value });
  const beginnerSortMetric: FactualSortMetric =
    BEGINNER_SORT_OPTIONS.find((option) => option.metric === finderFilterPrefs.beginnerSort)?.metric ?? 'purchaseCost';
  const setBeginnerSortMetric = (value: FactualSortMetric) => updateFinderFilterPrefs({ beginnerSort: value });
  const matchGroupFilter: 'all' | StrategyMatchGroupId =
    MATCH_GROUP_FILTERS.find((option) => option.id === finderFilterPrefs.matchGroup)?.id ?? 'all';
  const setMatchGroupFilter = (value: 'all' | StrategyMatchGroupId) => updateFinderFilterPrefs({ matchGroup: value });
  const [exploreDelta, setExploreDelta] = useState('');
  const withinExplorationOnly = finderFilterPrefs.withinExplorationOnly === true;
  const setWithinExplorationOnly = (value: boolean) => updateFinderFilterPrefs({ withinExplorationOnly: value });
  const selectedIds = research.finder.selectedIds;
  const setSelectedIds = research.setFinderSelectedIds;
  const [detailId, setDetailId] = useState<string | null>(null);
  const presentationMode: 'beginner' | 'advanced' = finderPrefs.finderPresentation === 'advanced' ? 'advanced' : 'beginner';
  const setPresentationMode = (value: 'beginner' | 'advanced') => updateFinderPrefs({ finderPresentation: value });
  const resultsView: 'cards' | 'table' = finderPrefs.finderView === 'list' ? 'table' : 'cards';
  const setResultsView = (value: 'cards' | 'table') =>
    updateFinderPrefs({ finderView: value === 'table' ? 'list' : 'gallery' });
  const [showTradeoffs, setShowTradeoffs] = useState(false);
  const [paretoMetrics, setParetoMetrics] = useState<DiscoveryMetric[]>([]);
  const [showParetoMarkers, setShowParetoMarkers] = useState(false);
  const [tradeoffCriteria, setTradeoffCriteria] = useState<TradeoffCriterion[]>(['best-within-budget']);
  const [draftMaxCost, setDraftMaxCost] = useState('7000');
  const [draftMinDelta, setDraftMinDelta] = useState('0.75');
  const beginnerMode = presentationMode === 'beginner';

  const deltaValidation = useMemo(() => normalizeExploratoryDelta(exploreDelta), [exploreDelta]);
  const deltaFieldError = deltaValidation.ok ? null : deltaValidation.error;
  const searchState = resolveFinderSearchState({
    authenticated: session?.authenticated === true,
    portfolioView: settings?.portfolioView === 'brokerage' ? 'brokerage' : 'demo',
    ticker,
    deltaInvalid: Boolean(deltaFieldError),
    busy,
    finderLiveScanInstallAllowed: settings?.finderLiveScanInstallAllowed === true,
    finderOnDemandSearchEnabled: settings?.finderOnDemandSearchEnabled === true,
    brokerageLiveConfigured: broker?.connection.liveEnabled === true && broker.connection.secretFilePresent,
    brokerageConnectedThisProcess: broker?.connection.state === 'connected',
  });

  const tolerances: DiscoveryTolerances = useMemo(() => {
    const delta = deltaValidation.ok ? deltaValidation.value : null;
    return {
      ...SHOW_PROFILE_MISSES,
      name: delta ? 'Exploratory delta window' : SHOW_PROFILE_MISSES.name,
      note: delta
        ? 'Exploratory window only. It does not change the saved Sal PMCC — Deep ITM profile.'
        : SHOW_PROFILE_MISSES.note,
      minLongDelta: delta,
    };
  }, [deltaValidation]);

  useEffect(() => {
    if (!session?.authenticated) {
      setBookmarks([]);
      setBookmarkWarnings([]);
      setProfiles([SAL_PMCC_DEEP_ITM]);
      setProfilesFromServer(false);
      return;
    }
    void fetchFinderBookmarks()
      .then((result) => {
        setBookmarks(result.bookmarks);
        setBookmarkWarnings(result.warnings);
      })
      .catch(() => {
        setBookmarks([]);
        setBookmarkWarnings([]);
      });
    void fetchStrategyProfiles()
      .then((result) => {
        setProfiles(result.profiles);
        setProfilesFromServer(result.profiles.length > 0);
        setProfileId(result.defaultProfileId);
      })
      .catch(() => {
        setProfiles([SAL_PMCC_DEEP_ITM]);
        setProfilesFromServer(false);
      });
  }, [session?.authenticated]);

  const activeProfile = profiles.find((row) => row.id === profileId) ?? profiles[0] ?? SAL_PMCC_DEEP_ITM;
  const scanProfile =
    scan != null ? (profiles.find((row) => row.id === scan.profileId) ?? activeProfile) : activeProfile;
  const strategyMismatch =
    scan != null && (scan.profileId !== profileId || scan.scanPriority !== scanPriority);
  const verifiedMatchCount = useMemo(
    () => (scan?.candidates ?? []).filter(isVerifiedConfiguredMatch).length,
    [scan],
  );
  const nearMatchCount = useMemo(
    () => (scan?.candidates ?? []).filter((row) => row.outcome === 'near').length,
    [scan],
  );
  const unverifiedCount = useMemo(
    () => (scan?.candidates ?? []).filter(isUnverifiedOrIncompleteCandidate).length,
    [scan],
  );

  // All hooks below must run on every render (including loading/error) to avoid React #310.
  const strategyGroups = useMemo(() => {
    if (!scan || !beginnerMode) return [];
    const discoveryRows = scan.candidates.map(candidateToRow);
    const filtered = filterDiscovery(discoveryRows, {
      outcomes: outcomeFilter === 'all' ? undefined : [outcomeFilter],
      withinExplorationOnly,
    });
    const byId = new Map(scan.candidates.map((candidate) => [candidate.id, candidate]));
    const candidates = filtered
      .map((row) => byId.get(row.id))
      .filter((row): row is FinderCandidate => Boolean(row));
    const groups = groupCandidatesForStrategyMatch(candidates, scanProfile, beginnerSortMetric);
    if (matchGroupFilter === 'all') return groups;
    return groups.filter((group) => group.id === matchGroupFilter);
  }, [scan, outcomeFilter, withinExplorationOnly, beginnerMode, scanProfile, beginnerSortMetric, matchGroupFilter]);

  const rows = useMemo(() => {
    if (!scan) return [];
    const discoveryRows = scan.candidates.map(candidateToRow);
    const filtered = filterDiscovery(discoveryRows, {
      outcomes: outcomeFilter === 'all' ? undefined : [outcomeFilter],
      withinExplorationOnly,
    });
    if (beginnerMode) {
      return strategyGroups.flatMap((group) => group.candidates.map(candidateToRow));
    }
    const [metric, direction] = sortKey.split(':') as [DiscoveryMetric, 'higher' | 'lower'];
    return sortDiscovery(filtered, metric, direction);
  }, [scan, outcomeFilter, sortKey, withinExplorationOnly, beginnerMode, strategyGroups]);

  const topPairTradeoff = useMemo(() => {
    if (!beginnerMode || strategyGroups.length === 0) return null;
    const firstGroup = strategyGroups[0];
    if (!firstGroup || firstGroup.candidates.length < 2) return null;
    if (
      firstGroup.id !== 'eligible-all-prefs-met' &&
      firstGroup.id !== 'eligible-preference-differences'
    ) {
      return null;
    }
    return explainContractTradeoff(firstGroup.candidates[0]!, firstGroup.candidates[1]!, scanProfile);
  }, [beginnerMode, strategyGroups, scanProfile]);

  const candidateById = useMemo(() => {
    const map = new Map<string, FinderCandidate>();
    for (const candidate of scan?.candidates ?? []) map.set(candidate.id, candidate);
    return map;
  }, [scan]);

  const rankingBadges = useMemo((): Map<string, PlanFitRankingBadge[]> => {
    if (!scan || !beginnerMode) return new Map();
    const candidates = rows
      .map((row) => candidateById.get(row.id))
      .filter((row): row is FinderCandidate => Boolean(row));
    return assignRankingBadges(candidates, scanProfile);
  }, [scan, beginnerMode, rows, candidateById, scanProfile]);

  const selectedCandidates = selectedIds.map((id) => candidateById.get(id)).filter(Boolean) as FinderCandidate[];
  const paretoIds = useMemo(() => {
    if (!scan || paretoMetrics.length === 0) return new Set<string>();
    const objectives = paretoMetrics.map((metric) => ({
      metric,
      direction: (metric === 'purchaseCost' || metric === 'extrinsicValue' || metric === 'bidAskSpread' ? 'lower' : 'higher') as 'higher' | 'lower',
    }));
    return new Set(paretoFront(scan.candidates.map(candidateToRow), objectives).map((row) => row.id));
  }, [scan, paretoMetrics]);

  const tradeoffExplorer = useMemo(() => {
    if (!scan) return null;
    const views = scan.candidates.filter((row) => row.supportStatus === 'supported').map(toTradeoffView);
    const maxCost = draftMaxCost.trim() === '' ? null : Number(draftMaxCost);
    const minDelta = draftMinDelta.trim() === '' ? null : Number(draftMinDelta);
    return exploreTradeoffs(
      views,
      tradeoffCriteria,
      {
        maxContractCost: maxCost != null && Number.isFinite(maxCost) ? maxCost : null,
        minLongDelta: minDelta != null && Number.isFinite(minDelta) ? minDelta : null,
      },
      {
        remainingUnevaluated: scan.progress.notYetEvaluated,
        hardMaxBudget: 7000,
        hardMinDelta: 0.75,
      },
    );
  }, [scan, tradeoffCriteria, draftMaxCost, draftMinDelta]);

  if (status === 'loading') {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 4 }}>
        <CircularProgress size={22} />
        <Typography>Loading Find One Stock.</Typography>
      </Stack>
    );
  }

  if (status === 'error') {
    return <Alert severity="error">{error ?? 'LEAPS Finder is unavailable.'}</Alert>;
  }

  async function runSearch(): Promise<void> {
    if (!deltaValidation.ok) {
      setNotice(deltaValidation.error);
      return;
    }
    setBusy(true);
    setNotice(null);
    setSelectedIds([]);
    setDetailId(null);
    try {
      const result = await createFinderScan({
        underlying: ticker.trim().toUpperCase(),
        profileId: activeProfile.id,
        tolerances,
        scanPriority,
      });
      setScan(result);
      setNotice(result.progress.plain.headline);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Scan failed.';
      setNotice(message.includes('Zod') || message.includes('minLongDelta') ? 'Exploratory delta is invalid. Use a value like 0.65 or 0.80, or leave it blank.' : message);
    } finally {
      setBusy(false);
    }
  }

  async function requestCancel(): Promise<void> {
    if (!scan) return;
    setBusy(true);
    try {
      const result = await cancelFinderScan(scan.scanId);
      setScan(result);
      setNotice(result.message);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  }

  async function requestScanMore(): Promise<void> {
    if (!scan) return;
    if (scan.profileId !== profileId) {
      setNotice(
        `This scan is locked to strategy “${scan.profileName}” revision ${scan.profileRevision}. Changing strategy requires Find LEAPS for a new scan — Scan More will not mix profile versions.`,
      );
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await scanFinderMore(scan.scanId, 24, scanPriority);
      setScan(result);
      setNotice(result.progress.plain.headline);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Scan More failed.');
    } finally {
      setBusy(false);
    }
  }

  async function requestRetryMissing(): Promise<void> {
    if (!scan) return;
    setBusy(true);
    setNotice(null);
    try {
      const beforeIncomplete = scan.candidates.filter((row) => row.outcome === 'incomplete').length;
      const beforeMissingGreeks = scan.progress.missingProviderGreeks;
      const result = await retryFinderMissingData(scan.scanId, 8);
      setScan(result);
      const afterIncomplete = result.candidates.filter((row) => row.outcome === 'incomplete').length;
      const afterMissingGreeks = result.progress.missingProviderGreeks;
      const retryNote = result.coverageNotes.find((note) => note.code === 'retry-missing-data');
      const obtained =
        afterIncomplete < beforeIncomplete || afterMissingGreeks < beforeMissingGreeks
          ? 'At least one previously incomplete row received updated observations.'
          : 'No new complete observations replaced the missing fields (provider may still omit Greeks/quotes).';
      setNotice(
        `${retryNote?.text ?? result.message} ${obtained} Incomplete rows: ${beforeIncomplete} → ${afterIncomplete}. Missing Greeks: ${beforeMissingGreeks} → ${afterMissingGreeks}.`,
      );
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Retry Missing Data failed.');
    } finally {
      setBusy(false);
    }
  }

  async function bookmark(candidate: FinderCandidate): Promise<void> {
    try {
      const saved = await saveFinderBookmark(candidate, {
        profileId: scan?.profileId,
        profileRevision: scan?.profileRevision,
        scanId: scan?.scanId,
      });
      setBookmarks((current) => [saved, ...current.filter((row) => row.occSymbol !== saved.occSymbol)]);
      setNotice(`Saved ${contractTitle(saved.snapshot)} locally. This is not a brokerage position.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Bookmark failed.');
    }
  }

  async function removeBookmark(id: string): Promise<void> {
    try {
      await deleteFinderBookmark(id);
      setBookmarks((current) => current.filter((row) => row.id !== id));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Remove failed.');
    }
  }

  function toggleCompare(id: string, checked: boolean): void {
    const current = selectedIds;
    if (!checked) {
      setSelectedIds(current.filter((item) => item !== id));
      return;
    }
    if (current.includes(id) || current.length >= 4) return;
    setSelectedIds([...current, id]);
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1.5, alignItems: { md: 'center' } }}>
        <Box>
          <Typography variant="h4" component="h1">
            Find One Stock
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Look at long-dated calls on one company. That includes a fund ticker such as VTI. To search the companies held
            inside a fund, use Explore Stock Groups.
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={presentationMode}
          onChange={(_event, value: 'beginner' | 'advanced' | null) => {
            if (value) {
              setPresentationMode(value);
              if (value === 'advanced') setResultsView('table');
              if (value === 'beginner') setResultsView('cards');
            }
          }}
        >
          <ToggleButton value="beginner">Beginner Mode</ToggleButton>
          <ToggleButton value="advanced">Advanced Mode</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <RecentSearchesPanel
        title="Recent Finder searches"
        sessions={research.recentFinder}
        activeId={scan?.scanId}
        onContinueLast={() => {
          void research.restoreFinderLatest();
        }}
        onViewSaved={(id) => {
          void research.restoreFinderById(id).then(() => setLocalNotice('Viewing saved Finder results — no provider request.'));
        }}
        onStartFresh={() => {
          research.clearFinderActive();
          setLocalNotice('Ready for a new Finder search. Saved sessions remain in Recent Searches.');
        }}
        onDelete={(id) => {
          void research.removeSession(id);
        }}
        onOpen={(id) => {
          void research.restoreFinderById(id);
        }}
      />
      <Alert severity="info" icon={false}>
        Enter a ticker, choose a strategy, and click <strong>Find LEAPS</strong> to review long-dated calls against your saved rules.
        Matching a rule is not a claim that a contract is safe or profitable.{' '}
        <Link component={RouterLink} to="/strategies">
          Edit Strategy
        </Link>
      </Alert>
      <Alert severity="warning" icon={false}>
        Long calls can lose their entire premium. Intrinsic value is not protected capital. Quotes are research snapshots — not verified
        fills.
      </Alert>
      {!searchState.canSearch ? (
        <Alert severity={searchState.severity} icon={false}>
          <Typography variant="subtitle2">{searchState.title}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {searchState.message} {searchState.nextStep}
            {searchState.primaryHref ? (
              <>
                {' '}
                <Link component={RouterLink} to={searchState.primaryHref}>
                  {searchState.blocker === 'signed-out' || searchState.blocker === 'brokerage-unavailable'
                    ? 'Go to Broker & Data'
                    : 'Open Settings'}
                </Link>
              </>
            ) : null}
          </Typography>
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity={scan?.status === 'failed' ? 'error' : 'info'}>
          {notice}
          {scan?.status === 'failed' ? (
            <Button size="small" sx={{ ml: 1 }} disabled={!searchState.canSearch || busy} onClick={() => void runSearch()}>
              Retry
            </Button>
          ) : null}
        </Alert>
      ) : null}
      {strategyMismatch ? (
        <Alert severity="warning" icon={false}>
          Strategy or scan priority changed since this scan started (locked to “{scan?.profileName}” rev {scan?.profileRevision},
          priority “{scan ? SCAN_MORE_PRIORITY_LABELS[scan.scanPriority].label : ''}”). Scan More can reprioritize the remaining
          queue with the priority dropdown, but a different saved strategy requires Find LEAPS so results are not mixed across
          profile versions.
        </Alert>
      ) : null}

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack spacing={1.5} direction={{ xs: 'column', md: 'row' }} sx={{ alignItems: { md: 'flex-end' }, flexWrap: 'wrap' }}>
          <TextField
            label="Stock ticker"
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            helperText={
              settings?.portfolioView === 'brokerage'
                ? 'Examples: CVX, QCOM, AAPL, WMT'
                : 'Demo mode: DEMO only. Switch portfolio view in Settings for live tickers.'
            }
            sx={{ minWidth: 160 }}
            inputProps={{ maxLength: 12 }}
          />
          <TextField
            select
            label="Selected strategy"
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            helperText={`${activeProfile.name} · revision ${activeProfile.revision}`}
            sx={{ minWidth: 260 }}
          >
            {profiles.map((row) => (
              <MenuItem key={row.id} value={row.id}>
                {row.name}
                {row.isDefault ? ' (default)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <Button component={RouterLink} to="/strategies" variant="outlined">
            Edit Strategy
          </Button>
        </Stack>
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          <Typography variant="body2">
            Selected profile: <strong>{activeProfile.name}</strong> · revision {activeProfile.revision}
            {!profilesFromServer ? ' (built-in template preview — sign in to load your saved revision)' : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Hard requirements: max cost ${Number(activeProfile.hard.maxContractCost).toLocaleString('en-US')}, min DTE{' '}
            {activeProfile.hard.minExpirationDays}, min delta {activeProfile.hard.minLongDelta}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Preferences: preferred delta {activeProfile.preferences.preferredLongDelta}, intrinsic{' '}
            {activeProfile.preferences.minIntrinsicPercent}%
          </Typography>
        </Stack>
        <Stack spacing={1.5} direction={{ xs: 'column', md: 'row' }} sx={{ mt: 1.5, alignItems: { md: 'flex-end' }, flexWrap: 'wrap' }}>
          <Button variant="text" onClick={() => setShowAdvancedFilters((value) => !value)}>
            {showAdvancedFilters ? 'Hide advanced filters' : 'Optional advanced filters'}
          </Button>
          {searchState.primaryHref && !searchState.canSearch ? (
            <Button component={RouterLink} to={searchState.primaryHref} variant="contained">
              {searchState.primaryLabel}
            </Button>
          ) : (
            <Button variant="contained" disabled={!searchState.canSearch} onClick={() => void runSearch()}>
              {searchState.primaryLabel}
            </Button>
          )}
          <Button variant="outlined" disabled={busy || !scan?.progress.canScanMore} onClick={() => void requestScanMore()}>
            Scan More
          </Button>
          <Button
            variant="outlined"
            disabled={busy || !scan?.progress.canRetryMissingData}
            onClick={() => void requestRetryMissing()}
          >
            Retry Missing Data
          </Button>
          <Button variant="outlined" disabled={busy || !scan || scan.status !== 'running'} onClick={() => void requestCancel()}>
            Cancel
          </Button>
        </Stack>
        <Collapse in={showAdvancedFilters || !beginnerMode}>
          <Stack spacing={1.5} direction={{ xs: 'column', md: 'row' }} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
            <TextField
              select
              label="Scan priority"
              value={scanPriority}
              onChange={(event) => setScanPriority(event.target.value as ScanMorePriority)}
              helperText={SCAN_MORE_PRIORITY_LABELS[scanPriority].explanation}
              sx={{ minWidth: 280 }}
            >
              {SCAN_MORE_PRIORITIES.map((priority) => (
                <MenuItem key={priority} value={priority}>
                  {SCAN_MORE_PRIORITY_LABELS[priority].label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Exploratory min delta"
              placeholder="Optional — e.g. 0.65"
              helperText={
                deltaFieldError ??
                'Display/exploration only — does not change the saved strategy. Blank = inclusive discovery.'
              }
              error={Boolean(deltaFieldError)}
              value={exploreDelta}
              onChange={(event) => setExploreDelta(event.target.value)}
              sx={{ minWidth: 260 }}
            />
          </Stack>
        </Collapse>
      </Paper>

      {!scan && searchState.canSearch ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h6">Ready to find LEAPS</Typography>
          <Typography variant="body1" sx={{ mt: 1 }}>
            Enter a ticker, choose a strategy, optionally open advanced filters, then click Find LEAPS. Results show how many
            long-dated calls exist, how many were evaluated, which meet your numerical rules, near matches, and what still needs
            data.
          </Typography>
        </Paper>
      ) : null}

      {scan ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h6">What we found</Typography>
          {scan.marketContext.simulated || scan.mode === 'demo-fixture' ? (
            <Alert severity="warning" sx={{ mt: 1.5 }} icon={false}>
              {scan.marketContext.simulatedNotice ?? 'SIMULATED DATA — NOT ACTUAL MARKET PRICES'}
            </Alert>
          ) : null}
          <Typography variant="body1" sx={{ mt: 1.5 }}>
            {scan.progress.plain.headline}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Long-dated calls found: {scan.progress.plain.eligibleLongDatedCalls}. Evaluated so far:{' '}
            {scan.progress.plain.uniqueContractsAttempted}. Within budget: {scan.progress.plain.withinHardBudget}. Meet assessed
            numerical requirements: {scan.progress.plain.meetsAssessableNumericRequirements}. Near matches: {nearMatchCount}. Need
            more data: {scan.progress.plain.incompleteMissingData}. Still unevaluated: {scan.progress.plain.notYetEvaluated}.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {scan.progress.plain.eligibleMeaning} Data completeness and strategy fit are separate. Matching filters does not mean a
            contract is a profitable opportunity.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Strategy locked for this scan: <strong>{scan.profileName}</strong> revision {scan.profileRevision}. Priority:{' '}
            {SCAN_MORE_PRIORITY_LABELS[scan.scanPriority].label}.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Hard (locked profile): max cost ${Number(scanProfile.hard.maxContractCost).toLocaleString('en-US')}, min DTE{' '}
            {scanProfile.hard.minExpirationDays}, min delta {scanProfile.hard.minLongDelta}. Preferences: preferred delta{' '}
            {scanProfile.preferences.preferredLongDelta}, intrinsic {scanProfile.preferences.minIntrinsicPercent}%.
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 1.5 }}>
            <Typography variant="body1">
              Underlying <strong>{scan.underlying}</strong>
              {scan.marketContext.underlyingPrice
                ? ` · most recent stock ${formatUsd(scan.marketContext.underlyingPrice)}`
                : ' · stock price unavailable'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Market session: {scan.marketContext.marketSession ?? '—'} · Quote snapshot:{' '}
              {scan.progress.plain.snapshotAt ?? '—'} · {scan.progress.plain.snapshotSource}
            </Typography>
            {scan.marketContext.quoteSkewWarning ? (
              <Typography variant="body2" color="warning.main">
                {scan.marketContext.quoteSkewWarning}
              </Typography>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.examined}>
              <Chip label={`Examined ${scan.progress.plain.uniqueContractsAttempted}`} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.stillUnexplored}>
              <Chip label={`Still unexplored ${scan.progress.plain.notYetEvaluated}`} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.withinBudget}>
              <Chip label={`Within budget ${scan.progress.plain.withinHardBudget}`} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.meetAssessableRules}>
              <Chip label={`Meet assessable rules ${scan.progress.plain.meetsAssessableNumericRequirements}`} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.verifiedMatches}>
              <Chip label={`Verified matches ${verifiedMatchCount}`} color={verifiedMatchCount > 0 ? 'success' : 'default'} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.nearMatches}>
              <Chip label={`Near matches ${nearMatchCount}`} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.unverifiedCandidates}>
              <Chip label={`Unverified ${unverifiedCount}`} color={unverifiedCount > 0 ? 'warning' : 'default'} />
            </Tooltip>
            <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.incomplete}>
              <Chip
                label={`Incomplete data ${scan.progress.plain.incompleteMissingData}`}
                color={scan.progress.plain.incompleteMissingData > 0 ? 'warning' : 'default'}
              />
            </Tooltip>
          </Stack>
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            {scan.progress.plain.expirationCoverage} {scan.progress.plain.moneynessCoverage}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Next: {scan.progress.plain.nextStepHint}
          </Typography>
          <Button size="small" sx={{ mt: 1 }} onClick={() => setShowTechnicalProgress((value) => !value)}>
            {showTechnicalProgress ? 'Hide scan details' : 'Scan Details'}
          </Button>
          <Collapse in={showTechnicalProgress}>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`Eligible long-dated ${scan.progress.plain.eligibleLongDatedCalls}`} />
              <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.fullyEvaluated}>
                <Chip label={`Fully evaluated ${scan.progress.plain.fullyEvaluated}`} />
              </Tooltip>
              <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.partiallyEvaluated}>
                <Chip label={`Partial ${scan.progress.plain.partiallyEvaluated}`} />
              </Tooltip>
              <Chip label={`Missing Greeks ${scan.progress.missingProviderGreeks}`} />
              <Chip label={`Missing/invalid quotes ${scan.progress.missingValidQuotes}`} />
              <Chip label={`Request budget ~${scan.progress.estimatedRequestBudgetUsed}`} />
              <Chip label={scan.status} />
              <Chip
                label={
                  scan.progress.plain.batchStatus === 'universe-examined'
                    ? 'Eligible set fully examined'
                    : 'Current batch finished — more remain'
                }
                color={scan.progress.plain.batchStatus === 'universe-examined' ? 'success' : 'warning'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {scan.progress.coverageSummary}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Selection: {scan.progress.selectionAlgorithm.slice(0, 220)}
              {scan.progress.selectionAlgorithm.length > 220 ? '…' : ''}
            </Typography>
          </Collapse>
          {scan.marketContext.marketSession === 'closed' ? (
            <Alert severity="info" sx={{ mt: 1.5 }} icon={false}>
              Last available snapshot — market closed. Closed-session quotes remain visible with timestamps. They are not verified live
              executions. Missing provider Greeks do not mean the entire scan failed.
            </Alert>
          ) : null}
          {scan.coverageNotes.map((note) => (
            <Alert
              key={note.code}
              severity={
                note.code === 'liquidity-unassessed-only' || note.code === 'adaptive-refinement-applied' ? 'info' : 'warning'
              }
              sx={{ mt: 1.5 }}
              icon={false}
            >
              {note.text}
            </Alert>
          ))}
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            {scan.message}
          </Typography>
        </Paper>
      ) : null}

      {scan && tradeoffExplorer ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1, alignItems: { sm: 'center' } }}>
            <Typography variant="h6">Numerical tradeoff explorer</Typography>
            <Button size="small" onClick={() => setShowTradeoffs((value) => !value)}>
              {showTradeoffs || !beginnerMode ? 'Hide explorer' : 'Show explorer'}
            </Button>
          </Stack>
          <Collapse in={showTradeoffs || !beginnerMode}>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Compare evaluated contracts by criteria. Draft filters below do not change the saved strategy profile. No buy
              recommendations or opportunity scores.
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
              <TextField
                label="Draft max cost ($)"
                value={draftMaxCost}
                onChange={(event) => setDraftMaxCost(event.target.value)}
                helperText="Explorer only — not saved"
                sx={{ minWidth: 160 }}
              />
              <TextField
                label="Draft min delta"
                value={draftMinDelta}
                onChange={(event) => setDraftMinDelta(event.target.value)}
                helperText="Explorer only — not saved"
                sx={{ minWidth: 160 }}
              />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
              {(Object.keys(TRADEOFF_CRITERION_LABELS) as TradeoffCriterion[]).map((criterion) => (
                <FormControlLabel
                  key={criterion}
                  control={
                    <Checkbox
                      size="small"
                      checked={tradeoffCriteria.includes(criterion)}
                      onChange={(event) => {
                        setTradeoffCriteria((current) => {
                          if (event.target.checked) return [...current, criterion];
                          const next = current.filter((row) => row !== criterion);
                          return next.length > 0 ? next : ['best-within-budget'];
                        });
                      }}
                    />
                  }
                  label={TRADEOFF_CRITERION_LABELS[criterion]}
                />
              ))}
            </Stack>
            {tradeoffExplorer.conflicts.map((conflict) => (
              <Alert key={conflict.code} severity="warning" sx={{ mt: 1.5 }} icon={false}>
                {conflict.text}
              </Alert>
            ))}
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              Showing {tradeoffExplorer.matchedCount} of {tradeoffExplorer.evaluatedCount} evaluated (supported) contracts
              under draft filters.
            </Typography>
            <Table size="small" sx={{ mt: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Contract</TableCell>
                  <TableCell align="right">Ask cost</TableCell>
                  <TableCell align="right">Delta</TableCell>
                  <TableCell align="right">Intrinsic %</TableCell>
                  <TableCell align="right">Extrinsic</TableCell>
                  <TableCell align="right">Spread %</TableCell>
                  <TableCell align="right">DTE</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tradeoffExplorer.ranked.slice(0, 12).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell align="right">{row.askCost != null ? formatUsd(String(row.askCost)) : '—'}</TableCell>
                    <TableCell align="right">{row.delta != null ? formatDelta(String(row.delta)) : '—'}</TableCell>
                    <TableCell align="right">
                      {row.intrinsicPercent != null ? formatPercentMetric(String(row.intrinsicPercent)) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {row.extrinsicPerShare != null ? formatUsd(String(row.extrinsicPerShare)) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {row.spreadPercent != null ? formatPercentMetric(String(row.spreadPercent)) : '—'}
                    </TableCell>
                    <TableCell align="right">{row.daysToExpiration ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Collapse>
        </Paper>
      ) : null}

      {scan ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={1.5}>
            {beginnerMode ? <PmccExplainer /> : null}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={resultsView}
                onChange={(_event, value: 'cards' | 'table' | null) => {
                  if (value) setResultsView(value);
                }}
              >
                <ToggleButton value="cards">Card View</ToggleButton>
                <ToggleButton value="table">Table View</ToggleButton>
              </ToggleButtonGroup>
              {beginnerMode ? (
                <TextField
                  select
                  label="Matches to My Strategy"
                  value={matchGroupFilter}
                  onChange={(event) => setMatchGroupFilter(event.target.value as typeof matchGroupFilter)}
                  sx={{ minWidth: 260 }}
                >
                  {MATCH_GROUP_FILTERS.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  select
                  label="Class filter"
                  value={outcomeFilter}
                  onChange={(event) => setOutcomeFilter(event.target.value as typeof outcomeFilter)}
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="all">All classes</MenuItem>
                  {(Object.keys(DISCOVERY_OUTCOME_LABELS) as DiscoveryOutcome[]).map((outcome) => (
                    <MenuItem key={outcome} value={outcome}>
                      {DISCOVERY_OUTCOME_LABELS[outcome]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {beginnerMode ? (
                <TextField
                  select
                  label="Sort within groups"
                  value={beginnerSortMetric}
                  onChange={(event) => setBeginnerSortMetric(event.target.value as FactualSortMetric)}
                  sx={{ minWidth: 280 }}
                >
                  {BEGINNER_SORT_OPTIONS.map((option) => (
                    <MenuItem key={option.metric} value={option.metric}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField select label="Sort by" value={sortKey} onChange={(event) => setSortKey(event.target.value)} sx={{ minWidth: 280 }}>
                  {SORT_OPTIONS.map((option) => (
                    <MenuItem key={`${option.metric}:${option.direction}`} value={`${option.metric}:${option.direction}`}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <FormControlLabel
                control={<Checkbox checked={withinExplorationOnly} onChange={(event) => setWithinExplorationOnly(event.target.checked)} />}
                label="Within exploration only"
              />
            </Stack>

            {beginnerMode ? (
              <Alert severity="info" variant="outlined">
                Matches to My Strategy groups evaluated contracts by hard-rule eligibility and preference differences. Within each
                group you choose a factual sort — OptionScout does not invent an overall “best” contract across conflicting
                preferences. Groups cover this evaluated set only; Scan More may leave other chain contracts unexamined.
              </Alert>
            ) : null}

            {topPairTradeoff ? (
              <Alert severity="info">
                <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
                  Factual tradeoff in the top eligible group
                </Typography>
                <Typography variant="body2">{topPairTradeoff}</Typography>
              </Alert>
            ) : null}

            {resultsView === 'cards' && beginnerMode ? (
              <Stack spacing={2.5}>
                {strategyGroups.map((group) => (
                  <Box key={group.id}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 650, mb: 1 }}>
                      {group.label} ({group.candidates.length})
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gap: 2,
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' },
                      }}
                    >
                      {group.candidates.map((candidate) => (
                        <CandidateResultCard
                          key={candidate.id}
                          candidate={candidate}
                          profile={scanProfile}
                          badges={rankingBadges.get(candidate.id) ?? []}
                          beginnerMode
                          showValidationDetails={false}
                          selected={selectedIds.includes(candidate.id)}
                          compareDisabled={selectedIds.length >= 4}
                          onToggleCompare={(checked) => toggleCompare(candidate.id, checked)}
                          onReview={() => setDetailId(candidate.id)}
                          onSave={() => void bookmark(candidate)}
                        />
                      ))}
                    </Box>
                  </Box>
                ))}
                {strategyGroups.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No contracts in this strategy group filter.
                  </Typography>
                ) : null}
              </Stack>
            ) : resultsView === 'cards' ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' },
                }}
              >
                {rows.map((row) => {
                  const candidate = candidateById.get(row.id);
                  if (!candidate) return null;
                  return (
                    <CandidateResultCard
                      key={row.id}
                      candidate={candidate}
                      profile={scanProfile}
                      badges={rankingBadges.get(row.id) ?? []}
                      beginnerMode={false}
                      showValidationDetails
                      selected={selectedIds.includes(row.id)}
                      compareDisabled={selectedIds.length >= 4}
                      onToggleCompare={(checked) => toggleCompare(row.id, checked)}
                      onReview={() => setDetailId(row.id)}
                      onSave={() => void bookmark(candidate)}
                    />
                  );
                })}
              </Box>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Compare</TableCell>
                      <TableCell>Class</TableCell>
                      <TableCell>Contract</TableCell>
                      <TableCell>
                        <Tooltip title={FINDER_METRIC_TOOLTIPS.purchaseCost}>
                          <span>Cost</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={FINDER_METRIC_TOOLTIPS.delta}>
                          <span>Delta</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={FINDER_METRIC_TOOLTIPS.intrinsicPercent}>
                          <span>Intrinsic %</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={FINDER_METRIC_TOOLTIPS.bidAskSpread}>
                          <span>Spread %</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={FINDER_METRIC_TOOLTIPS.dte}>
                          <span>DTE</span>
                        </Tooltip>
                      </TableCell>
                      {!beginnerMode ? <TableCell>OCC</TableCell> : null}
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const candidate = candidateById.get(row.id);
                      if (!candidate) return null;
                      const gap = summarizePreferenceGaps(candidate.reasons);
                      const spread = formatSpreadDisplay({
                        crossedMarket: candidate.flags.crossedMarket,
                        invalidPrice: candidate.flags.invalidPrice,
                        bidAskSpreadPercent: candidate.calculations.bidAskSpreadPercent,
                      });
                      return (
                        <TableRow key={row.id} selected={detailId === row.id} hover>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(row.id)}
                              disabled={!selectedIds.includes(row.id) && selectedIds.length >= 4}
                              onChange={(event) => toggleCompare(row.id, event.target.checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.5} alignItems="flex-start">
                              <Chip
                                size="small"
                                label={
                                  beginnerMode && candidateById.get(row.id)
                                    ? buildPlanFitSummary(candidateById.get(row.id)!, scanProfile).eligibilityLabel
                                    : row.label
                                }
                                color={outcomeColor(row.outcome)}
                              />
                              {(rankingBadges.get(row.id) ?? []).map((badge) => (
                                <Chip key={badge} size="small" variant="outlined" color="primary" label={badge} />
                              ))}
                              {gap.label && !beginnerMode ? (
                                <Chip size="small" variant="outlined" label={gap.label} color={preferenceGapColor(gap.severity)} />
                              ) : null}
                              {isVerifiedConfiguredMatch(candidate) ? (
                                <Chip size="small" color="success" variant="outlined" label="Verified match" />
                              ) : null}
                              {isUnverifiedOrIncompleteCandidate(candidate) && !isVerifiedConfiguredMatch(candidate) ? (
                                <Chip size="small" color="warning" variant="outlined" label="Unverified / incomplete" />
                              ) : null}
                              <Chip size="small" variant="outlined" label={observationFreshnessLabel(candidate.observationFreshness)} />
                              <Chip
                                size="small"
                                variant="outlined"
                                color={candidate.greekVerification === 'aligned' ? 'default' : 'warning'}
                                label={greekVerificationLabel(candidate.greekVerification)}
                              />
                              {candidate.meetsConfiguredNumericRequirements && candidate.liquidityUnassessed ? (
                                <Chip size="small" label="Liquidity unassessed" />
                              ) : null}
                              {showParetoMarkers && paretoIds.has(row.id) ? <Chip size="small" label="Pareto" color="secondary" /> : null}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{contractTitle(candidate)}</Typography>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ maxWidth: 320 }}>
                              {assessCandidate(candidate).plainSummary}
                            </Typography>
                            {!beginnerMode ? (
                              <Typography variant="caption" color="text.secondary" display="block">
                                {observationFreshnessLabel(candidate.observationFreshness)} ·{' '}
                                {greekVerificationLabel(candidate.greekVerification)} · ×{candidate.multiplier}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell>{formatUsd(candidate.calculations.estimatedPurchaseCost)}</TableCell>
                          <TableCell>{formatDelta(candidate.delta)}</TableCell>
                          <TableCell>{formatPercentMetric(candidate.calculations.intrinsicPercent)}</TableCell>
                          <TableCell>
                            <Typography variant="body2" color={spread.invalid ? 'warning.main' : 'inherit'}>
                              {spread.text}
                            </Typography>
                          </TableCell>
                          <TableCell>{candidate.calculations.daysToExpiration ?? '—'}</TableCell>
                          {!beginnerMode ? (
                            <TableCell>
                              <Typography variant="caption">{candidate.occSymbol.trim()}</Typography>
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <Stack direction="row" spacing={1}>
                              <Button size="small" onClick={() => setDetailId(row.id)}>
                                View Analysis
                              </Button>
                              <Button size="small" onClick={() => void bookmark(candidate)}>
                                Save
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            )}

            <CompareTray
              selectedCount={selectedIds.length}
              onClear={() => setSelectedIds([])}
              onCompare={() => {
                const el = document.getElementById('contract-compare');
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          </Stack>
        </Paper>
      ) : null}

      {detailId && candidateById.get(detailId) ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }} id="contract-review">
          <ContractReviewPanel
            candidate={candidateById.get(detailId)!}
            profile={activeProfile}
            beginnerMode={beginnerMode}
            onClose={() => setDetailId(null)}
          />
        </Paper>
      ) : null}

      {selectedCandidates.length >= 2 ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }} id="contract-compare">
          <ContractComparisonPanel
            candidates={selectedCandidates.slice(0, 4)}
            profile={activeProfile}
            beginnerMode={beginnerMode}
          />
          {!beginnerMode ? (
            <>
              <FormControlLabel
                sx={{ mt: 2 }}
                control={
                  <Checkbox
                    checked={showParetoMarkers}
                    onChange={(event) => {
                      setShowParetoMarkers(event.target.checked);
                      if (event.target.checked && paretoMetrics.length === 0) {
                        setParetoMetrics(['purchaseCost', 'delta']);
                      }
                    }}
                  />
                }
                label="Show Pareto markers (optional)"
              />
              {showParetoMarkers ? (
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                  {DISCOVERY_METRICS.map((metric) => (
                    <FormControlLabel
                      key={metric}
                      control={
                        <Checkbox
                          checked={paretoMetrics.includes(metric)}
                          onChange={(event) => {
                            setParetoMetrics((current) =>
                              event.target.checked ? [...current, metric] : current.filter((item) => item !== metric),
                            );
                          }}
                        />
                      }
                      label={`Pareto: ${metric}`}
                    />
                  ))}
                </Stack>
              ) : null}
            </>
          ) : null}
        </Paper>
      ) : null}

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Saved candidates</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Local bookmarks only. They are not brokerage positions or transactions. Simulated fixture bookmarks stay labeled and are
          never current market opportunities.
        </Typography>
        {bookmarkWarnings.map((warning) => (
          <Alert key={`${warning.code}-${warning.id ?? 'row'}-${warning.missingFields.join(',')}`} severity="warning" sx={{ mb: 1 }}>
            {warning.message}
          </Alert>
        ))}
        {bookmarks.length === 0 ? (
          <Typography variant="body2">No saved candidates yet.</Typography>
        ) : (
          <Stack spacing={1}>
            {bookmarks.map((bookmarkRow) => {
              const simulated = isSimulatedBookmark(bookmarkRow);
              return (
                <Stack key={bookmarkRow.id} direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
                  <Stack spacing={0.5}>
                    <Typography variant="body2">
                      {contractTitle(bookmarkRow.snapshot)} · saved {bookmarkRow.savedAt}
                    </Typography>
                    {simulated ? (
                      <Chip
                        size="small"
                        color="warning"
                        label="Simulated sample — not live market data"
                        sx={{ alignSelf: 'flex-start' }}
                      />
                    ) : null}
                  </Stack>
                  <Button size="small" onClick={() => void removeBookmark(bookmarkRow.id)}>
                    Remove
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}


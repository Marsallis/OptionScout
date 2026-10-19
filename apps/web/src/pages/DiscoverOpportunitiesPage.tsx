import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCEPTANCE_SAVED_PROFILE,
  validateTickerSymbol,
  FINDER_PROGRESS_CHIP_TOOLTIPS,
  SAL_PMCC_DEEP_ITM,
  SMART_SCAN_DEFAULT_BUDGET,
  SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST,
  BEGINNER_SELECTION_LIMIT,
  SMART_SCAN_MAX_TICKERS,
  collectionDisplayName,
  installedHoldingsForFund,
  isUnverifiedOrIncompleteCandidate,
  isVerifiedConfiguredMatch,
  type DiscoveryUniverse,
  type FinderCandidate,
  type ScanMorePriority,
  type SmartScanPolicy,
  type SmartScanResult,
  type StrategyProfile,
} from '@optionscout/shared';
import { buildDiscoverUxPreviewScan, readDiscoverUxPreviewMode } from '../discoverUxPreview';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  cancelSmartScan,
  createDiscoveryUniverse,
  createSmartScan,
  fetchDiscoveryUniverses,
  fetchSmartScan,
  fetchSmartScanPolicy,
  fetchStrategyProfiles,
  retrySmartScanCompanies,
  saveFinderBookmark,
  scanSmartMore,
  scanSmartNextCompanies,
} from '../api/client';
import { BeginnerStockForm, SELECTED_SEARCH_LABEL, isEphemeralSearchList, type CompanyDirectory } from '../components/BeginnerStockForm';
import { CompareTray } from '../components/CompareTray';
import { ContractComparisonPanel } from '../components/ContractComparisonPanel';
import { ContractReviewPanel } from '../components/ContractReviewPanel';
import { DiscoverOnboarding } from '../components/DiscoverOnboarding';
import { DiscoverSetupPanels } from '../components/DiscoverSetupPanels';
import { StockCollectionsDialog } from '../components/StockCollectionsDialog';
import { DiscoverResultsSection } from '../components/DiscoverResultsSection';
import { SuccessToast } from '../brand/SuccessToast';
import { SmartScanProgressPanel } from '../components/SmartScanProgressPanel';
import { RecentSearchesPanel } from '../components/RecentSearchesPanel';
import { useAppState } from '../state/AppState';
import { useResearchWorkspace } from '../state/ResearchWorkspace';

function splitManualTickers(manualTickers: string): string[] {
  return manualTickers
    .split(/[\s,;]+/)
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
}

function resolveScanTickers(manualTickers: string, selectedTickers: string[], maxTickers: number): string[] {
  const fromManual = splitManualTickers(manualTickers);
  return (fromManual.length > 0 ? fromManual : selectedTickers).slice(0, maxTickers);
}

const DISCOVER_DRAFT_KEY = 'optionscout.discoverDraft';

type DiscoverDraft = {
  universeId: string;
  directoryId: string;
  selectedTickers: string[];
  manualTickers: string;
  profileId: string;
};

/** Same-tab memory. Route changes unmount the page, but this survives until an explicit clear. */
let sessionDiscoverDraft: DiscoverDraft | null = null;

function normalizeDraft(parsed: Partial<DiscoverDraft> | null): DiscoverDraft | null {
  if (!parsed || typeof parsed.universeId !== 'string' || !Array.isArray(parsed.selectedTickers)) return null;
  const selectedTickers = parsed.selectedTickers
    .filter((row): row is string => typeof row === 'string')
    .map((row) => validateTickerSymbol(row))
    .flatMap((row) => (row.ok ? [row.ticker] : []))
    .slice(0, 20);
  return {
    universeId: parsed.universeId,
    directoryId: typeof parsed.directoryId === 'string' ? parsed.directoryId : '',
    selectedTickers,
    manualTickers: typeof parsed.manualTickers === 'string' ? parsed.manualTickers : '',
    profileId: typeof parsed.profileId === 'string' ? parsed.profileId : '',
  };
}

function readDiscoverDraft(): DiscoverDraft | null {
  if (sessionDiscoverDraft) return sessionDiscoverDraft;
  try {
    const raw = localStorage.getItem(DISCOVER_DRAFT_KEY);
    if (!raw) return null;
    const draft = normalizeDraft(JSON.parse(raw) as Partial<DiscoverDraft>);
    sessionDiscoverDraft = draft;
    return draft;
  } catch {
    return null;
  }
}

function writeDiscoverDraft(draft: DiscoverDraft): void {
  sessionDiscoverDraft = draft;
  try {
    localStorage.setItem(DISCOVER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable; the in-memory draft still covers this browser session */
  }
}

/** Test hook. The product clears a draft only through Clear selection or another explicit user action. */
export function resetDiscoverSelectionDraft(): void {
  sessionDiscoverDraft = null;
  try {
    localStorage.removeItem(DISCOVER_DRAFT_KEY);
  } catch {
    /* storage unavailable */
  }
}

function diagnosticBlockedTickers(tickers: string[], policy: SmartScanPolicy | null): string[] {
  if (!policy?.enabled || policy.mode !== 'diagnostic') return [];
  const allowed = new Set(policy.allowlist.map((row) => row.toUpperCase()));
  return tickers.filter((ticker) => !allowed.has(ticker.toUpperCase()));
}

export function DiscoverOpportunitiesPage() {
  const { status, session, error, settings, broker } = useAppState();
  const research = useResearchWorkspace();
  const [profiles, setProfiles] = useState<StrategyProfile[]>([SAL_PMCC_DEEP_ITM]);
  const [profilesFromServer, setProfilesFromServer] = useState(false);
  const initialDraft = useMemo(() => readDiscoverDraft(), []);
  const [profileId, setProfileId] = useState(initialDraft?.profileId || SAL_PMCC_DEEP_ITM.id);
  const [universes, setUniverses] = useState<{
    curated: DiscoveryUniverse[];
    saved: DiscoveryUniverse[];
    bookmarkDerived: DiscoveryUniverse | null;
  }>({ curated: [], saved: [], bookmarkDerived: null });
  const [selectedUniverseId, setSelectedUniverseId] = useState(initialDraft?.universeId ?? '');
  const [selectedTickers, setSelectedTickers] = useState<string[]>(initialDraft?.selectedTickers ?? []);
  const [manualTickers, setManualTickers] = useState(initialDraft?.manualTickers ?? '');
  const selectionRef = useRef({ universeId: selectedUniverseId, tickers: selectedTickers });
  selectionRef.current = { universeId: selectedUniverseId, tickers: selectedTickers };
  const appliedUniverseRef = useRef<string | null>(initialDraft?.universeId || null);
  const [addTickerDraft, setAddTickerDraft] = useState('');
  const [scanPriority, setScanPriority] = useState<ScanMorePriority>('closest-to-strategy');
  const [budget, setBudget] = useState(SMART_SCAN_DEFAULT_BUDGET);
  const [busy, setBusy] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [focusTicker, setFocusTicker] = useState('');
  const [scanMoreMode, setScanMoreMode] = useState<'diversified' | 'focus-ticker'>('diversified');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const [directoryId, setDirectoryId] = useState(initialDraft?.directoryId || 'sp500');
  const [directoryChosen, setDirectoryChosen] = useState(Boolean(initialDraft?.directoryId));
  const [showPrevious, setShowPrevious] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageCatalogId, setManageCatalogId] = useState<string | null>(null);
  const [manageFund, setManageFund] = useState<string | null>(null);
  const [policy, setPolicy] = useState<SmartScanPolicy | null>(null);
  const uxPreviewMode = useMemo(() => readDiscoverUxPreviewMode(), []);
  const [searchParams] = useSearchParams();
  const requestedSession = searchParams.get('session');

  const scan = research.discover.scan;
  const selectedIds = research.discover.selectedIds;
  const setSelectedIds = research.setDiscoverSelectedIds;
  const notice = localNotice ?? research.discover.notice;
  const setNotice = (value: string | null) => {
    setLocalNotice(value);
    research.setDiscoverNotice(value);
  };

  const activeProfile = profiles.find((row) => row.id === profileId) ?? profiles[0] ?? SAL_PMCC_DEEP_ITM;
  const scanProfile =
    research.discover.strategySnapshot ??
    (scan != null ? (profiles.find((row) => row.id === scan.profileId) ?? activeProfile) : activeProfile);
  const authenticated = Boolean(session?.authenticated);
  const diagnosticMode = Boolean(policy?.enabled && policy.mode === 'diagnostic');
  const normalLiveReady = Boolean(policy?.enabled && policy.mode === 'normal');
  const operationCap = policy?.maxTickers ?? SMART_SCAN_MAX_TICKERS;
  const maxSelectable = diagnosticMode ? operationCap : BEGINNER_SELECTION_LIMIT;
  const maxBudget = policy?.maxBudget ?? SMART_SCAN_DEFAULT_BUDGET;
  const allowlist = useMemo(() => {
    if (policy?.mode === 'diagnostic' && policy.allowlist.length > 0) return policy.allowlist;
    return [...SMART_SCAN_LIVE_DIAGNOSTIC_ALLOWLIST];
  }, [policy?.mode, policy?.allowlist]);

  const pendingTickers = useMemo(
    () => resolveScanTickers(manualTickers, selectedTickers, maxSelectable),
    [manualTickers, selectedTickers, maxSelectable],
  );
  const blockedTickers = useMemo(() => diagnosticBlockedTickers(pendingTickers, policy), [pendingTickers, policy]);
  const scanBlocked = diagnosticMode && blockedTickers.length > 0;

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

  const selectedUniverse = useMemo(() => {
    const all = [...universes.curated, ...universes.saved, ...(universes.bookmarkDerived ? [universes.bookmarkDerived] : [])];
    return all.find((row) => row.id === selectedUniverseId) ?? null;
  }, [universes, selectedUniverseId]);

  const researchStatusLabel = useMemo(() => {
    if (!authenticated) return 'Sign in required for scans';
    if (broker?.connection.state === 'connected') return 'Active provider session';
    const quoteState = broker?.quotes.state;
    if (quoteState === 'fresh' || quoteState === 'closed_session' || quoteState === 'stale' || broker?.quotes.asOf) {
      return 'Cached research data available';
    }
    if (broker?.connection.lastSuccessAt) return 'Cached research data available';
    return 'Provider session inactive';
  }, [authenticated, broker]);

  const restoreDiscoverById = research.restoreDiscoverById;
  useEffect(() => {
    if (!requestedSession || !authenticated) return;
    let cancelled = false;
    void restoreDiscoverById(requestedSession).then((ok) => {
      if (cancelled) return;
      setLocalNotice(ok ? 'Viewing saved results only. No market data was requested.' : 'Could not open that saved session.');
    });
    return () => {
      cancelled = true;
    };
  }, [requestedSession, authenticated, restoreDiscoverById]);

  useEffect(() => {
    if (status !== 'ready') return;
    // Policy is public (no secrets) so mode banners work before sign-in.
    void fetchSmartScanPolicy()
      .then((policyBody) => {
        setPolicy(policyBody);
        setBudget((current) => Math.min(current, policyBody.maxBudget));
      })
      .catch(() => setPolicy(null));
  }, [status]);

  useEffect(() => {
    if (status !== 'ready' || !authenticated) return;
    void Promise.all([fetchStrategyProfiles(), fetchDiscoveryUniverses()])
      .then(([profileBody, universeBody]) => {
        setProfiles(profileBody.profiles.length > 0 ? profileBody.profiles : [SAL_PMCC_DEEP_ITM]);
        setProfilesFromServer(profileBody.profiles.length > 0);
        if (!sessionDiscoverDraft?.profileId) {
          setProfileId(profileBody.defaultProfileId || SAL_PMCC_DEEP_ITM.id);
        }
        setUniverses(universeBody);
        const known = [
          ...universeBody.curated,
          ...universeBody.saved,
          ...(universeBody.bookmarkDerived ? [universeBody.bookmarkDerived] : []),
        ];
        const current = selectionRef.current;
        const keepsDiagnosticRules =
          !(policy?.enabled === true && policy.mode === 'diagnostic') ||
          current.tickers.every((ticker) => policy.allowlist.includes(ticker));
        if (known.some((row) => row.id === current.universeId) && keepsDiagnosticRules) {
          // Owner's saved or restored selection survives reloads and policy refreshes.
          return;
        }
        appliedUniverseRef.current = null;
        if (policy?.enabled === true && policy.mode === 'diagnostic') {
          const first = universeBody.curated[0];
          if (first) {
            setSelectedUniverseId(first.id);
            const seed = first.tickers.filter((ticker) => policy.allowlist.includes(ticker)).slice(0, policy.maxTickers);
            setSelectedTickers(seed.length > 0 ? seed : [...policy.allowlist].slice(0, policy.maxTickers));
          }
        }
      })
      .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Could not load discovery data.'));
  }, [status, authenticated, policy]);

  useEffect(() => {
    if (!selectedUniverse) return;
    if (appliedUniverseRef.current === selectedUniverse.id) return;
    appliedUniverseRef.current = selectedUniverse.id;
    setSelectedTickers((current) => {
      const stillValid = current.filter((ticker) => selectedUniverse.tickers.includes(ticker));
      let next: string[];
      if (diagnosticMode) {
        const allowed = stillValid.filter((ticker) => allowlist.includes(ticker));
        if (allowed.length > 0) next = allowed.slice(0, maxSelectable);
        else {
          const fromUniverse = selectedUniverse.tickers
            .filter((ticker) => allowlist.includes(ticker))
            .slice(0, maxSelectable);
          next = fromUniverse.length > 0 ? fromUniverse : allowlist.slice(0, maxSelectable);
        }
      } else {
        const extras = current.filter((ticker) => !selectedUniverse.tickers.includes(ticker));
        next = [...stillValid, ...extras].slice(0, maxSelectable);
      }
      if (next.length === current.length && next.every((ticker, index) => ticker === current[index])) {
        return current;
      }
      return next;
    });
  }, [selectedUniverse, diagnosticMode, allowlist, maxSelectable]);

  const candidateById = useMemo(() => {
    const map = new Map<string, FinderCandidate>();
    for (const row of scan?.candidates ?? []) map.set(row.id, row);
    return map;
  }, [scan]);

  const beginnerMode = !showAdvanced;

  const strategyMismatch = Boolean(scan && (scan.profileId !== profileId || scan.scanPriority !== scanPriority));

  // Client-only UX preview fixtures (no brokerage / no live Smart Scan).
  useEffect(() => {
    if (uxPreviewMode === 'off') return;
    setProfiles((current) =>
      current.some((row) => row.id === ACCEPTANCE_SAVED_PROFILE.id && row.revision === ACCEPTANCE_SAVED_PROFILE.revision)
        ? current
        : [ACCEPTANCE_SAVED_PROFILE, ...current],
    );
    setProfileId(ACCEPTANCE_SAVED_PROFILE.id);
    research.setDiscoverScan(buildDiscoverUxPreviewScan(uxPreviewMode), {
      strategySnapshot: ACCEPTANCE_SAVED_PROFILE,
      notice:
        uxPreviewMode === 'running'
          ? 'UX preview: simulated running progress (no brokerage request).'
          : 'UX preview: simulated Gallery/List fixtures (no brokerage request).',
    });
  }, [uxPreviewMode]);

  // Poll running scans so the progress panel reflects backend status without inventing counters.
  useEffect(() => {
    if (!scan || scan.status !== 'running') return;
    if (scan.scanId === 'ux-preview-discover') return; // preview stays on fixed counters
    const scanId = scan.scanId;
    const timer = window.setInterval(() => {
      void fetchSmartScan(scanId)
        .then((result) => research.applyDiscoverProgress(result))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [scan?.scanId, scan?.status]);

  async function reloadUniverses(): Promise<void> {
    const body = await fetchDiscoveryUniverses();
    setUniverses(body);
  }

  const stopChain = useRef(false);
  useEffect(() => {
    return () => {
      stopChain.current = true;
    };
  }, []);

  async function runFind(tickersOverride?: string[]): Promise<void> {
    if (!authenticated) {
      setNotice('Sign in on Broker & Data before starting Explore Stocks.');
      return;
    }
    const chosen = (tickersOverride ?? selectedTickers).slice(0, maxSelectable);
    if (chosen.length === 0) {
      setNotice('Check at least one company.');
      return;
    }
    if (scanBlocked) {
      setNotice(
        `Diagnostic Mode allows only ${allowlist.join(', ')}. Unsupported tickers blocked: ${blockedTickers.join(', ')}. This is not a credential failure.`,
      );
      return;
    }
    const invalid = splitManualTickers(manualTickers).filter((raw) => !validateTickerSymbol(raw).ok);
    if (invalid.length > 0) {
      setNotice(`Invalid ticker format: ${invalid.join(', ')}. Symbols are never altered to make them fit.`);
      return;
    }
    stopChain.current = false;
    setBusy(true);
    setLocalNotice(null);
    setFormOpen(false);
    research.claimDiscoverSearch({
      tickers: chosen,
      profileName: activeProfile.name,
      profileRevision: activeProfile.revision,
      notice: `Starting new research for ${chosen.join(', ')}.`,
    });
    const generation = research.currentDiscoverGeneration();
    const stillThisSearch = () => research.currentDiscoverGeneration() === generation;
    const remember = (row: SmartScanResult, first: boolean) => {
      if (!stillThisSearch()) return;
      research.setDiscoverScan(row, {
        strategySnapshot: activeProfile,
        ...(first ? { selectedIds: [] } : {}),
        notice: row.message,
        orderedTickerQueue: row.tickers.map((ticker) => ticker.ticker),
        companyCursor: row.companyCursor ?? row.tickers.length,
      });
      setLocalNotice(row.message);
    };
    const settle = async (row: SmartScanResult): Promise<SmartScanResult | null> => {
      let current = row;
      remember(current, true);
      while (current.status === 'running') {
        if (!stillThisSearch()) return null;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        if (!stillThisSearch()) return null;
        current = await fetchSmartScan(current.scanId);
        remember(current, false);
      }
      return stillThisSearch() ? current : null;
    };
    try {
      const names = Object.fromEntries(
        chosen.map((ticker) => [ticker, selectedUniverse?.companyNames[ticker] ?? ticker]),
      );
      const searchName = chosen.length <= 6 ? chosen.join(', ') : `${chosen.slice(0, 5).join(', ')} +${chosen.length - 5}`;
      const saved = await createDiscoveryUniverse({
        name: searchName,
        tickers: chosen,
        sourceKind: 'custom',
        sourceLabel: SELECTED_SEARCH_LABEL,
      });
      if (!stillThisSearch()) return;
      const first = chosen.slice(0, operationCap);
      let result = await settle(await createSmartScan({
        tickers: first,
        profileId,
        universeId: saved.id,
        universeVersionId: saved.currentVersion?.id ?? null,
        universeLabel: searchName,
        companyNames: names,
        evaluationBudget: Math.min(budget, maxBudget),
        scanPriority,
      }, { wait: false }));
      if (!result) return;
      const remaining = Math.max(0, (result.companiesInUniverseQueue ?? chosen.length) - (result.companyCursor ?? first.length));
      if (!stopChain.current && result.status === 'completed' && remaining > 0 && result.canScanNextCompanies) {
        result = await settle(await scanSmartNextCompanies(result.scanId, {
          count: Math.min(operationCap, remaining),
          evaluationBudget: Math.min(budget, maxBudget),
          priority: scanPriority,
        }, { wait: false }));
      }
    } catch (reason: unknown) {
      if (!stillThisSearch()) return;
      const message = reason instanceof Error ? reason.message : 'Smart Scan failed.';
      setLocalNotice(message);
      research.setDiscoverScan(null, { notice: message });
    } finally {
      setBusy(false);
    }
  }

  function pauseSearch() {
    stopChain.current = true;
    setLocalNotice(
      'Paused. This step will finish and its saved results stay in this session. Continue Search resumes any selected companies that were not examined yet.',
    );
  }

  function viewingSavedResearch(): boolean {
    return research.discover.viewMode === 'view-saved';
  }

  async function runMore(): Promise<void> {
    if (!scan) return;
    if (viewingSavedResearch()) {
      setNotice('View Previous Results does not request market data. Use Scan More Contracts only from the open research session.');
      return;
    }
    setBusy(true);
    try {
      const result = await scanSmartMore(scan.scanId, {
        count: Math.min(budget, maxBudget),
        priority: scanPriority,
        mode: scanMoreMode,
        focusTicker: scanMoreMode === 'focus-ticker' ? focusTicker || undefined : undefined,
      });
      research.setDiscoverScan(result, { notice: result.message });
      setLocalNotice(result.message);
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : 'Scan More Contracts failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runNextCompanies(): Promise<void> {
    if (!scan) return;
    if (viewingSavedResearch()) {
      setNotice('View Previous Results does not continue a search. Continue Search requests the next companies in the open session.');
      return;
    }
    setBusy(true);
    try {
      const generation = research.currentDiscoverGeneration();
      const started = await scanSmartNextCompanies(scan.scanId, {
        count: Math.min(operationCap, SMART_SCAN_MAX_TICKERS),
        evaluationBudget: Math.min(budget, maxBudget),
        priority: scanPriority,
      }, { wait: false });
      if (research.currentDiscoverGeneration() !== generation) return;
      research.setDiscoverScan(started, { notice: started.message });
      let result = started;
      while (result.status === 'running') {
        if (research.currentDiscoverGeneration() !== generation) return;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        result = await fetchSmartScan(result.scanId);
        research.applyDiscoverProgress(result);
      }
      if (research.currentDiscoverGeneration() !== generation) return;
      research.setDiscoverScan(result, {
        notice: result.message,
        companyCursor: result.companyCursor,
        orderedTickerQueue: research.discover.orderedTickerQueue,
      });
      setLocalNotice(result.message);
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : 'Scan Next Companies failed.');
    } finally {
      setBusy(false);
    }
  }

  function runNewSearch(): void {
    const queued = research.discover.orderedTickerQueue.length > 0
      ? research.discover.orderedTickerQueue
      : (scan?.tickers.map((row) => row.ticker) ?? []);
    if (queued.length === 0) {
      setNotice('There is no open research to run again. Check companies, then use Find Matching LEAPS.');
      return;
    }
    setSelectedTickers(queued.slice(0, maxSelectable));
    void runFind(queued);
  }

  async function runRetryCompanies(): Promise<void> {
    if (!scan) return;
    if (viewingSavedResearch()) {
      setNotice('View Previous Results does not request market data.');
      return;
    }
    setBusy(true);
    try {
      const result = await retrySmartScanCompanies(scan.scanId, { evaluationBudget: Math.min(budget, maxBudget) });
      research.setDiscoverScan(result, { notice: result.message, companyCursor: result.companyCursor });
      setLocalNotice(result.message);
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : 'Retry failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runCancel(): Promise<void> {
    if (!scan) return;
    setBusy(true);
    try {
      const result = await cancelSmartScan(scan.scanId);
      research.setDiscoverScan(result, { notice: result.message });
      setLocalNotice(result.message);
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  }

  function selectDiagnosticTickers(): void {
    setManualTickers('');
    setSelectedTickers(allowlist.slice(0, maxSelectable));
  }

  const directories = useMemo((): CompanyDirectory[] => {
    const saved = universes.saved.filter((row) => !isEphemeralSearchList(row));
    const fund = (ticker: string) => installedHoldingsForFund(saved, ticker);
    const rows: CompanyDirectory[] = [
      {
        id: 'sp500',
        label: 'S&P 500',
        universe: fund('IVV') ?? fund('VOO') ?? fund('SPY'),
        note: 'Not installed. On the iShares IVV page, open Holdings and download the CSV once, then import it under Advanced Research. That file is the fund’s holdings, not an S&P membership feed.',
      },
      {
        id: 'vti',
        label: 'VTI',
        universe: fund('VTI'),
        note: 'Not installed. On the Vanguard VTI page, open Portfolio composition and download the full holdings file once, then import it under Advanced Research.',
      },
      {
        id: 'qqq',
        label: 'Nasdaq-100',
        universe: fund('QQQ'),
        note: 'Not installed. On the Invesco QQQ page, export the holdings once, then import that file under Advanced Research. It is the fund file, not a Nasdaq membership feed.',
      },
    ];
    for (const row of saved) {
      const fundTicker = row.currentVersion?.fundTicker ?? '';
      if (['IVV', 'VOO', 'SPY', 'VTI', 'QQQ'].includes(fundTicker)) continue;
      rows.push({ id: row.id, label: collectionDisplayName(row.name), universe: row });
    }
    if (universes.bookmarkDerived && universes.bookmarkDerived.tickers.length > 0) {
      rows.push({ id: universes.bookmarkDerived.id, label: 'Saved candidates', universe: universes.bookmarkDerived });
    }
    for (const row of universes.curated) {
      rows.push({
        id: row.id,
        label: `Examples · ${collectionDisplayName(row.name)}`,
        universe: row,
        note: 'Example companies included with OptionScout. Not an official index.',
      });
    }
    return rows;
  }, [universes]);
  const restoredDirectory = directories.find((row) => row.id === directoryId);
  const restoredHasCompanies = (restoredDirectory?.universe?.tickers.length ?? 0) > 0;
  const activeDirectoryId =
    directoryChosen && restoredHasCompanies
      ? directoryId
      : (directories.find((row) => (row.universe?.tickers.length ?? 0) > 0)?.id ?? directoryId);
  useEffect(() => {
    const listsReady = universes.curated.length > 0 || universes.saved.length > 0 || universes.bookmarkDerived != null;
    const hasDraft = selectedTickers.length > 0 || manualTickers.trim().length > 0 || directoryChosen;
    if (!listsReady && !hasDraft) return;
    writeDiscoverDraft({
      universeId: selectedUniverseId,
      directoryId: directoryChosen ? directoryId : activeDirectoryId,
      selectedTickers,
      manualTickers,
      profileId,
    });
  }, [
    universes,
    directoryChosen,
    directoryId,
    activeDirectoryId,
    selectedUniverseId,
    selectedTickers,
    manualTickers,
    profileId,
  ]);
  useEffect(() => {
    const active = directories.find((row) => row.id === activeDirectoryId);
    if (!active?.universe || selectedUniverseId === active.universe.id) return;
    // A restored draft already names its category. Do not replace that selection on remount.
    if (directoryChosen && selectedUniverseId) return;
    setSelectedUniverseId(active.universe.id);
  }, [activeDirectoryId, directories, selectedUniverseId, directoryChosen]);

  if (status === 'loading') {
    return <Typography>Loading Explore Stocks.</Typography>;
  }
  if (status === 'error') {
    return <Alert severity="error">{error ?? 'API unavailable.'}</Alert>;
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h4">Explore Stocks</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Choose a strategy, check up to 20 companies, then find LEAPS.
          </Typography>
        </Box>
        <Button component={RouterLink} to="/leaps" variant="outlined">
          Find One Stock
        </Button>
      </Stack>

      {diagnosticMode ? (
        <Alert severity="warning" icon={false}>
          <Typography variant="subtitle2">Diagnostic Mode — {allowlist.join(', ')} only.</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Live Smart Scan is restricted to these tickers (max {maxSelectable} companies, budget ≤ {maxBudget}). Unsupported
            tickers are blocked on purpose — not because credentials failed. Switch to Normal in Settings when ready.
          </Typography>
          <Button size="small" sx={{ mt: 1 }} variant="contained" onClick={selectDiagnosticTickers}>
            Select {allowlist.join(', ')}
          </Button>
        </Alert>
      ) : null}
      {normalLiveReady && showAdvanced ? (
        <Alert severity="success" icon={false}>
          <Typography variant="subtitle2">Smart Scan Ready — Check up to {maxSelectable} companies.</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Each step examines at most {operationCap} companies and {maxBudget} contracts. Status: {researchStatusLabel}.
          </Typography>
        </Alert>
      ) : null}

      {!authenticated ? (
        <Alert severity="warning">
          Sign in required.{' '}
          <Link component={RouterLink} to="/broker">
            Go to Broker & Data
          </Link>
        </Alert>
      ) : null}

      <SuccessToast message={notice} />
      {notice && notice !== research.discover.pendingSearch?.notice ? (
        <Alert severity={scan?.status === 'failed' || scanBlocked ? 'error' : 'info'}>{notice}</Alert>
      ) : null}

      <DiscoverOnboarding />

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          onClick={() => {
            setShowPrevious(true);
            void research.restoreDiscoverLatest().then((ok) => {
              setLocalNotice(
                ok
                  ? 'Viewing saved results only. No market data was requested.'
                  : 'No saved research to open.',
              );
            });
          }}
        >
          View Previous Results
        </Button>
        <Button variant="text" onClick={() => setShowPrevious((value) => !value)}>
          {showPrevious ? 'Hide previous results' : 'Previous Results'}
        </Button>
      </Stack>
      <Collapse in={showPrevious}>
      <RecentSearchesPanel
        title="Previous Results"
        sessions={research.recentDiscover}
        activeId={scan?.scanId}
        onContinueLast={() => {
          void research.restoreDiscoverLatest().then((ok) => {
            setLocalNotice(
              ok
                ? 'Viewing saved results only. No market data was requested.'
                : 'No saved research to open.',
            );
          });
        }}
        onViewSaved={(id) => {
          void research.restoreDiscoverById(id).then((ok) => {
            setLocalNotice(
              ok
                ? 'Viewing saved results only — no provider requests were made.'
                : 'Could not open that saved session.',
            );
          });
        }}
        onStartFresh={() => {
          research.clearDiscoverActive();
          setLocalNotice('The open results were cleared. Saved sessions are unchanged. Check companies, then use Find Matching LEAPS.');
        }}
        onDelete={(id) => {
          void research.removeSession(id).then(() => setLocalNotice('Saved research session deleted.'));
        }}
        onOpen={(id) => {
          void research.restoreDiscoverById(id);
        }}
      />
      </Collapse>

      {research.discover.pendingSearch ? (
        <Alert severity="info" icon={false}>
          Starting new research for {research.discover.pendingSearch.tickers.join(', ')} · {research.discover.pendingSearch.profileName} revision {research.discover.pendingSearch.profileRevision}.
          The previous results stay saved. This search does not use View Previous Results.
        </Alert>
      ) : null}
      {scan ? (
        <Alert severity="info" icon={false}>
          Open research: {(scan.tickers.length <= 20
            ? scan.tickers.map((row) => row.ticker).join(', ')
            : `${scan.tickers.slice(0, 8).map((row) => row.ticker).join(', ')} and ${scan.tickers.length - 8} more`) || scan.universeLabel} · {scan.profileName} revision {scan.profileRevision}.
          {selectedTickers.join(',') !== scan.tickers.map((row) => row.ticker).join(',')
            ? ' The checked companies are for the next Find Matching LEAPS. They are separate from this open research.'
            : ' Find Matching LEAPS starts another session. It does not replace this one until you press it.'}
        </Alert>
      ) : null}

      {formOpen ? (
        <Paper sx={{ p: 2 }}>
          <BeginnerStockForm
            profiles={profiles}
            profileId={profileId}
            onProfileId={setProfileId}
            directories={directories}
            activeDirectoryId={activeDirectoryId}
            onSelectDirectory={(id) => {
              setDirectoryChosen(true);
              setDirectoryId(id);
              const next = directories.find((row) => row.id === id);
              setSelectedUniverseId(next?.universe?.id ?? '');
              setSelectedTickers([]);
            }}
            selectedTickers={selectedTickers}
            onSelectedTickers={setSelectedTickers}
            addTickerDraft={addTickerDraft}
            onAddTickerDraft={setAddTickerDraft}
            onAddTicker={() => {
              const checked = validateTickerSymbol(addTickerDraft);
              if (!addTickerDraft.trim()) return;
              if (!checked.ok) {
                setNotice(`${checked.reason}. Symbols are never altered to make them fit.`);
                return;
              }
              if (!selectedTickers.includes(checked.ticker) && selectedTickers.length >= maxSelectable) {
                setNotice(`${checked.ticker} was not added: at most ${maxSelectable} companies. Remove one first.`);
                return;
              }
              setSelectedTickers((current) => (current.includes(checked.ticker) ? current : [...current, checked.ticker]));
              setAddTickerDraft('');
            }}
            onImportList={(name, tickers) => {
              if (tickers.length === 0) return;
              void createDiscoveryUniverse({
                name,
                tickers,
                sourceKind: 'csv-import',
                sourceLabel: 'Pasted or uploaded symbols',
              }).then(async (saved) => {
                await reloadUniverses();
                setDirectoryId(saved.id);
                setSelectedUniverseId(saved.id);
                setSelectedTickers([]);
                setNotice(`${saved.tickers.length} companies are in the picker. Check up to ${maxSelectable}.`);
              }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Could not save those symbols.'));
            }}
            busy={busy}
            findBlocked={scanBlocked}
            onFind={() => void runFind()}
            operationCap={operationCap}
            budget={Math.min(budget, maxBudget)}
          />
        </Paper>
      ) : (
        <Button size="small" onClick={() => setFormOpen(true)}>
          Change companies
        </Button>
      )}
      <Button size="small" onClick={() => setShowAdvanced((value) => !value)}>
        {showAdvanced ? 'Hide Advanced Research' : 'Advanced Research'}
      </Button>
      <Collapse in={showAdvanced}>
      <DiscoverSetupPanels
        summary={research.discover.summary}
        scan={scan}
        busy={busy}
        diagnosticMode={diagnosticMode}
        allowlist={allowlist}
        maxSelectable={maxSelectable}
        maxBudget={maxBudget}
        universes={universes}
        selectedUniverse={selectedUniverse}
        selectedTickers={selectedTickers}
        onSelectUniverse={setSelectedUniverseId}
        onSelectedTickers={setSelectedTickers}
        profiles={profiles}
        profileId={profileId}
        onProfileId={setProfileId}
        budget={budget}
        onBudget={setBudget}
        scanPriority={scanPriority}
        onScanPriority={setScanPriority}
        scanBlocked={scanBlocked}
        blockedTickers={blockedTickers}
        manualTickers={manualTickers}
        onManualTickers={setManualTickers}
        addTickerDraft={addTickerDraft}
        onAddTickerDraft={setAddTickerDraft}
        onAddTicker={() => {
          const checked = validateTickerSymbol(addTickerDraft);
          if (!addTickerDraft.trim()) return;
          if (!checked.ok) {
            setNotice(`${checked.reason}. Symbols are never altered to make them fit.`);
            return;
          }
          const raw = checked.ticker;
          if (!selectedTickers.includes(raw) && selectedTickers.length >= maxSelectable) {
            setNotice(`${raw} was not added: at most ${maxSelectable} companies per batch. Remove one first.`);
            return;
          }
          const inCollection = selectedUniverse?.tickers.includes(raw) ?? false;
          setSelectedTickers((current) => (current.includes(raw) ? current : [...current, raw].slice(0, maxSelectable)));
          setAddTickerDraft('');
          setNotice(
            inCollection
              ? `${raw} is in this collection and was added.`
              : `${raw} is not in this collection. Added anyway. Provider verification is unavailable until a scan runs — this is not a claim of option support.`,
          );
        }}
        onFindLeaps={() => void runFind()}
        onExploreEntireList={() => void runFind()}
        entireListDisabled={busy || !authenticated || scanBlocked || !selectedUniverse || selectedUniverse.tickers.length === 0}
        findDisabled={busy || !authenticated || scanBlocked || pendingTickers.length === 0}
        findDisabledReason={
          !authenticated
            ? 'Scan Selected Stocks is unavailable until you sign in.'
            : pendingTickers.length === 0
              ? 'Scan Selected Stocks is unavailable until at least one company is selected.'
              : scanBlocked
                ? `Scan Selected Stocks is unavailable because Diagnostic Mode only allows ${allowlist.join(', ')}.`
                : null
        }
        onExploreNext={() => void runNextCompanies()}
        onLookMore={() => void runMore()}
        onRetry={() => void runRetryCompanies()}
        onCancel={() => void runCancel()}
        onReviewSaved={() => {
          const id = research.discover.summary?.id ?? scan?.scanId;
          if (!id) return;
          void research.restoreDiscoverById(id).then((ok) => {
            setLocalNotice(ok ? 'Viewing saved results only — no provider requests were made.' : 'Could not open that saved session.');
          });
        }}
        onManage={(catalogId, fundTicker) => {
          setManageCatalogId(catalogId);
          setManageFund(fundTicker);
          setManageOpen(true);
        }}
        onNotice={setNotice}
        profilesFromServer={profilesFromServer}
      />
      </Collapse>
      <StockCollectionsDialog
        open={manageOpen}
        catalogId={manageCatalogId}
        fundTicker={manageFund}
        savedUniverses={universes.saved}
        disabled={busy || !authenticated}
        onClose={() => setManageOpen(false)}
        onNotice={setNotice}
        onSaved={async (universeId, savedNotice) => {
          await reloadUniverses();
          setSelectedUniverseId(universeId);
          setNotice(savedNotice);
        }}
        onUseCollection={(universeId) => {
          if (universeId) setSelectedUniverseId(universeId);
          setManageOpen(false);
          setNotice('That collection is selected for a new scan. Saved research was not changed.');
        }}
      />
      {strategyMismatch ? (
        <Alert severity="warning" icon={false}>
          Display controls changed since this scan started (locked to “{scan?.profileName}” rev {scan?.profileRevision}).
          Find LEAPS starts a new scan with the strategy chosen below. It does not rewrite the saved session.
        </Alert>
      ) : null}

      {/* 2. Scan progress (honest backend-driven animation) */}
      {scan ? (
        <Stack spacing={1.5}>
          {scan.scanId === 'ux-preview-discover' ? (
            <Alert severity="info" icon={false}>
              Client-only UX preview fixtures — no brokerage Smart Scan was started.
            </Alert>
          ) : null}
          {scan.simulated && scan.scanId !== 'ux-preview-discover' && !policy?.liveModeActive ? (
            <Alert severity="info" icon={false}>
              {scan.simulatedNotice ?? 'Using labeled simulated multi-ticker fixtures for this session.'}
            </Alert>
          ) : null}
          {scan.simulated && scan.scanId !== 'ux-preview-discover' && policy?.liveModeActive ? (
            <Alert severity="warning" icon={false}>
              Unexpected simulated result while live Diagnostic Mode is active. Check ticker allowlist and live gates — this
              is not treated as a silent credential fallback.
            </Alert>
          ) : null}
          {busy ? (
            <Button size="small" variant="outlined" onClick={pauseSearch}>
              Pause
            </Button>
          ) : null}
          <SmartScanProgressPanel
            scan={scan}
            stillWorking={busy || scan.status === 'running'}
            onScanMore={() => void runMore()}
            onScanNextCompanies={() => void runNextCompanies()}
            onRunNewSearch={runNewSearch}
            onCancel={() => void runCancel()}
            scanMoreDisabled={busy || research.discover.viewMode === 'view-saved'}
            scanNextDisabled={busy || research.discover.viewMode === 'view-saved'}
            cancelDisabled={busy}
          />
          <Collapse in={showAdvanced}>
          <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack spacing={1.5} direction={{ xs: 'column', md: 'row' }}>
              <TextField
                select
                size="small"
                label="Scan More mode"
                value={scanMoreMode}
                onChange={(event) => setScanMoreMode(event.target.value as 'diversified' | 'focus-ticker')}
                sx={{ minWidth: 260 }}
              >
                <MenuItem value="diversified">Diversified across current group</MenuItem>
                <MenuItem value="focus-ticker">Focus one company</MenuItem>
              </TextField>
              {scanMoreMode === 'focus-ticker' ? (
                <TextField
                  select
                  size="small"
                  label="Focus ticker"
                  value={focusTicker}
                  onChange={(event) => setFocusTicker(event.target.value)}
                  sx={{ minWidth: 160 }}
                >
                  {scan.tickers.map((row) => (
                    <MenuItem key={row.ticker} value={row.ticker}>
                      {row.ticker}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
            </Stack>
          </Paper>
          </Collapse>
        </Stack>
      ) : null}

      {/* 3. Results: Gallery/List, sticky filters, persistent compare */}
      {scan ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <DiscoverResultsSection
            scan={scan}
            profile={scanProfile}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            uiPrefs={research.discover.uiPrefs}
            onUiPrefsChange={research.updateDiscoverUiPrefs}
            onReview={setDetailId}
            onSave={(candidate) => {
              void saveFinderBookmark(candidate, {
                profileId: scan.profileId,
                profileRevision: scan.profileRevision,
                scanId: scan.scanId,
              })
                .then(() => setNotice(`Saved ${candidate.underlying} locally. Not a brokerage position.`))
                .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Save failed.'));
            }}
            beginnerMode={beginnerMode}
          />

          <CompareTray
            selectedCount={selectedIds.length}
            onClear={() => setSelectedIds([])}
            onCompare={() => {
              const el = document.getElementById('discover-contract-compare');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />

          {selectedIds.length >= 2 ? (
            <Box sx={{ mt: 3 }} id="discover-contract-compare">
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Compare selected
              </Typography>
              <ContractComparisonPanel
                candidates={selectedIds.map((id) => candidateById.get(id)!).filter(Boolean)}
                profile={scanProfile}
                beginnerMode={beginnerMode}
              />
            </Box>
          ) : null}
        </Paper>
      ) : null}

      {/* Advanced diagnostics (optional) */}
      {scan ? (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Button onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? 'Hide Advanced Mode' : 'Show Advanced Mode (full diagnostics)'}
          </Button>
          <Collapse in={showAdvanced}>
            <Stack spacing={2} sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {scan.progress.coverageNote} Data completeness and strategy fit are separate. Fully evaluated means enough
                measurements to classify fit — not a buy recommendation.
              </Typography>
              <Typography variant="body2">
                Companies selected {scan.progress.companiesSelected} · chains retrieved {scan.progress.companiesChainRetrieved}{' '}
                · with evaluated contracts {scan.progress.companiesWithEvaluatedContracts} · not yet scanned{' '}
                {scan.progress.companiesNotYetScanned} · unsupported/empty {scan.progress.companiesUnsupportedOrEmpty} ·
                errors/rate-limits {scan.progress.companiesRateLimitedOrError}
              </Typography>
              <Typography variant="body2">
                Eligible discovered {scan.progress.eligibleContractsDiscovered} · fully evaluated{' '}
                {scan.progress.contractsFullyEvaluated} · partial {scan.progress.contractsPartiallyEvaluated} · not yet
                evaluated {scan.progress.contractsNotYetEvaluated} · missing quotes/Greeks{' '}
                {scan.progress.missingQuotesOrGreeks}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.examined}>
                  <Chip
                    size="small"
                    label={`Examined ${scan.progress.contractsFullyEvaluated + scan.progress.contractsPartiallyEvaluated}`}
                  />
                </Tooltip>
                <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.verifiedMatches}>
                  <Chip size="small" label={`Verified matches ${verifiedMatchCount}`} />
                </Tooltip>
                <Tooltip title={FINDER_PROGRESS_CHIP_TOOLTIPS.unverifiedCandidates}>
                  <Chip size="small" label={`Unverified ${unverifiedCount}`} />
                </Tooltip>
                <Chip size="small" label={`Near ${nearMatchCount}`} />
              </Stack>
              <Stack spacing={0.75}>
                {scan.insights.map((insight) => (
                  <Typography key={insight.id} variant="body2">
                    {insight.text}
                  </Typography>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block">
                Strategy {scan.profileName} rev {scan.profileRevision} · started {scan.startedAt} · {scan.universeLabel} ·{' '}
                {scan.dataSource}
              </Typography>
            </Stack>
          </Collapse>
        </Paper>
      ) : null}

      {detailId && candidateById.get(detailId) ? (
        <ContractReviewPanel
          candidate={candidateById.get(detailId)!}
          profile={scanProfile}
          beginnerMode={beginnerMode}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {settings?.portfolioView === 'demo' ? (
        <Alert severity="info" icon={false}>
          Portfolio view is the synthetic demo book. Smart Scan uses labeled simulated fixtures unless Diagnostic Mode live
          gates are active.
        </Alert>
      ) : null}
    </Stack>
  );
}

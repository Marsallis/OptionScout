/**
 * Survives React route remounts so Discover/Finder research is not discarded on navigation.
 * Hydrates latest SQLite session on auth without creating brokerage requests.
 *
 * UI preferences are scoped to the active research session (stored server-side in ui_prefs_json).
 * Unsent edits are mirrored to localStorage so a refresh before the debounced PATCH lands keeps them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  researchUiPrefsSchema,
  type DiscoverResearchRestore,
  type FinderResearchRestore,
  type FinderScanResult,
  type ResearchSessionSummary,
  type ResearchUiPrefs,
  type SmartScanResult,
  type StrategyProfile,
} from '@optionscout/shared';
import {
  deleteResearchSession,
  fetchLatestResearchSession,
  fetchResearchSession,
  fetchResearchSessions,
  patchResearchSessionUiPrefs,
} from '../api/client';
import { useAppState } from './AppState';

export type PendingDiscoverSearch = {
  tickers: string[];
  profileName: string;
  profileRevision: number;
  notice: string;
};

export type DiscoverWorkspace = {
  scan: SmartScanResult | null;
  strategySnapshot: StrategyProfile | null;
  orderedTickerQueue: string[];
  companyCursor: number;
  evaluatedOcc: string[];
  selectedIds: string[];
  uiPrefs: ResearchUiPrefs;
  viewMode: 'view-saved' | 'continue-ready' | 'live';
  summary: ResearchSessionSummary | null;
  notice: string | null;
  pendingSearch: PendingDiscoverSearch | null;
};

export type FinderWorkspace = {
  scan: FinderScanResult | null;
  strategySnapshot: StrategyProfile | null;
  evaluatedOcc: string[];
  selectedIds: string[];
  uiPrefs: ResearchUiPrefs;
  viewMode: 'view-saved' | 'continue-ready' | 'live';
  summary: ResearchSessionSummary | null;
  notice: string | null;
};

export type UiPrefsUpdate = ResearchUiPrefs | ((current: ResearchUiPrefs) => ResearchUiPrefs);

type ResearchWorkspaceValue = {
  discover: DiscoverWorkspace;
  finder: FinderWorkspace;
  recentDiscover: ResearchSessionSummary[];
  recentFinder: ResearchSessionSummary[];
  setDiscoverScan: (scan: SmartScanResult | null, extras?: Partial<DiscoverWorkspace>) => void;
  setFinderScan: (scan: FinderScanResult | null, extras?: Partial<FinderWorkspace>) => void;
  setDiscoverSelectedIds: (ids: string[]) => void;
  setFinderSelectedIds: (ids: string[]) => void;
  updateDiscoverUiPrefs: (update: UiPrefsUpdate) => void;
  updateFinderUiPrefs: (update: UiPrefsUpdate) => void;
  setDiscoverNotice: (notice: string | null) => void;
  setFinderNotice: (notice: string | null) => void;
  claimDiscoverSearch: (pending: PendingDiscoverSearch) => void;
  /** Progress for the scan already on screen. Ignores a different session id. */
  applyDiscoverProgress: (scan: SmartScanResult) => void;
  currentDiscoverGeneration: () => number;
  clearDiscoverActive: () => void;
  clearFinderActive: () => void;
  refreshRecent: () => Promise<void>;
  restoreDiscoverLatest: () => Promise<boolean>;
  restoreDiscoverById: (id: string) => Promise<boolean>;
  restoreFinderLatest: () => Promise<boolean>;
  restoreFinderById: (id: string) => Promise<boolean>;
  removeSession: (id: string) => Promise<void>;
};

type PrefsKind = 'discover' | 'finder';

export const UI_PREFS_PERSIST_DELAY_MS = 400;

const CARRY_OVER_KEYS: Record<PrefsKind, ReadonlyArray<keyof ResearchUiPrefs>> = {
  discover: ['discoverView', 'discoverGroupMode', 'discoverFilters', 'discoverSortValue'],
  finder: ['finderView', 'finderSort', 'finderFilters', 'finderPresentation'],
};

const lastPrefsKey = (kind: PrefsKind) => `optionscout.researchPrefs.last.${kind}`;
const sessionDraftKey = (id: string) => `optionscout.researchPrefs.session.${id}`;
const LEGACY_DISCOVER_KEYS = {
  view: 'optionscout.discoverResultsView',
  filters: 'optionscout.discoverResultFilters',
  group: 'optionscout.discoverGroupMode',
};

function isPersistableSessionId(id: string | undefined | null): id is string {
  return Boolean(id) && !id!.startsWith('ux-preview');
}

function readStoredPrefs(key: string): ResearchUiPrefs | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = researchUiPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStoredPrefs(key: string, prefs: ResearchUiPrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function pickCarryOver(kind: PrefsKind, prefs: ResearchUiPrefs): ResearchUiPrefs {
  const out: Record<string, unknown> = {};
  for (const key of CARRY_OVER_KEYS[kind]) {
    if (prefs[key] !== undefined) out[key] = prefs[key];
  }
  return out as ResearchUiPrefs;
}

function legacyDiscoverPrefs(): ResearchUiPrefs {
  const out: ResearchUiPrefs = {};
  try {
    const view = localStorage.getItem(LEGACY_DISCOVER_KEYS.view);
    if (view === 'list' || view === 'gallery') out.discoverView = view;
    const group = localStorage.getItem(LEGACY_DISCOVER_KEYS.group);
    if (group === 'all' || group === 'by-company') out.discoverGroupMode = group;
    const filters = localStorage.getItem(LEGACY_DISCOVER_KEYS.filters);
    if (filters) {
      const parsed: unknown = JSON.parse(filters);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.discoverFilters = parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Last-used display preferences for a fresh session (never carries compare selections). */
export function carryOverPrefs(kind: PrefsKind): ResearchUiPrefs {
  const stored = readStoredPrefs(lastPrefsKey(kind));
  if (stored) return pickCarryOver(kind, stored);
  return kind === 'discover' ? legacyDiscoverPrefs() : {};
}

function compatibleSelection(
  ids: string[] | undefined,
  candidates: ReadonlyArray<{ id: string }>,
): { kept: string[]; dropped: number } {
  if (!ids || ids.length === 0) return { kept: [], dropped: 0 };
  const known = new Set(candidates.map((row) => row.id));
  const kept = [...new Set(ids)].filter((id) => known.has(id)).slice(0, 4);
  return { kept, dropped: ids.length - kept.length };
}

function droppedNotice(dropped: number): string | null {
  if (dropped <= 0) return null;
  return `${dropped} saved comparison selection${dropped === 1 ? ' is' : 's are'} not part of this session's results and ${
    dropped === 1 ? 'was' : 'were'
  } removed.`;
}

function joinNotices(...parts: Array<string | null | undefined>): string | null {
  const text = parts.filter((part): part is string => Boolean(part && part.trim())).join(' ');
  return text || null;
}

function mergeRestoredPrefs(
  sessionId: string,
  server: ResearchUiPrefs,
  candidates: ReadonlyArray<{ id: string }>,
): { prefs: ResearchUiPrefs; selectedIds: string[]; dropped: number; hasDraft: boolean } {
  const draft = readStoredPrefs(sessionDraftKey(sessionId));
  const merged: ResearchUiPrefs = { ...server, ...(draft ?? {}) };
  const { kept, dropped } = compatibleSelection(merged.selectedCompareIds, candidates);
  return { prefs: { ...merged, selectedCompareIds: kept }, selectedIds: kept, dropped, hasDraft: draft != null };
}

const EMPTY_DISCOVER: DiscoverWorkspace = {
  scan: null,
  strategySnapshot: null,
  orderedTickerQueue: [],
  companyCursor: 0,
  evaluatedOcc: [],
  selectedIds: [],
  uiPrefs: {},
  viewMode: 'live',
  summary: null,
  notice: null,
  pendingSearch: null,
};

const EMPTY_FINDER: FinderWorkspace = {
  scan: null,
  strategySnapshot: null,
  evaluatedOcc: [],
  selectedIds: [],
  uiPrefs: {},
  viewMode: 'live',
  summary: null,
  notice: null,
};

const ResearchWorkspaceContext = createContext<ResearchWorkspaceValue | null>(null);

function applyDiscoverRestore(restored: DiscoverResearchRestore): { workspace: DiscoverWorkspace; hasDraft: boolean } {
  const merged = mergeRestoredPrefs(restored.summary.id, restored.uiPrefs, restored.result.candidates);
  return {
    hasDraft: merged.hasDraft || merged.dropped > 0,
    workspace: {
      scan: restored.result,
      strategySnapshot: restored.strategySnapshot,
      orderedTickerQueue: restored.orderedTickerQueue,
      companyCursor: restored.companyCursor,
      evaluatedOcc: restored.evaluatedOcc,
      selectedIds: merged.selectedIds,
      uiPrefs: merged.prefs,
      viewMode: restored.viewMode,
      summary: restored.summary,
      notice: joinNotices(restored.summary.historicalNotice, droppedNotice(merged.dropped)),
      pendingSearch: null,
    },
  };
}

function applyFinderRestore(restored: FinderResearchRestore): { workspace: FinderWorkspace; hasDraft: boolean } {
  const merged = mergeRestoredPrefs(restored.summary.id, restored.uiPrefs, restored.result.candidates);
  return {
    hasDraft: merged.hasDraft || merged.dropped > 0,
    workspace: {
      scan: restored.result,
      strategySnapshot: restored.strategySnapshot,
      evaluatedOcc: restored.evaluatedOcc,
      selectedIds: merged.selectedIds,
      uiPrefs: merged.prefs,
      viewMode: restored.viewMode,
      summary: restored.summary,
      notice: joinNotices(restored.summary.historicalNotice, droppedNotice(merged.dropped)),
    },
  };
}

export function ResearchWorkspaceProvider({ children }: { children: ReactNode }) {
  const { status, session } = useAppState();
  const [discover, setDiscover] = useState<DiscoverWorkspace>(EMPTY_DISCOVER);
  const [finder, setFinder] = useState<FinderWorkspace>(EMPTY_FINDER);
  const [recentDiscover, setRecentDiscover] = useState<ResearchSessionSummary[]>([]);
  const [recentFinder, setRecentFinder] = useState<ResearchSessionSummary[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const discoverRef = useRef(discover);
  const finderRef = useRef(finder);
  discoverRef.current = discover;
  finderRef.current = finder;
  const persistTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Increments when a new search or an explicit restore starts, so an older response cannot win. */
  const discoverGeneration = useRef(0);

  const schedulePersist = useCallback((sessionId: string, prefs: ResearchUiPrefs) => {
    if (!isPersistableSessionId(sessionId)) return;
    const parsed = researchUiPrefsSchema.safeParse(prefs);
    if (!parsed.success) return;
    const key = sessionDraftKey(sessionId);
    const serialized = JSON.stringify(parsed.data);
    writeStoredPrefs(key, parsed.data);
    const timers = persistTimers.current;
    const existing = timers.get(sessionId);
    if (existing) clearTimeout(existing);
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId);
        void patchResearchSessionUiPrefs(sessionId, { uiPrefs: parsed.data })
          .then(() => {
            try {
              if (localStorage.getItem(key) === serialized) localStorage.removeItem(key);
            } catch {
              /* ignore */
            }
          })
          .catch((reason: unknown) => {
            // The session no longer exists; keep nothing for it. Other failures keep the draft for the next restore.
            if (reason instanceof Error && /not found/i.test(reason.message)) removeStored(key);
          });
      }, UI_PREFS_PERSIST_DELAY_MS),
    );
  }, []);

  useEffect(() => {
    const timers = persistTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const refreshRecent = useCallback(async () => {
    if (!session?.authenticated) {
      setRecentDiscover([]);
      setRecentFinder([]);
      return;
    }
    try {
      const [d, f] = await Promise.all([
        fetchResearchSessions('discover'),
        fetchResearchSessions('finder'),
      ]);
      setRecentDiscover(d.sessions);
      setRecentFinder(f.sessions);
    } catch {
      /* ignore list failures */
    }
  }, [session?.authenticated]);

  const adoptDiscover = useCallback(
    (restored: DiscoverResearchRestore) => {
      const { workspace, hasDraft } = applyDiscoverRestore(restored);
      setDiscover(workspace);
      if (hasDraft) schedulePersist(restored.summary.id, workspace.uiPrefs);
    },
    [schedulePersist],
  );

  const adoptFinder = useCallback(
    (restored: FinderResearchRestore) => {
      const { workspace, hasDraft } = applyFinderRestore(restored);
      setFinder(workspace);
      if (hasDraft) schedulePersist(restored.summary.id, workspace.uiPrefs);
    },
    [schedulePersist],
  );

  const restoreDiscoverLatest = useCallback(async () => {
    const generation = ++discoverGeneration.current;
    try {
      const restored = await fetchLatestResearchSession('discover');
      if (generation !== discoverGeneration.current) return false;
      if (restored.kind !== 'discover') return false;
      if (discoverRef.current.pendingSearch) return false;
      if (discoverRef.current.viewMode === 'live' && discoverRef.current.scan?.scanId === restored.summary.id) {
        return true;
      }
      adoptDiscover(restored);
      return true;
    } catch {
      return false;
    }
  }, [adoptDiscover]);

  const restoreDiscoverById = useCallback(
    async (id: string) => {
      const generation = ++discoverGeneration.current;
      try {
        const restored = await fetchResearchSession(id);
        if (generation !== discoverGeneration.current) return false;
        if (restored.kind !== 'discover') return false;
        if (discoverRef.current.pendingSearch) return false;
        if (discoverRef.current.viewMode === 'live' && discoverRef.current.scan?.scanId === restored.summary.id) {
          return true;
        }
        adoptDiscover(restored);
        return true;
      } catch {
        return false;
      }
    },
    [adoptDiscover],
  );

  const restoreFinderLatest = useCallback(async () => {
    try {
      const restored = await fetchLatestResearchSession('finder');
      if (restored.kind !== 'finder') return false;
      adoptFinder(restored);
      return true;
    } catch {
      return false;
    }
  }, [adoptFinder]);

  const restoreFinderById = useCallback(
    async (id: string) => {
      try {
        const restored = await fetchResearchSession(id);
        if (restored.kind !== 'finder') return false;
        adoptFinder(restored);
        return true;
      } catch {
        return false;
      }
    },
    [adoptFinder],
  );

  useEffect(() => {
    if (status !== 'ready' || !session?.authenticated || hydrated) return;
    let cancelled = false;
    void (async () => {
      await refreshRecent();
      if (cancelled) return;
      // Hydrate display-only — never starts brokerage work.
      await restoreDiscoverLatest();
      await restoreFinderLatest();
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    status,
    session?.authenticated,
    hydrated,
    refreshRecent,
    restoreDiscoverLatest,
    restoreFinderLatest,
  ]);

  const updateDiscoverUiPrefs = useCallback(
    (update: UiPrefsUpdate) => {
      const current = discoverRef.current;
      const patch = typeof update === 'function' ? update(current.uiPrefs) : update;
      const uiPrefs = { ...current.uiPrefs, ...patch };
      const selectedIds = patch.selectedCompareIds ?? current.selectedIds;
      const next = { ...current, uiPrefs, selectedIds };
      discoverRef.current = next;
      setDiscover(next);
      writeStoredPrefs(lastPrefsKey('discover'), pickCarryOver('discover', uiPrefs));
      if (current.scan) schedulePersist(current.scan.scanId, { ...uiPrefs, selectedCompareIds: selectedIds });
    },
    [schedulePersist],
  );

  const updateFinderUiPrefs = useCallback(
    (update: UiPrefsUpdate) => {
      const current = finderRef.current;
      const patch = typeof update === 'function' ? update(current.uiPrefs) : update;
      const uiPrefs = { ...current.uiPrefs, ...patch };
      const selectedIds = patch.selectedCompareIds ?? current.selectedIds;
      const next = { ...current, uiPrefs, selectedIds };
      finderRef.current = next;
      setFinder(next);
      writeStoredPrefs(lastPrefsKey('finder'), pickCarryOver('finder', uiPrefs));
      if (current.scan) schedulePersist(current.scan.scanId, { ...uiPrefs, selectedCompareIds: selectedIds });
    },
    [schedulePersist],
  );

  const setDiscoverScan = useCallback(
    (scan: SmartScanResult | null, extras?: Partial<DiscoverWorkspace>) => {
      const current = discoverRef.current;
      const newSession = Boolean(scan && scan.scanId !== current.scan?.scanId);
      // A claim already advanced the generation and cleared the previous scan. Installing that
      // search must not advance it again, or the search would look stale to itself.
      if ((newSession && current.scan) || !scan) discoverGeneration.current += 1;
      const uiPrefs = extras?.uiPrefs ?? (newSession ? carryOverPrefs('discover') : current.uiPrefs);
      const selectedIds = extras?.selectedIds ?? (scan && !newSession ? current.selectedIds : []);
      const next: DiscoverWorkspace = {
        ...current,
        scan,
        viewMode: extras?.viewMode ?? (newSession ? 'live' : current.viewMode),
        notice: extras?.notice ?? current.notice,
        strategySnapshot: extras?.strategySnapshot ?? current.strategySnapshot,
        orderedTickerQueue: extras?.orderedTickerQueue ?? (scan?.tickers.map((t) => t.ticker) ?? current.orderedTickerQueue),
        companyCursor: extras?.companyCursor ?? scan?.companyCursor ?? current.companyCursor,
        evaluatedOcc: extras?.evaluatedOcc ?? current.evaluatedOcc,
        summary: extras?.summary ?? (newSession ? null : current.summary),
        uiPrefs: { ...uiPrefs, selectedCompareIds: selectedIds },
        selectedIds,
        pendingSearch: null,
      };
      discoverRef.current = next;
      setDiscover(next);
      if (scan && newSession) schedulePersist(scan.scanId, next.uiPrefs);
      void refreshRecent();
    },
    [refreshRecent, schedulePersist],
  );

  const claimDiscoverSearch = useCallback((pending: PendingDiscoverSearch) => {
    discoverGeneration.current += 1;
    const next: DiscoverWorkspace = {
      ...discoverRef.current,
      scan: null,
      summary: null,
      viewMode: 'live',
      pendingSearch: pending,
      notice: pending.notice,
      orderedTickerQueue: pending.tickers,
      companyCursor: 0,
      evaluatedOcc: [],
      selectedIds: [],
      strategySnapshot: discoverRef.current.strategySnapshot,
    };
    discoverRef.current = next;
    setDiscover(next);
  }, []);

  const currentDiscoverGeneration = useCallback(() => discoverGeneration.current, []);

  const applyDiscoverProgress = useCallback((scan: SmartScanResult) => {
    const current = discoverRef.current;
    if (current.pendingSearch || current.scan?.scanId !== scan.scanId) return;
    const next: DiscoverWorkspace = {
      ...current,
      scan,
      notice: scan.message || current.notice,
      companyCursor: scan.companyCursor ?? current.companyCursor,
      orderedTickerQueue: scan.tickers.length > 0 ? scan.tickers.map((row) => row.ticker) : current.orderedTickerQueue,
    };
    discoverRef.current = next;
    setDiscover(next);
  }, []);

  const setFinderScan = useCallback(
    (scan: FinderScanResult | null, extras?: Partial<FinderWorkspace>) => {
      const current = finderRef.current;
      const newSession = Boolean(scan && scan.scanId !== current.scan?.scanId);
      const uiPrefs = extras?.uiPrefs ?? (newSession ? carryOverPrefs('finder') : current.uiPrefs);
      const selectedIds = extras?.selectedIds ?? (scan && !newSession ? current.selectedIds : []);
      const next: FinderWorkspace = {
        ...current,
        scan,
        viewMode: 'live',
        notice: extras?.notice ?? current.notice,
        strategySnapshot: extras?.strategySnapshot ?? current.strategySnapshot,
        evaluatedOcc: extras?.evaluatedOcc ?? current.evaluatedOcc,
        summary: extras?.summary ?? (newSession ? null : current.summary),
        uiPrefs: { ...uiPrefs, selectedCompareIds: selectedIds },
        selectedIds,
      };
      finderRef.current = next;
      setFinder(next);
      if (scan && newSession) schedulePersist(scan.scanId, next.uiPrefs);
      void refreshRecent();
    },
    [refreshRecent, schedulePersist],
  );

  const value = useMemo<ResearchWorkspaceValue>(
    () => ({
      discover,
      finder,
      recentDiscover,
      recentFinder,
      setDiscoverScan,
      setFinderScan,
      setDiscoverSelectedIds(ids) {
        updateDiscoverUiPrefs({ selectedCompareIds: ids });
      },
      setFinderSelectedIds(ids) {
        updateFinderUiPrefs({ selectedCompareIds: ids });
      },
      updateDiscoverUiPrefs,
      updateFinderUiPrefs,
      setDiscoverNotice(notice) {
        const next = { ...discoverRef.current, notice };
        discoverRef.current = next;
        setDiscover(next);
      },
      setFinderNotice(notice) {
        setFinder((current) => ({ ...current, notice }));
      },
      claimDiscoverSearch,
      applyDiscoverProgress,
      currentDiscoverGeneration,
      clearDiscoverActive() {
        discoverGeneration.current += 1;
        const next = { ...EMPTY_DISCOVER, uiPrefs: carryOverPrefs('discover') };
        discoverRef.current = next;
        setDiscover(next);
      },
      clearFinderActive() {
        setFinder({ ...EMPTY_FINDER, uiPrefs: carryOverPrefs('finder') });
      },
      refreshRecent,
      restoreDiscoverLatest,
      restoreDiscoverById,
      restoreFinderLatest,
      restoreFinderById,
      async removeSession(id) {
        await deleteResearchSession(id);
        removeStored(sessionDraftKey(id));
        const pending = persistTimers.current.get(id);
        if (pending) {
          clearTimeout(pending);
          persistTimers.current.delete(id);
        }
        if (discoverRef.current.scan?.scanId === id) {
          discoverRef.current = EMPTY_DISCOVER;
          setDiscover(EMPTY_DISCOVER);
        }
        if (finderRef.current.scan?.scanId === id) setFinder(EMPTY_FINDER);
        await refreshRecent();
      },
    }),
    [
      discover,
      finder,
      recentDiscover,
      recentFinder,
      setDiscoverScan,
      setFinderScan,
      claimDiscoverSearch,
      applyDiscoverProgress,
      currentDiscoverGeneration,
      updateDiscoverUiPrefs,
      updateFinderUiPrefs,
      refreshRecent,
      restoreDiscoverLatest,
      restoreDiscoverById,
      restoreFinderLatest,
      restoreFinderById,
    ],
  );

  return <ResearchWorkspaceContext.Provider value={value}>{children}</ResearchWorkspaceContext.Provider>;
}

export function useResearchWorkspace(): ResearchWorkspaceValue {
  const ctx = useContext(ResearchWorkspaceContext);
  if (!ctx) throw new Error('useResearchWorkspace requires ResearchWorkspaceProvider');
  return ctx;
}

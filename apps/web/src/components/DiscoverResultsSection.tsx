import { useMemo, useState } from 'react';
import {
  BEGINNER_DISCOVERY_GROUP_LABELS,
  beginnerDiscoveryGroupForCandidate,
  EMPTY_DISCOVER_RESULT_FILTERS,
  type ResearchUiPrefs,
  assignRankingBadges,
  buildPlanFitSummary,
  filterDiscoverCandidates,
  formatUsd,
  sortCandidatesByFactualMetric,
  type BeginnerDiscoveryGroup,
  type DiscoverResultFilters,
  type FactualSortMetric,
  type FinderCandidate,
  type SmartScanResult,
  type StrategyProfile,
} from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { CandidateResultCard } from './CandidateResultCard';
import {
  DiscoverResultsToolbar,
  type DiscoverGroupMode,
  type DiscoverResultsView,
} from './DiscoverResultsToolbar';
import { DiscoverResultsList, type DiscoverListSortKey } from './DiscoverResultsList';
import { GlossaryTip } from './GlossaryTip';

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string; metric: FactualSortMetric }> = [
  { value: 'purchaseCost', label: 'Lowest cost', metric: 'purchaseCost' },
  { value: 'preferred-cost-distance', label: 'Closest to preferred budget', metric: 'preferred-cost-distance' },
  { value: 'delta', label: 'Highest delta', metric: 'delta' },
  { value: 'intrinsicPercent', label: 'Highest intrinsic %', metric: 'intrinsicPercent' },
  { value: 'dte', label: 'Longest DTE', metric: 'dte' },
  { value: 'bidAskSpread', label: 'Tightest bid/ask spread', metric: 'bidAskSpread' },
];

/** Saved preferences are untrusted JSON; keep only values whose shape matches the default filter. */
export function sanitizeDiscoverFilters(raw: Record<string, unknown> | undefined): DiscoverResultFilters {
  const out: Record<string, unknown> = { ...EMPTY_DISCOVER_RESULT_FILTERS };
  if (!raw) return { ...EMPTY_DISCOVER_RESULT_FILTERS };
  for (const [key, fallback] of Object.entries(EMPTY_DISCOVER_RESULT_FILTERS)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (Array.isArray(fallback)) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) out[key] = value;
    } else if (fallback === null) {
      if (value === null || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    } else if (typeof value === typeof fallback) {
      out[key] = value;
    }
  }
  return out as unknown as DiscoverResultFilters;
}

const LIST_SORT_KEYS: ReadonlyArray<DiscoverListSortKey> = [
  'ticker',
  'cost',
  'delta',
  'intrinsic',
  'dte',
  'spread',
  'eligibility',
  'checks',
  'freshness',
];

function parseListSort(raw: unknown): { key: DiscoverListSortKey; dir: 'asc' | 'desc' } {
  if (raw && typeof raw === 'object') {
    const { key, dir } = raw as { key?: unknown; dir?: unknown };
    if (LIST_SORT_KEYS.includes(key as DiscoverListSortKey) && (dir === 'asc' || dir === 'desc')) {
      return { key: key as DiscoverListSortKey, dir };
    }
  }
  return { key: 'cost', dir: 'asc' };
}

export function DiscoverResultsSection({
  scan,
  profile,
  selectedIds,
  onSelectedIdsChange,
  onReview,
  onSave,
  beginnerMode,
  uiPrefs,
  onUiPrefsChange,
}: {
  scan: SmartScanResult;
  profile: StrategyProfile;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onReview: (id: string) => void;
  onSave: (candidate: FinderCandidate) => void;
  beginnerMode: boolean;
  uiPrefs: ResearchUiPrefs;
  onUiPrefsChange: (patch: ResearchUiPrefs) => void;
}) {
  const view: DiscoverResultsView = uiPrefs.discoverView ?? 'gallery';
  const groupMode: DiscoverGroupMode = uiPrefs.discoverGroupMode ?? 'all';
  const filters = useMemo(() => sanitizeDiscoverFilters(uiPrefs.discoverFilters), [uiPrefs.discoverFilters]);
  const sortValue = SORT_OPTIONS.some((o) => o.value === uiPrefs.discoverSortValue)
    ? uiPrefs.discoverSortValue!
    : 'purchaseCost';
  const { key: listSortKey, dir: listSortDir } = parseListSort(uiPrefs.discoverFilters?.listSort);

  const setView = (next: DiscoverResultsView) => onUiPrefsChange({ discoverView: next });
  const setGroupMode = (next: DiscoverGroupMode) => onUiPrefsChange({ discoverGroupMode: next });
  const setSortValue = (next: string) => onUiPrefsChange({ discoverSortValue: next });
  const setFilters = (next: DiscoverResultFilters) =>
    onUiPrefsChange({ discoverFilters: { ...next, listSort: { key: listSortKey, dir: listSortDir } } });
  const setListSort = (key: DiscoverListSortKey, dir: 'asc' | 'desc') =>
    onUiPrefsChange({ discoverFilters: { ...filters, listSort: { key, dir } } });

  const [beginnerGroup, setBeginnerGroup] = useState<BeginnerDiscoveryGroup | 'all'>('best-matches');
  const allCandidates = scan.candidates;
  const beginnerCounts = useMemo(() => {
    const counts: Record<BeginnerDiscoveryGroup, number> = {
      'best-matches': 0,
      'near-matches': 0,
      'need-more-data': 0,
      'outside-plan': 0,
      'invalid-quotes': 0,
    };
    for (const candidate of allCandidates) counts[beginnerDiscoveryGroupForCandidate(candidate, profile)] += 1;
    return counts;
  }, [allCandidates, profile]);
  const inBeginnerGroup = useMemo(
    () =>
      beginnerGroup === 'all'
        ? allCandidates
        : allCandidates.filter((candidate) => beginnerDiscoveryGroupForCandidate(candidate, profile) === beginnerGroup),
    [allCandidates, beginnerGroup, profile],
  );
  const tickerOptions = useMemo(
    () => [...new Set(allCandidates.map((c) => c.underlying))].sort(),
    [allCandidates],
  );

  const filtered = useMemo(
    () => filterDiscoverCandidates(inBeginnerGroup, profile, filters),
    [inBeginnerGroup, profile, filters],
  );

  const sortMetric = (SORT_OPTIONS.find((o) => o.value === sortValue)?.metric ?? 'purchaseCost') as FactualSortMetric;

  const sortedVisible = useMemo(
    () => sortCandidatesByFactualMetric(filtered, profile, sortMetric),
    [filtered, profile, sortMetric],
  );

  const sortedForList = useMemo(() => {
    const rows = [...sortedVisible];
    const dir = listSortDir === 'asc' ? 1 : -1;
    const n = (v: string | null | undefined) => {
      if (v == null || v === '') return null;
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };
    rows.sort((a, b) => {
      const fitA = buildPlanFitSummary(a, profile);
      const fitB = buildPlanFitSummary(b, profile);
      let av: number | string | null = null;
      let bv: number | string | null = null;
      if (listSortKey === 'ticker') {
        av = a.underlying;
        bv = b.underlying;
      } else if (listSortKey === 'cost') {
        av = n(a.calculations.estimatedPurchaseCost);
        bv = n(b.calculations.estimatedPurchaseCost);
      } else if (listSortKey === 'delta') {
        av = a.greekVerification === 'aligned' ? n(a.delta) : null;
        bv = b.greekVerification === 'aligned' ? n(b.delta) : null;
      } else if (listSortKey === 'intrinsic') {
        av = n(a.calculations.intrinsicPercent);
        bv = n(b.calculations.intrinsicPercent);
      } else if (listSortKey === 'dte') {
        av = a.calculations.daysToExpiration;
        bv = b.calculations.daysToExpiration;
      } else if (listSortKey === 'spread') {
        av = n(a.calculations.bidAskSpreadPercent);
        bv = n(b.calculations.bidAskSpreadPercent);
      } else if (listSortKey === 'eligibility') {
        av = fitA.eligibility;
        bv = fitB.eligibility;
      } else if (listSortKey === 'checks') {
        av = fitA.passedCount;
        bv = fitB.passedCount;
      } else if (listSortKey === 'freshness') {
        av = fitA.dataConfidenceLabel;
        bv = fitB.dataConfidenceLabel;
      }
      if (av == null && bv == null) return a.id.localeCompare(b.id);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      if (av !== bv) return ((av as number) - (bv as number)) * dir;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }, [sortedVisible, listSortKey, listSortDir, profile]);

  const visibleIds = useMemo(() => new Set(sortedVisible.map((c) => c.id)), [sortedVisible]);
  const hiddenSelected = useMemo(
    () => selectedIds.filter((id) => !visibleIds.has(id)),
    [selectedIds, visibleIds],
  );
  const hiddenIdSet = useMemo(() => new Set(hiddenSelected), [hiddenSelected]);
  const hiddenCandidates = useMemo(
    () => allCandidates.filter((c) => hiddenIdSet.has(c.id)),
    [allCandidates, hiddenIdSet],
  );

  const badges = useMemo(() => assignRankingBadges(sortedVisible, profile), [sortedVisible, profile]);

  const companies = useMemo(() => {
    if (groupMode !== 'by-company') return [{ ticker: 'ALL', rows: sortedVisible }];
    const map = new Map<string, FinderCandidate[]>();
    for (const row of sortedVisible) {
      const list = map.get(row.underlying) ?? [];
      list.push(row);
      map.set(row.underlying, list);
    }
    return [...map.entries()].map(([ticker, rows]) => ({ ticker, rows }));
  }, [groupMode, sortedVisible]);

  function toggleCompare(id: string, checked: boolean) {
    onSelectedIdsChange(
      checked ? [...selectedIds.filter((x) => x !== id), id].slice(0, 4) : selectedIds.filter((x) => x !== id),
    );
  }

  function handleListSort(key: DiscoverListSortKey) {
    if (key === listSortKey) {
      setListSort(key, listSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setListSort(key, key === 'delta' || key === 'intrinsic' || key === 'checks' || key === 'dte' ? 'desc' : 'asc');
    }
  }

  const unevaluated = scan.progress.contractsNotYetEvaluated;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          3. Filter and compare results
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <GlossaryTip term="delta">Delta</GlossaryTip>
          {' · '}
          <GlossaryTip term="intrinsic">Intrinsic</GlossaryTip>
          {' · '}
          DTE
          {' · '}
          <GlossaryTip term="spread">Bid/ask spread</GlossaryTip>
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={beginnerGroup}
          onChange={(_event, value: BeginnerDiscoveryGroup | 'all' | null) => {
            if (value) setBeginnerGroup(value);
          }}
        >
          <ToggleButton value="best-matches">Best Matches ({beginnerCounts['best-matches']})</ToggleButton>
          <ToggleButton value="near-matches">Near Matches ({beginnerCounts['near-matches']})</ToggleButton>
          <ToggleButton value="need-more-data">Need More Data ({beginnerCounts['need-more-data']})</ToggleButton>
          <ToggleButton value="all">All Results ({allCandidates.length})</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">
          Counts are contracts already evaluated. {BEGINNER_DISCOVERY_GROUP_LABELS['outside-plan']}: {beginnerCounts['outside-plan']}.{' '}
          {BEGINNER_DISCOVERY_GROUP_LABELS['invalid-quotes']}: {beginnerCounts['invalid-quotes']}.
        </Typography>
        <TextField
          size="small"
          type="number"
          label="Max bid/ask spread %"
          value={filters.maxSpreadPercent ?? ''}
          helperText="Display filter only. It does not change the saved strategy."
          onChange={(event) =>
            setFilters({
              ...filters,
              maxSpreadPercent: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          sx={{ width: 180 }}
        />
      </Stack>

      <DiscoverResultsToolbar
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters({ ...EMPTY_DISCOVER_RESULT_FILTERS })}
        view={view}
        onViewChange={setView}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        sortValue={sortValue}
        onSortChange={setSortValue}
        sortOptions={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        tickerOptions={tickerOptions}
        showing={sortedVisible.length}
        total={allCandidates.length}
      />

      {scan.status === 'running' ? (
        <Alert severity="info" icon={false}>
          Research is still running. Counts below are partial and are not a final outcome.
        </Alert>
      ) : null}

      {sortedVisible.length === 0 && scan.status !== 'running' ? (
        <Alert severity="warning">
          <Typography variant="subtitle2">
            {beginnerGroup === 'best-matches' ? 'No Best Matches in the contracts evaluated so far.' : 'No evaluated results match these filters.'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {allCandidates.length === 0
              ? 'No contracts have been evaluated yet.'
              : beginnerGroup === 'best-matches'
                ? `${scan.progress.contractsFullyEvaluated} contracts were evaluated. That is not every LEAPS contract for these companies. Near Matches: ${beginnerCounts['near-matches']}. Need More Data: ${beginnerCounts['need-more-data']}.`
                : 'Broaden a filter, or choose All Results, to see the other evaluated contracts.'}
          </Typography>
          {unevaluated > 0 ? (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {unevaluated} contracts are not yet evaluated. Scan More Contracts looks at more contracts in companies already opened. It does not add companies.
            </Typography>
          ) : null}
          <Button size="small" sx={{ mt: 1 }} onClick={() => setFilters({ ...EMPTY_DISCOVER_RESULT_FILTERS })}>
            Clear Filters
          </Button>
        </Alert>
      ) : null}

      {hiddenSelected.length > 0 ? (
        <Alert severity="info" icon={false}>
          {hiddenSelected.length} selected contract{hiddenSelected.length === 1 ? '' : 's'} hidden by current filters —
          still in compare tray. Clear selection is explicit.
        </Alert>
      ) : null}

      {view === 'list' ? (
        <Paper variant="outlined" sx={{ p: 1 }}>
          <DiscoverResultsList
            candidates={sortedForList}
            profile={profile}
            selectedIds={selectedIds}
            compareDisabled={selectedIds.length >= 4}
            hiddenIds={hiddenIdSet}
            sortKey={listSortKey}
            sortDir={listSortDir}
            onSort={handleListSort}
            onToggleCompare={toggleCompare}
            onReview={onReview}
            onSave={onSave}
          />
        </Paper>
      ) : (
        <Stack spacing={2.5}>
          {companies.map(({ ticker, rows }) => (
            <Box key={ticker}>
              {groupMode === 'by-company' ? (
                <Typography variant="subtitle1" sx={{ fontWeight: 650, mb: 1 }}>
                  {ticker}
                  {scan.tickers.find((t) => t.ticker === ticker)?.companyName
                    ? ` · ${scan.tickers.find((t) => t.ticker === ticker)!.companyName}`
                    : ''}{' '}
                  · stock {formatUsd(scan.tickers.find((t) => t.ticker === ticker)?.underlyingPrice ?? null)}
                </Typography>
              ) : null}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  gap: 1.5,
                }}
              >
                {rows.map((candidate) => (
                  <CandidateResultCard
                    key={candidate.id}
                    candidate={candidate}
                    companyName={scan.tickers.find((t) => t.ticker === candidate.underlying)?.companyName}
                    profile={profile}
                    badges={badges.get(candidate.id) ?? []}
                    beginnerMode={beginnerMode}
                    showValidationDetails={!beginnerMode}
                    selected={selectedIds.includes(candidate.id)}
                    compareDisabled={selectedIds.length >= 4}
                    onToggleCompare={(checked) => toggleCompare(candidate.id, checked)}
                    onReview={() => onReview(candidate.id)}
                    onSave={() => onSave(candidate)}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      {hiddenCandidates.length > 0 ? (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Selected but hidden by filters
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 1.5,
            }}
          >
            {hiddenCandidates.map((candidate) => (
              <CandidateResultCard
                key={`hidden-${candidate.id}`}
                candidate={candidate}
                profile={profile}
                beginnerMode={beginnerMode}
                hiddenByFilter
                selected
                compareDisabled={false}
                onToggleCompare={(checked) => toggleCompare(candidate.id, checked)}
                onReview={() => onReview(candidate.id)}
                onSave={() => onSave(candidate)}
              />
            ))}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}

import { useMemo, useState } from 'react';
import {
  STOCK_COLLECTION_CATALOG,
  collectionDisplayName,
  collectionIsReady,
  installedHoldingsForFund,
  rankCompanyMatches,
  topHoldingsByWeight,
  SCAN_MORE_PRIORITIES,
  SCAN_MORE_PRIORITY_LABELS,
  type DiscoveryUniverse,
  type ScanMorePriority,
  type ResearchSessionSummary,
  type SmartScanResult,
  type StrategyProfile,
} from '@optionscout/shared';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

type CompanyOption = { ticker: string; name: string };

export function DiscoverSetupPanels({
  summary,
  scan,
  busy,
  diagnosticMode,
  allowlist,
  maxSelectable,
  maxBudget,
  universes,
  selectedUniverse,
  selectedTickers,
  onSelectUniverse,
  onSelectedTickers,
  profiles,
  profileId,
  onProfileId,
  budget,
  onBudget,
  scanPriority,
  onScanPriority,
  scanBlocked,
  blockedTickers,
  manualTickers,
  onManualTickers,
  addTickerDraft,
  onAddTickerDraft,
  onAddTicker,
  onFindLeaps,
  onExploreEntireList,
  entireListDisabled,
  findDisabled,
  findDisabledReason,
  onExploreNext,
  onLookMore,
  onRetry,
  onCancel,
  onReviewSaved,
  onManage,
  onNotice,
  profilesFromServer,
}: {
  summary: ResearchSessionSummary | null;
  scan: SmartScanResult | null;
  busy: boolean;
  diagnosticMode: boolean;
  allowlist: string[];
  maxSelectable: number;
  maxBudget: number;
  universes: { curated: DiscoveryUniverse[]; saved: DiscoveryUniverse[]; bookmarkDerived: DiscoveryUniverse | null };
  selectedUniverse: DiscoveryUniverse | null;
  selectedTickers: string[];
  onSelectUniverse: (id: string) => void;
  onSelectedTickers: (tickers: string[]) => void;
  profiles: StrategyProfile[];
  profileId: string;
  onProfileId: (id: string) => void;
  budget: number;
  onBudget: (value: number) => void;
  scanPriority: ScanMorePriority;
  onScanPriority: (value: ScanMorePriority) => void;
  scanBlocked: boolean;
  blockedTickers: string[];
  manualTickers: string;
  onManualTickers: (value: string) => void;
  addTickerDraft: string;
  onAddTickerDraft: (value: string) => void;
  onAddTicker: () => void;
  onFindLeaps: () => void;
  onExploreEntireList: () => void;
  entireListDisabled: boolean;
  findDisabled: boolean;
  findDisabledReason: string | null;
  onExploreNext: () => void;
  onLookMore: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onReviewSaved: () => void;
  onManage: (catalogId: string, fundTicker: string) => void;
  onNotice: (notice: string) => void;
  profilesFromServer: boolean;
}) {
  const [sectorFilter, setSectorFilter] = useState('');
  const [supportFilter, setSupportFilter] = useState<'any' | 'chain' | 'no-chain' | 'unchecked'>('any');
  const [allQuery, setAllQuery] = useState('');
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showScanSettings, setShowScanSettings] = useState(false);
  const [showUninstalledFunds, setShowUninstalledFunds] = useState(false);
  const activeProfile = profiles.find((row) => row.id === profileId) ?? profiles[0];
  const running = scan?.status === 'running';
  const canNext = !running && Boolean(scan?.canScanNextCompanies ?? summary?.canScanNextCompanies);
  const canMore = !running && Boolean(scan?.progress.canScanMore ?? summary?.canScanMoreContracts);
  const retryCount = scan?.companiesRetryable ?? summary?.companiesRetryable ?? 0;
  const primary = canNext ? 'next' : canMore ? 'more' : 'review';
  const sameSavedCollection = Boolean(
    summary &&
      selectedUniverse &&
      (summary.universeId === selectedUniverse.id ||
        (selectedUniverse.currentVersion && summary.universeVersionId === selectedUniverse.currentVersion.id)),
  );
  const supportByTicker = useMemo(() => {
    const map = new Map<string, string>();
    if (sameSavedCollection && scan) {
      for (const row of scan.tickers) map.set(row.ticker, row.status);
    }
    return map;
  }, [sameSavedCollection, scan]);
  const sectorChoices = useMemo(() => {
    const values = new Set(Object.values(selectedUniverse?.sectors ?? {}).filter(Boolean));
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [selectedUniverse]);
  const collectionOptions = useMemo((): CompanyOption[] => {
    if (!selectedUniverse) return [];
    return selectedUniverse.tickers
      .filter((ticker) => {
        if (sectorFilter && (selectedUniverse.sectors?.[ticker] ?? '') !== sectorFilter) return false;
        const status = supportByTicker.get(ticker);
        if (supportFilter === 'chain') return status === 'chain-loaded' || status === 'evaluated';
        if (supportFilter === 'no-chain') return status === 'unsupported' || status === 'empty';
        if (supportFilter === 'unchecked') return !status || status === 'pending';
        return true;
      })
      .map((ticker) => ({ ticker, name: selectedUniverse.companyNames[ticker] ?? ticker }));
  }, [selectedUniverse, sectorFilter, supportFilter, supportByTicker]);
  const selectedOptions = selectedTickers.map(
    (ticker) => collectionOptions.find((row) => row.ticker === ticker) ?? {
      ticker,
      name: selectedUniverse?.companyNames[ticker] ?? ticker,
    },
  );
  const crossMatches = useMemo(() => {
    const query = allQuery.trim();
    if (!query) return [];
    const rows: Array<{ ticker: string; name: string; id: string; label: string }> = [];
    const lists = [...universes.curated, ...universes.saved, ...(universes.bookmarkDerived ? [universes.bookmarkDerived] : [])];
    for (const universe of lists) {
      if (!collectionIsReady(universe)) continue;
      for (const ticker of universe.tickers) {
        rows.push({
          ticker,
          name: universe.companyNames[ticker] || ticker,
          id: universe.id,
          label: collectionDisplayName(universe.name),
        });
      }
    }
    return rankCompanyMatches(rows, query, 8);
  }, [allQuery, universes]);

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Continue existing research</Typography>
        {summary ? (
          <Stack spacing={1.25} sx={{ mt: 1.5 }}>
            <Typography variant="body1">
              {collectionDisplayName(summary.universeLabel)} · {summary.profileName} revision {summary.profileRevision}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Companies attempted: {summary.companiesProcessed} of {summary.companiesInUniverse}. Companies not yet examined:{' '}
            {summary.companiesRemaining}. Companies that need another try: {summary.companiesRetryable ?? 0}. Contracts
            evaluated: {summary.contractsEvaluated}. Attempted does not mean every company was successfully analyzed.
            </Typography>
            <Typography variant="body2">
              Restoring saved results does not contact the provider. The buttons that look further may request new quotes.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              {primary === 'next' ? (
                <Button variant="contained" disabled={busy || !canNext} onClick={onExploreNext}>
                  Explore Next Companies
                </Button>
              ) : null}
              {primary === 'more' ? (
                <Button variant="contained" disabled={busy || !canMore} onClick={onLookMore}>
                  Scan More Contracts
                </Button>
              ) : null}
              <Button variant="outlined" disabled={busy || !summary} onClick={onReviewSaved}>
                Review Saved Results
              </Button>
            </Stack>
            {primary === 'review' ? (
              <Typography variant="body2" color="text.secondary">
                No further company or contract batch is waiting. Review Saved Results shows the observations already stored.
              </Typography>
            ) : null}
            <Button size="small" onClick={() => setShowMoreActions((value) => !value)}>
              {showMoreActions ? 'Hide more actions' : 'More actions'}
            </Button>
            <Collapse in={showMoreActions}>
              <Stack spacing={1}>
                <ActionRow
                  label="Explore Next Companies"
                  disabled={busy || !canNext}
                  reason={
                    canNext
                      ? 'Starts the next 12 companies in this saved collection. This can request new market data.'
                      : 'Unavailable because every company in this saved collection has already been started, or a scan is still running.'
                  }
                  onClick={onExploreNext}
                />
                <ActionRow
                  label="Scan More Contracts"
                  disabled={busy || !canMore}
                  reason={
                    canMore
                      ? 'Looks at more contracts for companies already opened. This can request new market data.'
                      : 'Unavailable because the companies already opened have no unevaluated contracts left, or a scan is still running.'
                  }
                  onClick={onLookMore}
                />
                <ActionRow
                  label="Retry Failed Companies"
                  disabled={busy || running || retryCount <= 0}
                  reason={
                    retryCount > 0
                      ? `${retryCount} companies failed in a way that can be retried.`
                      : 'Unavailable because no company failed in a way that can be retried.'
                  }
                  onClick={onRetry}
                />
                <ActionRow
                  label="Cancel"
                  disabled={busy || !running}
                  reason={running ? 'Stops the scan that is running.' : 'Unavailable because no scan is running.'}
                  onClick={onCancel}
                />
              </Stack>
            </Collapse>
            <Button size="small" onClick={() => setShowDiagnostics((value) => !value)}>
              {showDiagnostics ? 'Hide advanced diagnostics' : 'Advanced diagnostics'}
            </Button>
            <Collapse in={showDiagnostics}>
              <Typography variant="body2" color="text.secondary">
                Session {summary.id}
                {summary.universeVersionId ? ` · pinned version ${summary.universeVersionId}` : ''} · strategy id {summary.profileId}
              </Typography>
            </Collapse>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No saved research is open. Review a recent search above, or start new research below. Opening saved research does not
            contact the provider.
          </Typography>
        )}
      </Paper>

      <Paper id="new-research-setup" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Start new research</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Choose a list, check up to {maxSelectable} companies, confirm the strategy, then scan. Choosing a list does not
          contact the market. Changing this list does not change the saved research above.
        </Typography>
        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          Curated examples
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Example companies included with OptionScout, dated with the list. Not an official S&P 500 or Nasdaq-100 file.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 1 }}>
          {universes.curated.map((row) => (
            <Button key={row.id} size="small" variant={selectedUniverse?.id === row.id ? 'contained' : 'outlined'} onClick={() => onSelectUniverse(row.id)}>
              {collectionDisplayName(row.name)} · {row.tickers.length}
            </Button>
          ))}
        </Stack>
        {universes.saved.length > 0 || universes.bookmarkDerived ? (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Saved lists and saved candidates
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 1 }}>
              {universes.saved.map((row) => (
                <Button key={row.id} size="small" variant={selectedUniverse?.id === row.id ? 'contained' : 'outlined'} onClick={() => onSelectUniverse(row.id)}>
                  {collectionDisplayName(row.name)} · {row.tickers.length}
                  {row.currentVersion?.fundTicker ? ` · ${row.currentVersion.fundTicker}` : ''}
                  {row.currentVersion?.holdingsEffectiveDate ? ` · as of ${row.currentVersion.holdingsEffectiveDate}` : ''}
                </Button>
              ))}
              {universes.bookmarkDerived ? (
                <Button
                  size="small"
                  variant={selectedUniverse?.id === universes.bookmarkDerived.id ? 'contained' : 'outlined'}
                  onClick={() => onSelectUniverse(universes.bookmarkDerived!.id)}
                >
                  Saved candidates · {universes.bookmarkDerived.tickers.length}
                </Button>
              ) : null}
            </Stack>
          </>
        ) : null}
        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 1.25,
          }}
        >
          {STOCK_COLLECTION_CATALOG.filter((entry) =>
            entry.funds.some((fund) => collectionIsReady(installedHoldingsForFund(universes.saved, fund.ticker))),
          ).map((entry) => {
            const installed = entry.funds
              .map((fund) => installedHoldingsForFund(universes.saved, fund.ticker))
              .find((row) => collectionIsReady(row));
            const ready = collectionIsReady(installed);
            return (
              <Stack key={entry.id} spacing={0.75} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
                <Typography variant="subtitle2">{entry.title}</Typography>
                <Typography variant="body2">{entry.cardLine}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {ready && installed
                    ? `Ready · ${installed.tickers.length.toLocaleString('en-US')} companies · ${
                        installed.currentVersion?.provider ?? 'Imported file'
                      }${
                        installed.currentVersion?.holdingsEffectiveDate
                          ? ` · holdings as of ${installed.currentVersion.holdingsEffectiveDate}`
                          : ''
                      }. Saved on this computer. You do not import this file again before the next search.`
                    : 'Not ready. The company list has not been saved yet.'}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  {ready && installed ? (
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        onSelectUniverse(installed.id);
                        document.getElementById('new-research-setup')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      Find LEAPS
                    </Button>
                  ) : (
                    <Button size="small" variant="outlined" onClick={() => onManage(entry.id, entry.funds[0]!.ticker)}>
                      Import Holdings
                    </Button>
                  )}
                  <Link href={entry.funds[0]!.holdingsPageUrl} target="_blank" rel="noreferrer" variant="body2">
                    Official provider page
                  </Link>
                </Stack>
              </Stack>
            );
          })}
        </Box>

        <Button size="small" sx={{ mt: 1.5 }} onClick={() => setShowUninstalledFunds((value) => !value)}>
          {showUninstalledFunds ? 'Hide fund lists that are not installed' : 'Fund lists not installed yet'}
        </Button>
        <Collapse in={showUninstalledFunds}>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {STOCK_COLLECTION_CATALOG.filter(
              (entry) => !entry.funds.some((fund) => collectionIsReady(installedHoldingsForFund(universes.saved, fund.ticker))),
            ).map((entry) => (
              <Stack key={entry.id} spacing={0.5}>
                <Typography variant="subtitle2">{entry.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Not ready. The company list has not been saved yet. {entry.cardLine}
                </Typography>
                <Button size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => onManage(entry.id, entry.funds[0]!.ticker)}>
                  Import Holdings
                </Button>
              </Stack>
            ))}
            <Typography variant="body2" color="text.secondary">
              Biggest gainers, biggest losers, and most active stocks are unavailable. This install has no market-wide ranking source.
            </Typography>
          </Stack>
        </Collapse>
        <Button size="small" sx={{ mt: 1 }} onClick={() => onManage(STOCK_COLLECTION_CATALOG[0]!.id, 'IVV')}>
          Advanced Research: holdings import
        </Button>

        {selectedUniverse ? (
          <Stack spacing={1.25} sx={{ mt: 2 }}>
            <Typography variant="body2">
              {collectionDisplayName(selectedUniverse.name)} · {selectedUniverse.tickers.length.toLocaleString('en-US')} companies
              {selectedUniverse.currentVersion?.holdingsEffectiveDate
                ? ` · holdings as of ${selectedUniverse.currentVersion.holdingsEffectiveDate}`
                : ''}
              . This new scan has not started them.
              {sameSavedCollection
                ? ` Saved research has started ${summary?.companiesProcessed ?? 0} of ${summary?.companiesInUniverse ?? selectedUniverse.tickers.length}.`
                : ' No saved research is pinned to this collection.'}
            </Typography>
            {!diagnosticMode ? (
              <>
                <Autocomplete
                  multiple
                  options={collectionOptions}
                  value={selectedOptions}
                  filterOptions={(options, state) => rankCompanyMatches(options, state.inputValue, 30)}
                  getOptionLabel={(option) => `${option.ticker} · ${option.name}`}
                  isOptionEqualToValue={(option, value) => option.ticker === value.ticker}
                  onChange={(_event, value) => {
                    onManualTickers('');
                    onSelectedTickers(value.map((row) => row.ticker).slice(0, maxSelectable));
                  }}
                  slotProps={{ listbox: { sx: { maxHeight: 280 } } }}
                  renderTags={() => null}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      label="Search companies"
                      helperText="Shows 30 suggestions. An exact ticker is still found if it is in this collection. This search does not change saved research."
                    />
                  )}
                  noOptionsText="No company in this collection matches."
                />
                <Stack spacing={0.25} sx={{ maxHeight: 280, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, px: 1 }}>
                  {collectionOptions.slice(0, 24).map((row) => {
                    const checked = selectedTickers.includes(row.ticker);
                    const sector = selectedUniverse?.sectors?.[row.ticker];
                    return (
                      <FormControlLabel
                        key={row.ticker}
                        control={
                          <Checkbox
                            size="small"
                            checked={checked}
                            onChange={(_event, next) => {
                              if (next && !checked && selectedTickers.length >= maxSelectable) {
                                onNotice(`At most ${maxSelectable} companies can be checked for one scan.`);
                                return;
                              }
                              onSelectedTickers(
                                next
                                  ? [...selectedTickers, row.ticker].slice(0, maxSelectable)
                                  : selectedTickers.filter((ticker) => ticker !== row.ticker),
                              );
                            }}
                          />
                        }
                        label={`${row.ticker} · ${row.name}${sector ? ` · ${sector}` : ''}`}
                      />
                    );
                  })}
                  {collectionOptions.length > 24 ? (
                    <Typography variant="caption" color="text.secondary">
                      Showing 24 of {collectionOptions.length.toLocaleString('en-US')}. Search to find another company. The full list stays saved.
                    </Typography>
                  ) : null}
                </Stack>
                <TextField
                  size="small"
                  label="Search all collections"
                  value={allQuery}
                  onChange={(event) => setAllQuery(event.target.value)}
                  helperText="Shows 8 suggestions across installed collections. An exact ticker is still found. Choosing one puts that company first in a new scan. It does not change saved research."
                />
                {crossMatches.length > 0 ? (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {crossMatches.map((row) => (
                      <Button
                        key={`${row.id}-${row.ticker}`}
                        size="small"
                        onClick={() => {
                          onSelectUniverse(row.id);
                          onSelectedTickers([row.ticker]);
                          onNotice(
                            `${row.ticker} is one company in ${row.label}. Find LEAPS still queues that whole collection, with ${row.ticker} first. Saved research was not changed.`,
                          );
                        }}
                      >
                        {row.ticker} · {row.name} · {row.label}
                      </Button>
                    ))}
                  </Stack>
                ) : null}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  {sectorChoices.length > 0 ? (
                    <TextField
                      select
                      size="small"
                      label="Sector"
                      value={sectorFilter}
                      onChange={(event) => setSectorFilter(event.target.value)}
                      sx={{ minWidth: 180 }}
                    >
                      <MenuItem value="">Any sector</MenuItem>
                      {sectorChoices.map((sector) => (
                        <MenuItem key={sector} value={sector}>
                          {sector}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      This collection has no sector column, so sector filtering is unavailable.
                    </Typography>
                  )}
                  <TextField
                    select
                    size="small"
                    label="Checked status"
                    value={supportFilter}
                    onChange={(event) => setSupportFilter(event.target.value as typeof supportFilter)}
                    helperText={
                      sameSavedCollection
                        ? 'Uses statuses already stored for this saved collection. It is not a new provider check.'
                        : 'Option support is unknown until a scan of this collection is saved.'
                    }
                    sx={{ minWidth: 200 }}
                  >
                    <MenuItem value="any">Any company</MenuItem>
                    <MenuItem value="chain" disabled={!sameSavedCollection}>
                      Chain was retrieved
                    </MenuItem>
                    <MenuItem value="no-chain" disabled={!sameSavedCollection}>
                      Provider reported no chain
                    </MenuItem>
                    <MenuItem value="unchecked" disabled={!sameSavedCollection}>
                      Not checked yet
                    </MenuItem>
                  </TextField>
                </Stack>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    const readable = selectedUniverse.weightReading === 'percent-sign'
                      || selectedUniverse.weightReading === 'percentage-points'
                      || selectedUniverse.weightReading === 'decimal-fraction';
                    const top = readable
                      ? topHoldingsByWeight(selectedUniverse.tickers, selectedUniverse.weightPercents ?? {}, maxSelectable)
                      : [];
                    if (top.length === 0) {
                      onNotice(
                        selectedUniverse.weightReading === 'ambiguous'
                          ? 'Fund weights in this file were ambiguous, so companies were not reordered. Import again and choose percentage points or fractions.'
                          : 'This collection has no interpreted fund weights, so companies were not reordered. Older saved files are left as they were.',
                      );
                      return;
                    }
                    onSelectedTickers(top);
                    onNotice(
                      `Selected the ${top.length} largest holdings by fund weight for the first batch. Weight is the ETF’s composition, not a prediction of performance.`,
                    );
                  }}
                >
                  Use largest holdings for the first batch
                </Button>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    size="small"
                    label="Add ticker"
                    value={addTickerDraft}
                    onChange={(event) => onAddTickerDraft(event.target.value.toUpperCase())}
                    helperText="Outside the collection is allowed. Invalid format is rejected. Provider support is checked only when you scan."
                  />
                  <Button variant="outlined" onClick={onAddTicker}>
                    Add Ticker
                  </Button>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Selected: {selectedTickers.length} of {maxSelectable}. The list has{' '}
                    {selectedUniverse.tickers.length.toLocaleString('en-US')} companies. Checking a company does not start a scan.
                  </Typography>
                  {selectedOptions.map((row) => (
                    <Chip
                      key={row.ticker}
                      size="small"
                      label={`${row.ticker}${row.name !== row.ticker ? ` · ${row.name}` : ''}`}
                      onDelete={() => onSelectedTickers(selectedTickers.filter((ticker) => ticker !== row.ticker))}
                    />
                  ))}
                </Stack>
              </>
            ) : (
              <TextField
                label="Or paste tickers for this scan only"
                value={manualTickers}
                onChange={(event) => onManualTickers(event.target.value.toUpperCase())}
                helperText={`Only ${allowlist.join(', ')} are accepted while Diagnostic Mode is on.`}
              />
            )}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ mt: 2 }}>
            Select a ready collection to choose companies. Collections without imported holdings cannot be scanned.
          </Typography>
        )}

        {scanBlocked ? (
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            Cannot start scan with unsupported tickers: {blockedTickers.join(', ')}. Diagnostic Mode allows only {allowlist.join(', ')}.
          </Typography>
        ) : null}

        <Stack spacing={1.5} direction={{ xs: 'column', md: 'row' }} sx={{ mt: 2, flexWrap: 'wrap' }}>
          <TextField
            select
            label="Strategy profile"
            value={profileId}
            onChange={(event) => onProfileId(event.target.value)}
            helperText={activeProfile ? `${activeProfile.name} · revision ${activeProfile.revision}` : ''}
            sx={{ minWidth: 260 }}
          >
            {profiles.map((row) => (
              <MenuItem key={row.id} value={row.id}>
                {row.name}
                {row.isDefault ? ' (default)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="number"
            label="Research budget"
            value={budget}
            onChange={(event) => onBudget(Math.max(1, Math.min(maxBudget, Number(event.target.value) || maxBudget)))}
            helperText={`Up to ${maxBudget} contracts in this step. Choosing a group does not start a search.`}
            sx={{ width: 220 }}
          />
          <Button size="small" onClick={() => setShowScanSettings((value) => !value)}>
            {showScanSettings ? 'Hide scan settings' : 'Scan settings'}
          </Button>
          <Collapse in={showScanSettings}>
            <TextField
              select
              size="small"
              label="Scan priority"
              value={scanPriority}
              onChange={(event) => onScanPriority(event.target.value as ScanMorePriority)}
              helperText={SCAN_MORE_PRIORITY_LABELS[scanPriority].explanation}
              sx={{ minWidth: 280, mt: 1 }}
            >
              {SCAN_MORE_PRIORITIES.map((priority) => (
                <MenuItem key={priority} value={priority}>
                  {SCAN_MORE_PRIORITY_LABELS[priority].label}
                </MenuItem>
              ))}
            </TextField>
          </Collapse>
          <Button variant="contained" disabled={busy || findDisabled} onClick={onFindLeaps}>
            Scan Selected Stocks
          </Button>
          <Button variant="outlined" disabled={busy || entireListDisabled} onClick={onExploreEntireList}>
            Explore Entire List
          </Button>
        </Stack>
        {selectedUniverse ? (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            {collectionDisplayName(selectedUniverse.name)} has {selectedUniverse.tickers.length.toLocaleString('en-US')}{' '}
            companies. Selected: {selectedTickers.length} of {maxSelectable}. Strategy:{' '}
            {activeProfile ? `${activeProfile.name}, revision ${activeProfile.revision}` : 'none'}. Contract budget: {budget}.
            Scan Selected Stocks researches only the checked companies. Explore Entire List researches the first{' '}
            {maxSelectable} and keeps the rest of this list for Explore Next Companies. Nothing starts until you press one
            of those buttons. {maxBudget} contracts in this step is not every LEAPS contract.
          </Typography>
        ) : null}
        {findDisabledReason ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {findDisabledReason}
          </Typography>
        ) : null}
        {activeProfile ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Hard requirements: max cost ${Number(activeProfile.hard.maxContractCost).toLocaleString('en-US')}, min DTE{' '}
            {activeProfile.hard.minExpirationDays}, min delta {activeProfile.hard.minLongDelta}. Preferences: preferred delta{' '}
            {activeProfile.preferences.preferredLongDelta}, intrinsic {activeProfile.preferences.minIntrinsicPercent}%.
            {!profilesFromServer ? ' Sign in loads your saved revision.' : ''}
          </Typography>
        ) : null}
      </Paper>
    </Stack>
  );
}

function ActionRow({
  label,
  disabled,
  reason,
  onClick,
}: {
  label: string;
  disabled: boolean;
  reason: string;
  onClick: () => void;
}) {
  return (
    <Stack spacing={0.25}>
      <Button size="small" variant="outlined" disabled={disabled} onClick={onClick} sx={{ alignSelf: 'flex-start' }}>
        {label}
      </Button>
      <Typography variant="caption" color="text.secondary">
        {reason}
      </Typography>
    </Stack>
  );
}

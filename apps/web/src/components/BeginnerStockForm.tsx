import { useMemo, useState } from 'react';
import {
  BEGINNER_SELECTION_LIMIT,
  parseTickerCsv,
  type DiscoveryUniverse,
  type StrategyProfile,
} from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

const PAGE_SIZE = 40;
export const SELECTED_SEARCH_LABEL = 'Selected companies for one search';

export type CompanyDirectory = {
  id: string;
  label: string;
  universe: DiscoveryUniverse | null;
  note?: string;
};

type CompanyRow = { ticker: string; name: string; sector: string };

export function BeginnerStockForm({
  profiles,
  profileId,
  onProfileId,
  directories,
  activeDirectoryId,
  onSelectDirectory,
  selectedTickers,
  onSelectedTickers,
  addTickerDraft,
  onAddTickerDraft,
  onAddTicker,
  onImportList,
  busy,
  findBlocked,
  onFind,
  operationCap,
  budget,
}: {
  profiles: StrategyProfile[];
  profileId: string;
  onProfileId: (id: string) => void;
  directories: CompanyDirectory[];
  activeDirectoryId: string;
  onSelectDirectory: (id: string) => void;
  selectedTickers: string[];
  onSelectedTickers: (tickers: string[]) => void;
  addTickerDraft: string;
  onAddTickerDraft: (value: string) => void;
  onAddTicker: () => void;
  onImportList: (name: string, tickers: string[], rejected: string[]) => void;
  busy: boolean;
  findBlocked?: boolean;
  onFind: () => void;
  operationCap: number;
  budget: number;
}) {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('');
  const [page, setPage] = useState(0);
  const [symbolText, setSymbolText] = useState('');
  const [importNote, setImportNote] = useState<string | null>(null);
  const profile = profiles.find((row) => row.id === profileId) ?? profiles[0];
  const directory = directories.find((row) => row.id === activeDirectoryId) ?? directories[0] ?? null;
  const universe = directory?.universe ?? null;

  const rows = useMemo((): CompanyRow[] => {
    if (!universe) return [];
    return universe.tickers.map((ticker) => ({
      ticker,
      name: universe.companyNames[ticker] || ticker,
      sector: universe.sectors?.[ticker] ?? '',
    }));
  }, [universe]);

  const sectors = useMemo(
    () => [...new Set(rows.map((row) => row.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sector && row.sector !== sector) return false;
      if (!q) return true;
      return row.ticker.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
    });
  }, [rows, query, sector]);

  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = matched.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const steps = selectedTickers.length === 0 ? 0 : Math.ceil(selectedTickers.length / operationCap);

  function toggle(ticker: string, next: boolean) {
    if (next && !selectedTickers.includes(ticker)) {
      if (selectedTickers.length >= BEGINNER_SELECTION_LIMIT) return;
      onSelectedTickers([...selectedTickers, ticker]);
      return;
    }
    if (!next) onSelectedTickers(selectedTickers.filter((row) => row !== ticker));
  }

  function selectVisible() {
    const next = [...selectedTickers];
    for (const row of visible) {
      if (next.length >= BEGINNER_SELECTION_LIMIT) break;
      if (!next.includes(row.ticker)) next.push(row.ticker);
    }
    onSelectedTickers(next);
  }

  return (
    <Stack spacing={1.25}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <TextField
          select
          size="small"
          label="Your strategy"
          value={profileId}
          onChange={(event) => onProfileId(event.target.value)}
          sx={{ minWidth: 260, flex: 1 }}
        >
          {profiles.map((row) => (
            <MenuItem key={row.id} value={row.id}>
              {row.name}, revision {row.revision}
            </MenuItem>
          ))}
        </TextField>
        <Button component={RouterLink} to="/strategies" size="small">
          Edit strategy
        </Button>
      </Stack>
      {profile ? (
        <Typography variant="body2" color="text.secondary">
          Max cost ${Number(profile.hard.maxContractCost).toLocaleString('en-US')} · min delta {profile.hard.minLongDelta} · min{' '}
          {profile.hard.minExpirationDays} days · preferred delta {profile.preferences.preferredLongDelta} · intrinsic{' '}
          {profile.preferences.minIntrinsicPercent}%
          {profile.kind === 'builtin-template' ? ' · example strategy, not a recommendation' : ''}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
        {directories.map((row) => (
          <Chip
            key={row.id}
            label={row.label}
            color={row.id === directory?.id ? 'primary' : 'default'}
            variant={row.id === directory?.id ? 'filled' : 'outlined'}
            onClick={() => {
              setQuery('');
              setSector('');
              setPage(0);
              onSelectDirectory(row.id);
            }}
          />
        ))}
      </Stack>

      {universe && universe.tickers.length > 0 ? (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              label="Search ticker or company"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              sx={{ flex: 1 }}
            />
            {sectors.length > 0 ? (
              <TextField
                select
                size="small"
                label="Sector"
                value={sector}
                onChange={(event) => {
                  setSector(event.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">All sectors</MenuItem>
                {sectors.map((row) => (
                  <MenuItem key={row} value={row}>
                    {row}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {matched.length.toLocaleString('en-US')} companies
            {universe.currentVersion?.holdingsEffectiveDate
              ? ` · holdings as of ${universe.currentVersion.holdingsEffectiveDate}`
              : ''}
            {universe.currentVersion?.fundTicker ? ` · ${universe.currentVersion.fundTicker} file, not an index membership feed` : ''}
          </Typography>
          <Box sx={{ maxHeight: 320, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {visible.map((row) => (
              <Stack
                key={row.ticker}
                className="os-stock-row"
                data-selected={selectedTickers.includes(row.ticker) ? 'true' : 'false'}
                component="label"
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center', px: 0.5 }}
              >
                <Checkbox
                  size="small"
                  checked={selectedTickers.includes(row.ticker)}
                  disabled={!selectedTickers.includes(row.ticker) && selectedTickers.length >= BEGINNER_SELECTION_LIMIT}
                  onChange={(_event, checked) => toggle(row.ticker, checked)}
                  inputProps={{ 'aria-label': `${row.ticker} ${row.name}` }}
                />
                <Typography variant="body2" sx={{ width: 72, fontWeight: 650, fontFamily: 'var(--os-font-mono)' }}>
                  {row.ticker}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {row.name}
                </Typography>
                {row.sector ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                    {row.sector}
                  </Typography>
                ) : null}
              </Stack>
            ))}
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Previous
            </Button>
            <Typography variant="caption">
              {safePage + 1} / {pageCount}
            </Typography>
            <Button size="small" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
              Next
            </Button>
            <Button size="small" onClick={selectVisible}>
              Select visible
            </Button>
          </Stack>
        </>
      ) : (
        <Typography variant="body2">
          {directory?.note ?? 'This category has no company list on this computer yet.'}
        </Typography>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>
          Selected {selectedTickers.length}/{BEGINNER_SELECTION_LIMIT}
        </Typography>
        <TextField
          size="small"
          label="Add ticker"
          value={addTickerDraft}
          onChange={(event) => onAddTickerDraft(event.target.value)}
          sx={{ width: 140 }}
        />
        <Button size="small" onClick={onAddTicker}>
          Add Ticker
        </Button>
        <Button size="small" onClick={() => onSelectedTickers([])} disabled={selectedTickers.length === 0}>
          Clear selection
        </Button>
        <Button size="small" component="label">
          Import symbols
          <input
            hidden
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void file.text().then((text) => {
                const parsed = parseTickerCsv(text);
                setImportNote(
                  parsed.rejected.length > 0
                    ? `${parsed.tickers.length} symbols ready. Not used: ${parsed.rejected.slice(0, 8).join(', ')}`
                    : `${parsed.tickers.length} symbols ready.`,
                );
                onImportList(file.name.replace(/\.[^.]+$/, '') || 'Imported symbols', parsed.tickers, parsed.rejected);
              });
            }}
          />
        </Button>
      </Stack>
      {selectedTickers.length > 0 ? (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
          {selectedTickers.map((ticker) => (
            <Chip key={ticker} size="small" label={ticker} onDelete={() => toggle(ticker, false)} />
          ))}
        </Stack>
      ) : null}
      <TextField
        size="small"
        label="Or paste symbols"
        value={symbolText}
        onChange={(event) => setSymbolText(event.target.value)}
        placeholder="AAPL, MSFT, NVDA"
        onBlur={() => {
          if (!symbolText.trim()) return;
          const parsed = parseTickerCsv(symbolText);
          setImportNote(
            parsed.rejected.length > 0
              ? `${parsed.tickers.length} symbols ready. Not used: ${parsed.rejected.slice(0, 8).join(', ')}`
              : `${parsed.tickers.length} symbols ready.`,
          );
          onImportList('Pasted symbols', parsed.tickers, parsed.rejected);
          setSymbolText('');
        }}
      />
      {importNote ? (
        <Typography variant="caption" color="text.secondary">
          {importNote}
        </Typography>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Button variant="contained" disabled={busy || findBlocked || selectedTickers.length === 0} onClick={onFind}>
          Find Matching LEAPS
        </Button>
        <Typography variant="body2" color="text.secondary">
          {selectedTickers.length === 0
            ? 'Check companies, then search. Nothing is requested until you press the button.'
            : `${selectedTickers.length} companies, ${steps} step${steps === 1 ? '' : 's'} of at most ${operationCap}, ${budget} contracts each. Not every LEAPS contract will be examined.`}
        </Typography>
      </Stack>
    </Stack>
  );
}

export function isEphemeralSearchList(universe: DiscoveryUniverse): boolean {
  return universe.sourceLabel === SELECTED_SEARCH_LABEL || universe.name === 'This search';
}

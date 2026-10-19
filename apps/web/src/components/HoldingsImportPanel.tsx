import { useMemo, useState } from 'react';
import type { DiscoveryUniverse, HoldingsMappableRole } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  commitHoldingsCsvImport,
  previewHoldingsCsvImport,
  type HoldingsColumnMapping,
  type HoldingsPreviewResponse,
} from '../api/client';

const MAPPABLE_ROLES: ReadonlyArray<{ role: HoldingsMappableRole; label: string }> = [
  { role: 'ticker', label: 'Ticker column' },
  { role: 'name', label: 'Name column' },
  { role: 'sector', label: 'Sector column' },
  { role: 'weight', label: 'Weight column' },
  { role: 'assetClass', label: 'Asset class column' },
];

const NEW_COLLECTION = 'new';
const DISPLAY_ROW_LIMIT = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function previewKey(csvText: string, mapping: HoldingsColumnMapping, weightChoice: string): string {
  return `${csvText.length}:${csvText}::${JSON.stringify(mapping)}::${weightChoice}`;
}

function detectedRole(preview: HoldingsPreviewResponse, role: HoldingsMappableRole): string {
  return Object.entries(preview.mapping).find(([, value]) => value === role)?.[0] ?? '';
}

export function HoldingsImportPanel({
  disabled,
  savedUniverses,
  onSaved,
  onNotice,
  initialCollection = null,
  initialSaveChoice = null,
  guided = false,
}: {
  disabled: boolean;
  savedUniverses: DiscoveryUniverse[];
  onSaved: (universeId: string, notice: string) => Promise<void> | void;
  onNotice: (notice: string) => void;
  initialCollection?: { name: string; fundTicker: string; provider: string } | null;
  /** `new` creates a collection. Any other value adds a version to that saved collection. */
  initialSaveChoice?: string | null;
  /** Hides column mapping and file metadata until the owner opens them. */
  guided?: boolean;
}) {
  const [csvText, setCsvText] = useState('');
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [name, setName] = useState(initialCollection?.name ?? 'IVV holdings');
  const [fundTicker, setFundTicker] = useState(initialCollection?.fundTicker ?? 'IVV');
  const [provider, setProvider] = useState(initialCollection?.provider ?? 'Owner-downloaded official holdings CSV');
  const [saveChoice, setSaveChoice] = useState(initialSaveChoice && initialSaveChoice.length > 0 ? initialSaveChoice : NEW_COLLECTION);
  const [weightChoice, setWeightChoice] = useState<'auto' | 'percentage-points' | 'decimal-fraction'>('auto');
  const [showDetails, setShowDetails] = useState(false);
  const [mapping, setMapping] = useState<HoldingsColumnMapping>({});
  const [effectiveDate, setEffectiveDate] = useState('');
  /** CSV text the current date belongs to. A new file clears this so the previous date cannot carry over. */
  const [dateBoundTo, setDateBoundTo] = useState<string | null>(null);
  const [preview, setPreview] = useState<HoldingsPreviewResponse | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rowFilter, setRowFilter] = useState<'issues' | 'all'>('issues');
  const [busy, setBusy] = useState(false);

  const currentKey = previewKey(csvText, mapping, weightChoice);
  const previewCurrent = preview != null && previewedKey === currentKey;
  const issueRows = useMemo(() => (preview?.rows ?? []).filter((row) => row.status !== 'equity'), [preview]);
  const displayedRows = useMemo(() => {
    const rows = rowFilter === 'issues' ? issueRows : preview?.rows ?? [];
    return rows.slice(0, DISPLAY_ROW_LIMIT);
  }, [rowFilter, issueRows, preview]);
  const dateValid = DATE_PATTERN.test(effectiveDate);
  const saveBlockers: string[] = [];
  if (!preview) saveBlockers.push('Preview and validate the file first.');
  else if (!previewCurrent) saveBlockers.push('The file or column mapping changed — preview again.');
  else {
    if (preview.truncated) saveBlockers.push('The file exceeds the row limit; split it before saving.');
    if (preview.counts.equity === 0) saveBlockers.push('No valid equity tickers were found.');
  }
  if (!dateValid) saveBlockers.push('Enter the holdings date from the provider file.');
  if (!name.trim()) saveBlockers.push('Enter a collection name.');
  const canSave = !disabled && !busy && saveBlockers.length === 0;
  const holdingsTargets = savedUniverses.filter((row) => row.editable);

  async function runPreview(): Promise<void> {
    setBusy(true);
    setPreviewError(null);
    try {
      const result = await previewHoldingsCsvImport(csvText, mapping, weightChoice);
      setPreview(result);
      setPreviewedKey(previewKey(csvText, mapping, weightChoice));
      // Bind the date to this file once. A later preview of the same file keeps a manual override.
      // A different file replaces the date with what that file actually contains.
      if (dateBoundTo !== csvText) {
        const detected = result.detectedEffectiveDate && DATE_PATTERN.test(result.detectedEffectiveDate) ? result.detectedEffectiveDate : '';
        setEffectiveDate(detected);
        setDateBoundTo(csvText);
      }
      setRowFilter(result.rows.some((row) => row.status !== 'equity') ? 'issues' : 'all');
    } catch (reason: unknown) {
      setPreview(null);
      setPreviewedKey(null);
      setPreviewError(reason instanceof Error ? reason.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runSave(): Promise<void> {
    if (!preview || !canSave) return;
    setBusy(true);
    try {
      const saved = await commitHoldingsCsvImport({
        name: name.trim(),
        universeId: saveChoice === NEW_COLLECTION ? null : saveChoice,
        fundTicker: fundTicker.trim() || null,
        provider: provider.trim() || 'Owner CSV',
        holdingsEffectiveDate: effectiveDate,
        csvText,
        mapping,
        contentHash: preview.contentHash,
        weightChoice,
      });
      await onSaved(saved.universeId, saved.notice);
      if (!saved.unchanged) {
        setCsvText('');
        setFileLabel(null);
        setPreview(null);
        setPreviewedKey(null);
        setEffectiveDate('');
        setDateBoundTo(null);
      }
    } catch (reason: unknown) {
      onNotice(reason instanceof Error ? reason.message : 'Holdings import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={1.5} data-testid="holdings-import-panel">
      <Typography variant="subtitle2">{guided ? 'Upload the holdings file' : 'Import official ETF holdings (versioned)'}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' } }}>
        <Button variant="outlined" component="label" disabled={disabled || busy}>
          Choose holdings CSV
          <input
            hidden
            type="file"
            accept=".csv,text/csv"
            aria-label="Holdings CSV file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void file
                .text()
                .then((text) => {
                  setCsvText(text);
                  setFileLabel(`${file.name} (${file.size.toLocaleString('en-US')} bytes)`);
                  setEffectiveDate('');
                  setDateBoundTo(null);
                })
                .catch(() => onNotice('Could not read that file.'));
            }}
          />
        </Button>
        <Typography variant="body2" color="text.secondary">
          {fileLabel ?? (guided ? 'Use the file you downloaded from the fund company.' : 'Or paste the CSV text below.')}
        </Typography>
      </Stack>
      {guided ? null : (
        <TextField
          label="Holdings CSV text"
          multiline
          minRows={3}
          maxRows={10}
          value={csvText}
          onChange={(event) => {
            setCsvText(event.target.value);
            setFileLabel(null);
            setEffectiveDate('');
            setDateBoundTo(null);
          }}
          helperText="Provider preamble and footer lines are detected. Nothing is fetched from the network."
        />
      )}
      <Button size="small" onClick={() => setShowDetails((value) => !value)} sx={{ alignSelf: 'flex-start' }}>
        {showDetails ? 'Hide advanced file details' : 'Advanced file details'}
      </Button>
      <Collapse in={showDetails || !guided}>
        <Stack spacing={1.5}>
          {guided ? (
            <TextField
              label="Holdings CSV text"
              multiline
              minRows={3}
              maxRows={10}
              value={csvText}
              onChange={(event) => {
                setCsvText(event.target.value);
                setFileLabel(null);
                setEffectiveDate('');
                setDateBoundTo(null);
              }}
              helperText="Paste is optional. The file button above is enough. Nothing is fetched from the network."
            />
          ) : null}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <TextField size="small" label="Collection name" value={name} onChange={(event) => setName(event.target.value)} />
            <TextField
              size="small"
              label="Fund ticker"
              value={fundTicker}
              onChange={(event) => setFundTicker(event.target.value.toUpperCase())}
            />
            <TextField size="small" label="Source / provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
          </Stack>
        </Stack>
      </Collapse>
      <TextField
        select
        size="small"
        label="How to read weights"
        value={weightChoice}
        onChange={(event) => setWeightChoice(event.target.value as typeof weightChoice)}
        helperText="Automatic uses a percent sign, a percent column name, or a column that adds up to about 1 or about 100. Anything else stays uninterpreted until you choose."
        sx={{ maxWidth: 480 }}
      >
        <MenuItem value="auto">Automatic — only when the file makes the scale clear</MenuItem>
        <MenuItem value="percentage-points">Percentage points — 7.1 means 7.1%</MenuItem>
        <MenuItem value="decimal-fraction">Fraction of the fund — 0.071 means 7.1%</MenuItem>
      </TextField>
      <Box>
        <Button variant="outlined" disabled={disabled || busy || !csvText.trim()} onClick={() => void runPreview()}>
          Preview and validate
        </Button>
      </Box>
      {previewError ? <Alert severity="error">{previewError}</Alert> : null}

      {preview ? (
        <Stack spacing={1.5}>
          {!previewCurrent ? (
            <Alert severity="warning">The file or column mapping changed since this preview. Preview again before saving.</Alert>
          ) : null}
          <Alert severity={preview.counts.invalid > 0 ? 'warning' : 'info'} icon={false}>
            {preview.counts.parsed} rows read (header on line {preview.headerLine}): {preview.counts.equity} unique equities,{' '}
            {preview.counts.duplicate} duplicates, {preview.counts.cash} cash, {preview.counts.nonEquity} non-equity,{' '}
            {preview.counts.invalid} invalid, {preview.counts.ignored} ignored footer/blank
            {preview.counts.normalizedShareClass > 0
              ? `, ${preview.counts.normalizedShareClass} share-class symbols normalized`
              : ''}
            . Not a claim that every ticker has listed options.
            {preview.weightReadingReason ? ` ${preview.weightReadingReason}` : ''}
          </Alert>
          <Collapse in={showDetails || !guided}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {MAPPABLE_ROLES.map(({ role, label }) => (
              <TextField
                key={role}
                select
                size="small"
                label={label}
                value={mapping[role] ?? detectedRole(preview, role)}
                onChange={(event) =>
                  setMapping((current) => {
                    const next = { ...current };
                    if (event.target.value) next[role] = event.target.value;
                    else delete next[role];
                    return next;
                  })
                }
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">{role === 'ticker' ? '(choose)' : '(none)'}</MenuItem>
                {preview.headers.map((header) => (
                  <MenuItem key={header} value={header}>
                    {header}
                  </MenuItem>
                ))}
              </TextField>
            ))}
          </Stack>
          </Collapse>
          <TextField
            size="small"
            type="date"
            label="Holdings as-of date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={
              !previewCurrent
                ? 'Preview this file before relying on a detected date.'
                : preview.detectedEffectiveDate
                  ? effectiveDate === preview.detectedEffectiveDate
                    ? `Detected ${preview.detectedEffectiveDate} in the file header. Change it if the provider shows a different date.`
                    : `Detected ${preview.detectedEffectiveDate} in the file. The date in this field is what will be saved.`
                  : 'No date found in this file. Enter the date shown by the provider.'
            }
            error={!dateValid}
            sx={{ maxWidth: 260 }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Rows"
              value={rowFilter}
              onChange={(event) => setRowFilter(event.target.value as 'issues' | 'all')}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="issues">Rows with issues ({issueRows.length})</MenuItem>
              <MenuItem value="all">All rows ({preview.rows.length})</MenuItem>
            </TextField>
            <Typography variant="caption" color="text.secondary">
              Showing {displayedRows.length}
              {preview.rowsTruncated || displayedRows.length < (rowFilter === 'issues' ? issueRows.length : preview.rows.length)
                ? ' (truncated for display; counts cover the whole file)'
                : ''}
            </Typography>
          </Stack>
          <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
            <Table size="small" aria-label="Holdings preview rows">
              <TableHead>
                <TableRow>
                  <TableCell>Line</TableCell>
                  <TableCell>Ticker in file</TableCell>
                  <TableCell>Saved as</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Weight in file</TableCell>
                  <TableCell>Read as % of fund</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedRows.map((row) => (
                  <TableRow key={`${row.line}-${row.rawTicker}`}>
                    <TableCell>{row.line}</TableCell>
                    <TableCell>{row.rawTicker}</TableCell>
                    <TableCell>{row.status === 'equity' ? row.ticker : '—'}</TableCell>
                    <TableCell>{row.name ?? ''}</TableCell>
                    <TableCell>{row.weight ?? '—'}</TableCell>
                    <TableCell>{row.weightPercent ?? 'Not interpreted'}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Stack>
      ) : null}

      {preview && previewCurrent && dateValid ? (
        <Alert severity="info" icon={false}>
          Saving records holdings as of {effectiveDate}.
          {preview.detectedEffectiveDate && preview.detectedEffectiveDate !== effectiveDate
            ? ` The file suggested ${preview.detectedEffectiveDate}; the date above is the one that will be saved.`
            : preview.detectedEffectiveDate
              ? ' This is the date detected in the file.'
              : ' This is the date you entered. The file did not include one.'}{' '}
          Earlier versions of this collection are not changed.
        </Alert>
      ) : null}
      {preview && previewCurrent && !dateValid ? (
        <Alert severity="warning" icon={false}>
          No holdings date was detected in this file. Enter the date shown by the provider before saving.
        </Alert>
      ) : null}
      {saveBlockers.length > 0 && preview ? (
        <Typography variant="body2" color="text.secondary">
          {saveBlockers.join(' ')}
        </Typography>
      ) : null}
      <TextField
        select
        size="small"
        label="Where should this file be saved?"
        value={saveChoice}
        onChange={(event) => setSaveChoice(event.target.value)}
        helperText={
          saveChoice === NEW_COLLECTION
            ? 'Create a new collection. You can use it again later without importing the file another time.'
            : 'Add a new dated version to a collection you already saved. Older versions and saved research stay as they are.'
        }
        sx={{ maxWidth: 480 }}
      >
        <MenuItem value={NEW_COLLECTION}>Create a new collection</MenuItem>
        {holdingsTargets.map((row) => (
          <MenuItem key={row.id} value={row.id}>
            Add a new version to {row.name}
            {row.currentVersion?.holdingsEffectiveDate ? ` (holdings now ${row.currentVersion.holdingsEffectiveDate})` : ''}
          </MenuItem>
        ))}
      </TextField>
      <Box>
        <Button variant="contained" disabled={!canSave} onClick={() => void runSave()}>
          Save holdings version
        </Button>
      </Box>
    </Stack>
  );
}

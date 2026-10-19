import { useEffect, useMemo, useState } from 'react';
import {
  STOCK_COLLECTION_CATALOG,
  collectionIsReady,
  installedHoldingsForFund,
  type DiscoveryUniverse,
} from '@optionscout/shared';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { HoldingsImportPanel } from './HoldingsImportPanel';

export function StockCollectionsDialog({
  open,
  catalogId,
  fundTicker,
  savedUniverses,
  disabled,
  onClose,
  onNotice,
  onSaved,
  onUseCollection,
}: {
  open: boolean;
  catalogId: string | null;
  fundTicker: string | null;
  savedUniverses: DiscoveryUniverse[];
  disabled: boolean;
  onClose: () => void;
  onNotice: (notice: string) => void;
  onSaved: (universeId: string, notice: string) => Promise<void> | void;
  onUseCollection: (universeId: string) => void;
}) {
  const [entryId, setEntryId] = useState(catalogId ?? STOCK_COLLECTION_CATALOG[0]!.id);
  const [fund, setFund] = useState(fundTicker ?? STOCK_COLLECTION_CATALOG[0]!.funds[0]!.ticker);
  const [step, setStep] = useState(0);
  const entry = STOCK_COLLECTION_CATALOG.find((row) => row.id === entryId) ?? STOCK_COLLECTION_CATALOG[0]!;
  const activeFund = entry.funds.find((row) => row.ticker === fund) ?? entry.funds[0]!;
  const installed = installedHoldingsForFund(savedUniverses, activeFund.ticker);
  const ready = collectionIsReady(installed);

  useEffect(() => {
    if (!open) return;
    const next = STOCK_COLLECTION_CATALOG.find((row) => row.id === catalogId) ?? STOCK_COLLECTION_CATALOG[0]!;
    setEntryId(next.id);
    setFund(fundTicker && next.funds.some((row) => row.ticker === fundTicker) ? fundTicker : next.funds[0]!.ticker);
    setStep(0);
  }, [open, catalogId, fundTicker]);

  const initialCollection = useMemo(
    () => ({
      name: activeFund.fundName,
      fundTicker: activeFund.ticker,
      provider: activeFund.provider,
    }),
    [activeFund.fundName, activeFund.ticker, activeFund.provider],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Add a stock group</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Step {step === 0 ? '1' : '2–3'} of 3. Choose where the company list comes from, upload the fund company’s file,
            then check it and save. OptionScout does not download the file for you. A saved group can be used again. You do
            not import it before every search.
          </Typography>
          {step === 0 ? (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">1. Choose a source</Typography>
              <TextField
                select
                label="Stock group"
                value={entry.id}
                onChange={(event) => {
                  const next = STOCK_COLLECTION_CATALOG.find((row) => row.id === event.target.value);
                  if (!next) return;
                  setEntryId(next.id);
                  setFund(next.funds[0]!.ticker);
                }}
              >
                {STOCK_COLLECTION_CATALOG.map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.title}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="body2">{entry.cardLine}</Typography>
              <Typography variant="body2">{entry.holdingsVersusEtf}</Typography>
              <TextField select label="Which fund’s company list?" value={activeFund.ticker} onChange={(event) => setFund(event.target.value)}>
                {entry.funds.map((row) => (
                  <MenuItem key={row.ticker} value={row.ticker}>
                    {row.ticker} · {row.fundName}
                  </MenuItem>
                ))}
              </TextField>
              <Link href={activeFund.holdingsPageUrl} target="_blank" rel="noreferrer">
                Open the official {activeFund.provider} page for {activeFund.ticker}
              </Link>
              {ready && installed ? (
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Already saved · {installed.tickers.length.toLocaleString('en-US')} companies
                    {installed.currentVersion?.holdingsEffectiveDate
                      ? ` · holdings as of ${installed.currentVersion.holdingsEffectiveDate}`
                      : ''}
                    {installed.currentVersion?.provider ? ` · ${installed.currentVersion.provider}` : ''}. You can search this
                    group again without uploading the file.
                  </Typography>
                  <Button variant="contained" onClick={() => onUseCollection(installed.id)}>
                    Find LEAPS
                  </Button>
                </Stack>
              ) : (
                <Typography variant="body2">
                  {activeFund.ticker} is not saved yet, so it is not ready to search.
                </Typography>
              )}
              <Button variant="outlined" onClick={() => setStep(1)}>
                {ready ? 'Upload a newer file' : 'Continue to upload'}
              </Button>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">2. Upload the file, then 3. Check it and save</Typography>
              <Typography variant="body2" color="text.secondary">
                This list is the companies held inside {activeFund.ticker}. It is not a search for an option on{' '}
                {activeFund.ticker} itself. Use Find One Stock for the fund ticker.
              </Typography>
              <HoldingsImportPanel
                key={`${entry.id}-${activeFund.ticker}-${step}`}
                disabled={disabled}
                guided
                savedUniverses={savedUniverses}
                initialCollection={initialCollection}
                initialSaveChoice={installed?.id ?? 'new'}
                onNotice={onNotice}
                onSaved={onSaved}
              />
              <Button onClick={() => setStep(0)}>Back to source</Button>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

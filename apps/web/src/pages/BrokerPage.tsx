import { useState } from 'react';
import type { BrokerOverview } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAppState } from '../state/AppState';

export function BrokerPage() {
  const { status, error, broker, session, signIn, signOut, syncNow, chooseAccount } = useAppState();
  const [passphrase, setPassphrase] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'info' | 'warning' | 'success'>('info');
  const [busy, setBusy] = useState(false);
  const [backfillStart, setBackfillStart] = useState('');

  if (status === 'loading') {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 4 }}>
        <CircularProgress size={22} />
        <Typography>Loading broker status.</Typography>
      </Stack>
    );
  }

  if (status === 'error' || !broker) {
    return <Alert severity="error">{error ?? 'Broker status is unavailable.'}</Alert>;
  }

  async function submitLogin(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await signIn(passphrase);
      setNoticeTone('info');
      setNotice('Signed in on this browser.');
    } catch (reason) {
      setNoticeTone('warning');
      setNotice(reason instanceof Error ? reason.message : 'Sign-in failed.');
    } finally {
      setPassphrase('');
      setBusy(false);
    }
  }

  async function runSync(mode: 'recent' | 'backfill'): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const next = await syncNow(mode === 'backfill' ? { transactions: { mode, startDate: backfillStart } } : { transactions: { mode } });
      const result = syncResult(next);
      setNoticeTone(result.tone);
      setNotice(result.text);
    } catch (reason) {
      setNoticeTone('warning');
      setNotice(reason instanceof Error ? reason.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h4" component="h1">
        Broker & Data
      </Typography>
      <Alert severity="info" icon={false}>
        {broker.disclaimer} Read-only access only. Order routing stays off.
      </Alert>
      {notice ? <Alert severity={noticeTone}>{notice}</Alert> : null}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Owner sign-in</Typography>
        {session?.authenticated ? (
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            <Typography variant="body2">Signed in until {session.expiresAt ?? 'the session expires'}.</Typography>
            <Button variant="outlined" disabled={busy} onClick={() => void signOut().then(() => { setNoticeTone('info'); setNotice('Signed out.'); })}>
              Sign out
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1.5, maxWidth: 420 }}>
            <Typography variant="body2" color="text.secondary">
              {session?.ownerConfigured
                ? 'Use the passphrase created by the local owner-setup command.'
                : 'Run the local owner-setup command before signing in. This form does not collect brokerage credentials.'}
            </Typography>
            <TextField
              label="Owner passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <Button variant="contained" disabled={busy || passphrase.length === 0} onClick={() => void submitLogin()}>
              Sign in
            </Button>
          </Stack>
        )}
      </Paper>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Connection</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
          <Chip label={broker.connection.state.replaceAll('_', ' ')} size="small" />
          <Chip label={broker.connection.environment} size="small" variant="outlined" />
          <Chip label="Read only" size="small" variant="outlined" />
          <Chip label={broker.connection.liveEnabled ? 'Live enabled' : 'Live disabled'} size="small" variant="outlined" />
          <Chip label="Orders disabled" size="small" variant="outlined" />
          <Chip label="Scheduled sync off" size="small" variant="outlined" />
        </Stack>
        <Typography sx={{ mt: 1.5 }}>{broker.connection.message}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Last success: {broker.connection.lastSuccessAt ?? 'none'} · Positions: {broker.sync.positionsAt ?? 'none'} · Transactions:{' '}
          {broker.sync.transactionsAt ?? 'none'}
        </Typography>
      </Paper>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Quotes</Typography>
        <Typography sx={{ mt: 1 }}>{broker.quotes.message}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          State: {broker.quotes.state} · Entitlement: {broker.quotes.entitlement} · Quote time: {broker.quotes.asOf ?? 'none'} · Checked:{' '}
          {broker.quotes.fetchedAt ?? 'none'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {broker.stream.detail}
        </Typography>
        {broker.quotes.symbols.length > 0 ? (
          <Stack spacing={0.5} sx={{ mt: 1.5 }}>
            {broker.quotes.symbols.map((quote) => (
              <Typography key={quote.symbol} variant="body2">
                {quote.symbol} · {quote.freshness.replaceAll('_', ' ')} · {quote.entitlement} · {quote.asOf ?? 'no quote time'}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Paper>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Accounts and history</Typography>
        <Typography sx={{ mt: 1 }}>{broker.history.message}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Coverage: {broker.history.coverageStart ?? 'none'} to {broker.history.coverageEnd ?? 'none'} · Status: {broker.history.status}
        </Typography>
        {broker.history.lastImport ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Pages {broker.history.lastImport.pagesFetched} · Received {broker.history.lastImport.received} · Valid {broker.history.lastImport.valid} · Inserted{' '}
            {broker.history.lastImport.inserted} · Updated {broker.history.lastImport.updated} · Skipped {broker.history.lastImport.skipped}
            {broker.history.lastImport.skipReasons.length > 0
              ? ` · ${broker.history.lastImport.skipReasons.map((item) => `${item.count} ${item.reason}`).join('; ')}`
              : ''}
            {' · '}Earliest {broker.history.lastImport.earliest ?? 'none'} · Latest {broker.history.lastImport.latest ?? 'none'}
          </Typography>
        ) : null}
        {broker.accounts.length === 0 ? (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            No accounts are shown until you sign in.
          </Typography>
        ) : (
          <TextField
            select
            label="Selected account"
            value={broker.accounts.find((account) => account.selected)?.id ?? ''}
            sx={{ mt: 2, minWidth: 280 }}
            onChange={(event) => {
              void chooseAccount(event.target.value).catch((reason: unknown) => {
                setNotice(reason instanceof Error ? reason.message : 'Account selection failed.');
              });
            }}
          >
            {broker.accounts.map((account) => (
              <MenuItem key={account.id} value={account.id}>
                {account.maskedAccount} · {account.accountType} · {account.authority}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
          <Button variant="contained" disabled={busy || !session?.authenticated} onClick={() => void runSync('recent')}>
            Sync recent history
          </Button>
          <TextField
            label="Backfill start"
            type="date"
            value={backfillStart}
            onChange={(event) => setBackfillStart(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Button variant="outlined" disabled={busy || !session?.authenticated || backfillStart.length === 0} onClick={() => void runSync('backfill')}>
            Backfill from date
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

function syncResult(overview: BrokerOverview): { text: string; tone: 'warning' | 'success' } {
  const imported = overview.history.lastImport;
  const storedNone = imported != null && imported.received > 0 && imported.valid === 0;
  if (overview.history.status === 'incomplete' || storedNone) {
    return { text: overview.history.message, tone: 'warning' };
  }
  if (imported) {
    return {
      text: `Imported ${imported.inserted} new and updated ${imported.updated} of ${imported.received} records.`,
      tone: 'success',
    };
  }
  return { text: 'Sync finished.', tone: 'success' };
}

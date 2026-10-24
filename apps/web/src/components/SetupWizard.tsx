import { useState } from 'react';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { saveBrokerCredentials } from '../api/client';
import { useAppState } from '../state/AppState';

const STORAGE_KEY = 'optionscout.setupWizard';

type Step = 'book' | 'passphrase' | 'grant' | 'status';

export function SetupWizard() {
  const { session, sessionStatus, createPassphrase, applyBroker } = useAppState();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'done';
    } catch {
      return false;
    }
  });
  const [step, setStep] = useState<Step>('book');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passphraseNote, setPassphraseNote] = useState<string | null>(null);
  const [passphraseOutcome, setPassphraseOutcome] = useState<'saved' | 'skipped' | 'preview'>('skipped');
  const [grantOutcome, setGrantOutcome] = useState<'saved' | 'skipped' | 'preview'>('skipped');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [grantNote, setGrantNote] = useState<string | null>(null);
  const preview = session?.publicSimulatedDemo === true;
  const secretsAllowed = sessionStatus === 'ready' && !preview;

  function finish(nextPassphrase: typeof passphraseOutcome, nextGrant: typeof grantOutcome) {
    setPassphrase('');
    setConfirm('');
    setClientId('');
    setClientSecret('');
    setRefreshToken('');
    setPassphraseOutcome(nextPassphrase);
    setGrantOutcome(nextGrant);
    setStep('status');
  }

  function close() {
    setPassphrase('');
    setConfirm('');
    setClientSecret('');
    setRefreshToken('');
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, 'done');
    } catch {
      // The wizard can be opened again from this page.
    }
  }

  if (dismissed) {
    return (
      <Button onClick={() => { setDismissed(false); setStep('book'); }}>
        Show setup
      </Button>
    );
  }

  return (
    <Paper className="os-card" component="section" aria-label="Setup wizard" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="overline" color="primary.main">
        Setup
      </Typography>
      {step === 'book' ? (
        <Stack spacing={1.5} sx={{ mt: 1, maxWidth: 720 }}>
          <Typography variant="h5" component="h2">
            Start on the simulated book
          </Typography>
          <Typography variant="body1">
            The prices on this desk are fictional. You can learn the screens before a brokerage is connected. Orders stay off.
          </Typography>
          <Button variant="contained" onClick={() => setStep('passphrase')} sx={{ alignSelf: 'flex-start' }}>
            Continue
          </Button>
        </Stack>
      ) : null}
      {step === 'passphrase' ? (
        <Stack spacing={1.5} sx={{ mt: 1, maxWidth: 520 }}>
          <Typography variant="h5" component="h2">
            Create a passphrase
          </Typography>
          <Typography variant="body1">
            The passphrase unlocks this computer&apos;s OptionScout. It is stored as a hash. It is not sent to a brokerage.
          </Typography>
          {secretsAllowed ? (
            <>
              <TextField
                label="New passphrase"
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                helperText="At least 12 characters."
              />
              <TextField
                label="Repeat passphrase"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
              {passphraseNote ? <Typography variant="body2">{passphraseNote}</Typography> : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  disabled={passphrase.length < 12 || confirm.length < 12}
                  onClick={() => {
                    const entered = passphrase;
                    const repeated = confirm;
                    setPassphrase('');
                    setConfirm('');
                    void createPassphrase(entered, repeated)
                      .then(() => {
                        setPassphraseOutcome('saved');
                        setStep('grant');
                      })
                      .catch((reason: unknown) => {
                        setPassphrase(entered);
                        setConfirm(repeated);
                        setPassphraseNote(reason instanceof Error ? reason.message : 'The passphrase was not saved.');
                      });
                  }}
                >
                  Save passphrase
                </Button>
                <Button onClick={() => { setPassphraseOutcome('skipped'); setStep('grant'); }}>Skip for now</Button>
              </Stack>
            </>
          ) : (
            <>
              <Typography variant="body1">
                This public preview stays on the simulated book and does not store a passphrase.
              </Typography>
              <Button variant="contained" onClick={() => { setPassphraseOutcome('preview'); setGrantOutcome('preview'); setStep('grant'); }} sx={{ alignSelf: 'flex-start' }}>
                Continue on the simulated book
              </Button>
            </>
          )}
        </Stack>
      ) : null}
      {step === 'grant' ? (
        <Stack spacing={1.5} sx={{ mt: 1, maxWidth: 720 }}>
          <Typography variant="h5" component="h2">
            Optional: a personal tastytrade grant
          </Typography>
          <Typography variant="body1">
            You can skip this. A grant is only for reading your own account. OptionScout does not place orders.
          </Typography>
          <Typography variant="body1" component="ol" sx={{ pl: 2.5, m: 0 }}>
            <li>
              Create a personal OAuth app in the{' '}
              <Link href="https://developer.tastytrade.com/" target="_blank" rel="noopener noreferrer">
                tastytrade developer portal
              </Link>
              .
            </li>
            <li>
              Use the refresh-token grant and the read scope only. Do not request trade. The steps are in{' '}
              <Link href="https://developer.tastytrade.com/docs/authentication/oauth2/" target="_blank" rel="noopener noreferrer">
                tastytrade&apos;s OAuth guide
              </Link>
              .
            </li>
            <li>
              Quotes, when a funded account allows them, come from the read-only market-data path described in{' '}
              <Link href="https://developer.tastytrade.com/docs/concepts/market-data/" target="_blank" rel="noopener noreferrer">
                tastytrade&apos;s market data guide
              </Link>
              . Sandbox and production are separate apps.
            </li>
          </Typography>
          {secretsAllowed && session?.authenticated ? (
            <Stack spacing={1.25} sx={{ maxWidth: 520 }}>
              <TextField select size="small" label="Environment" value={environment} onChange={(event) => setEnvironment(event.target.value as 'sandbox' | 'production')}>
                <MenuItem value="production">Production</MenuItem>
                <MenuItem value="sandbox">Sandbox</MenuItem>
              </TextField>
              <TextField size="small" label="Client ID" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
              <TextField size="small" label="Client secret" type="password" value={clientSecret} autoComplete="off" onChange={(event) => setClientSecret(event.target.value)} />
              <TextField size="small" label="Refresh token" type="password" value={refreshToken} autoComplete="off" onChange={(event) => setRefreshToken(event.target.value)} />
              {grantNote ? <Typography variant="body2">{grantNote}</Typography> : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  disabled={clientId.length === 0 || clientSecret.length === 0 || refreshToken.length === 0}
                  onClick={() => {
                    const secret = clientSecret;
                    const token = refreshToken;
                    setClientSecret('');
                    setRefreshToken('');
                    void saveBrokerCredentials({ environment, clientId, clientSecret: secret, refreshToken: token })
                      .then((body) => {
                        applyBroker(body);
                        setClientId('');
                        finish(passphraseOutcome, 'saved');
                      })
                      .catch((reason: unknown) => {
                        setClientSecret(secret);
                        setRefreshToken(token);
                        setGrantNote(reason instanceof Error ? reason.message : 'The grant was not saved.');
                      });
                  }}
                >
                  Save read-only grant
                </Button>
                <Button onClick={() => finish(passphraseOutcome, 'skipped')}>Skip for now</Button>
              </Stack>
            </Stack>
          ) : (
            <Button variant="contained" onClick={() => finish(passphraseOutcome, preview ? 'preview' : 'skipped')} sx={{ alignSelf: 'flex-start' }}>
              Skip the grant
            </Button>
          )}
        </Stack>
      ) : null}
      {step === 'status' ? (
        <Stack spacing={1.5} sx={{ mt: 1, maxWidth: 720 }}>
          <Typography variant="h5" component="h2">
            Where things stand
          </Typography>
          <Typography variant="body1" role="status">
            You are on the simulated book. Orders are off. Not connected.
          </Typography>
          <Typography variant="body1">
            {passphraseOutcome === 'saved'
              ? 'A passphrase is saved on this computer.'
              : passphraseOutcome === 'preview'
                ? 'This preview did not store a passphrase.'
                : 'No passphrase was saved.'}{' '}
            {grantOutcome === 'saved'
              ? 'A read-only grant is saved on this computer.'
              : grantOutcome === 'preview'
                ? 'This preview did not store a brokerage grant.'
                : 'No brokerage grant was saved.'}
          </Typography>
          <Button variant="contained" onClick={close} sx={{ alignSelf: 'flex-start' }}>
            Done
          </Button>
        </Stack>
      ) : null}
    </Paper>
  );
}

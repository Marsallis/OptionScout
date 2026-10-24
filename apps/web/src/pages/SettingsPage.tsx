import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useColorMode } from '../brand/ColorMode';
import { useExperienceMode } from '../brand/ExperienceMode';
import { ThemePicker } from '../components/ThemePicker';
import { DemoChip } from '../components/DemoChip';
import { SectionNotice } from '../components/SectionNotice';
import { useAppState } from '../state/AppState';

export function SettingsPage() {
  const { settingsStatus, settingsError, settings, session, savePreferences, retrySettings } = useAppState();
  const { mode, setMode } = useColorMode();
  const experience = useExperienceMode();
  const [message, setMessage] = useState<string | null>(null);
  const authenticated = Boolean(session?.authenticated);

  if (settingsStatus === 'loading' || !settings) {
    if (settingsStatus === 'error') {
      return <SectionNotice title="Settings are unavailable." message={settingsError ?? 'The settings request failed.'} onRetry={retrySettings} />;
    }
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 4 }}>
        <CircularProgress size={22} />
        <Typography>Loading settings.</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 760 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Settings
        </Typography>
        <DemoChip />
      </Stack>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Appearance</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Light and dark stay in this browser. Density and Greeks are stored in the local SQLite database.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
          <Button variant={mode === 'light' ? 'contained' : 'outlined'} onClick={() => setMode('light')}>
            Light
          </Button>
          <Button variant={mode === 'dark' ? 'contained' : 'outlined'} onClick={() => setMode('dark')}>
            Dark
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Colorways sit on top of light and dark. The choice stays in this browser.
        </Typography>
        <ThemePicker compact />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Beginner adds a welcome guide and a plain-language payoff picture. Pro keeps the same pages with less teaching text.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button variant={experience.mode === 'beginner' ? 'contained' : 'outlined'} onClick={() => experience.setMode('beginner')} aria-pressed={experience.mode === 'beginner'}>
            Beginner view
          </Button>
          <Button variant={experience.mode === 'pro' ? 'contained' : 'outlined'} onClick={() => experience.setMode('pro')} aria-pressed={experience.mode === 'pro'}>
            Pro view
          </Button>
        </Stack>
        <Typography variant="h6" sx={{ mt: 3 }}>
          Display
        </Typography>
        <RadioGroup
          sx={{ mt: 2 }}
          value={settings.density}
          onChange={(event) => {
            const density = event.target.value === 'compact' ? 'compact' : 'comfortable';
            void savePreferences({ density }).then(() => setMessage('Saved on this device.'));
          }}
        >
          <FormControlLabel value="comfortable" control={<Radio />} label="Comfortable density" />
          <FormControlLabel value="compact" control={<Radio />} label="Compact density" />
        </RadioGroup>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={
            <Switch
              checked={settings.showGreeks}
              onChange={(event) => {
                void savePreferences({ showGreeks: event.target.checked }).then(() => setMessage('Saved on this device.'));
              }}
            />
          }
          label="Show demo Greeks on the overview"
        />
        <Typography variant="h6" sx={{ mt: 3 }}>
          Portfolio view
        </Typography>
        <RadioGroup
          value={settings.portfolioView}
          onChange={(event) => {
            const portfolioView = event.target.value === 'brokerage' ? 'brokerage' : 'demo';
            void savePreferences({ portfolioView })
              .then(() => setMessage('Saved on this device.'))
              .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'The portfolio view was not saved.'));
          }}
        >
          <FormControlLabel value="demo" control={<Radio />} label="Synthetic demo book" />
          <FormControlLabel value="brokerage" control={<Radio />} label="Authenticated brokerage account" />
        </RadioGroup>
        <Typography variant="h6" sx={{ mt: 3 }}>
          LEAPS Finder searches
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          On-demand searches are read-only market-data requests. Orders stay disabled. Searches never run at startup.
        </Typography>
        <LockedRow
          label="Installation permission (FINDER_LIVE_SCAN)"
          value={settings.finderLiveScanInstallAllowed ? 'Allowed for this process' : 'Not allowed — set FINDER_LIVE_SCAN=true and restart'}
        />
        <FormControlLabel
          sx={{ mt: 1, display: 'flex' }}
          control={
            <Switch
              checked={settings.finderOnDemandSearchEnabled}
              disabled={!settings.finderLiveScanInstallAllowed}
              onChange={(event) => {
                void savePreferences({ finderOnDemandSearchEnabled: event.target.checked })
                  .then(() => setMessage('Saved on this device.'))
                  .catch((reason: unknown) =>
                    setMessage(reason instanceof Error ? reason.message : 'On-demand search setting was not saved.'),
                  );
              }}
            />
          }
          label="Enable on-demand LEAPS market searches"
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {settings.finderLiveScanInstallAllowed
            ? 'Turn this on after sign-in when you want Find LEAPS to use read-only brokerage chains. Keep Authenticated brokerage view selected for real tickers. Orders stay disabled.'
            : 'Installation permission is off (FINDER_LIVE_SCAN=false). Set it to true in docker-compose and recreate the service once; this switch cannot bypass that gate.'}
        </Typography>
        <Typography variant="h6" sx={{ mt: 3 }}>
          Smart Scan mode
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Choose Diagnostic (CVX/QCOM/WMT allowlist) or Normal (up to 12 provider-validated tickers). Live scans still
          require SMART_SCAN_LIVE at install time — the browser cannot override that gate.
        </Typography>
        <LockedRow
          label="Installation permission (SMART_SCAN_LIVE)"
          value={
            settings.smartScanLiveInstallAllowed
              ? 'Allowed for this process'
              : 'Not allowed — set SMART_SCAN_LIVE=true and restart'
          }
        />
        <RadioGroup
          sx={{ mt: 1 }}
          value={settings.smartScanMode}
          onChange={(event) => {
            const smartScanMode = event.target.value === 'diagnostic' ? 'diagnostic' : 'normal';
            void savePreferences({ smartScanMode })
              .then(() => setMessage('Saved on this device.'))
              .catch((reason: unknown) =>
                setMessage(reason instanceof Error ? reason.message : 'Smart Scan mode was not saved.'),
              );
          }}
        >
          <FormControlLabel
            value="diagnostic"
            control={<Radio />}
            disabled={!authenticated}
            label="Diagnostic — CVX, QCOM, WMT only (max 3 tickers, 24 session evaluations)"
          />
          <FormControlLabel
            value="normal"
            control={<Radio />}
            disabled={!authenticated}
            label="Normal — up to 12 companies, initial budget 24, Scan More paced without a 24-total hard cap"
          />
        </RadioGroup>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {!authenticated
            ? 'Sign in to change Smart Scan mode. Mode preference is stored in SQLite without recreating Docker.'
            : settings.smartScanLiveInstallAllowed
              ? 'Return to Diagnostic anytime from this page if you want the allowlist and 24-evaluation session cap again. Orders and scheduled sync stay off.'
              : 'SMART_SCAN_LIVE is false for this installation. You can still store Normal or Diagnostic here, but Discover stays on simulated fixtures until the install gate is enabled and the service is restarted.'}
        </Typography>
        {message ? (
          <Alert
            severity={/required|FINDER_LIVE_SCAN|SMART_SCAN_LIVE|failed|not saved/i.test(message) ? 'warning' : 'success'}
            sx={{ mt: 2 }}
          >
            {message}
          </Alert>
        ) : null}
      </Paper>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">Local controls</Typography>
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          <LockedRow label="Data mode" value="Demo book stays available" />
          <LockedRow label="Authentication" value="Local owner passphrase" />
          <LockedRow label="Live brokerage" value="Disabled until you enable it" />
          <LockedRow label="Scheduled sync" value="Disabled" />
          <LockedRow label="Order routing" value="Disabled" />
          <LockedRow label="Telemetry" value="Disabled" />
        </Stack>
        <Typography variant="body2" sx={{ mt: 2 }}>
          Demo labels stay on while the demo book is selected. Brokerage totals are not mixed into the demo dashboard.
        </Typography>
      </Paper>
    </Stack>
  );
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}

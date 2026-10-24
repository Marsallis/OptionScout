import { useState } from 'react';
import { DEMO_DISCLAIMER } from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useAppState } from '../state/AppState';

function quoteLabel(state: string | undefined): string {
  if (state === 'fresh') return 'QUOTES FRESH';
  if (state === 'stale') return 'STALE DATA';
  if (state === 'unavailable') return 'QUOTES UNAVAILABLE';
  if (state === 'closed_session') return 'CLOSED SESSION';
  if (state === 'missing') return 'QUOTES MISSING';
  return 'QUOTES NOT CHECKED';
}

function brokeragePrimaryLabel(input: {
  connected: boolean;
  quoteState: string | undefined;
  hasCachedAsOf: boolean;
  lastSuccessAt: string | null | undefined;
}): string {
  if (input.connected) return 'LIVE BROKERAGE';
  const cachedResearch =
    input.quoteState === 'fresh' ||
    input.quoteState === 'closed_session' ||
    input.quoteState === 'stale' ||
    input.hasCachedAsOf ||
    Boolean(input.lastSuccessAt);
  if (cachedResearch) return 'CACHED RESEARCH';
  return 'PROVIDER SESSION INACTIVE';
}

export function DemoBanner() {
  const theme = useTheme();
  const { dashboard, settings, broker } = useAppState();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const brokerageView = settings?.portfolioView === 'brokerage';
  const connected = broker?.connection.state === 'connected';
  const label = brokerageView
    ? brokeragePrimaryLabel({
        connected,
        quoteState: broker?.quotes.state,
        hasCachedAsOf: Boolean(broker?.quotes.asOf),
        lastSuccessAt: broker?.connection.lastSuccessAt,
      })
    : 'DEMO MODE';
  const primaryDetail = brokerageView
    ? connected
      ? 'Active provider session for live research.'
      : label === 'CACHED RESEARCH'
        ? 'Cached research data available. Provider session is not active right now.'
        : 'No active provider session. Sign in on Broker & Data when you need a live connection.'
    : (dashboard?.disclaimer ?? DEMO_DISCLAIMER);
  const dark = theme.palette.mode === 'dark';

  return (
    <Box
      role="status"
      data-testid="demo-banner"
      sx={{
        px: { xs: 2, md: 3 },
        py: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        borderBottom: '1px solid',
        borderColor: dark ? 'rgba(45, 212, 191, 0.35)' : 'rgba(15, 118, 110, 0.28)',
        backgroundColor: dark ? 'rgba(45, 212, 191, 0.10)' : 'rgba(15, 118, 110, 0.08)',
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography
          component="strong"
          sx={{ color: dark ? '#8EE0D6' : 'primary.dark', letterSpacing: '0.08em', fontSize: 12, fontWeight: 800 }}
        >
          {label}
        </Typography>
        {brokerageView ? null : (
          <Typography component="span" variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Demo mode, simulated data
          </Typography>
        )}
        {brokerageView ? (
          <Typography component="strong" sx={{ color: 'text.primary', letterSpacing: '0.08em', fontSize: 12 }}>
            {quoteLabel(broker?.quotes.state)}
          </Typography>
        ) : null}
        <Typography variant="body2" color="text.primary" sx={{ flex: 1, minWidth: 200 }}>
          {primaryDetail}
        </Typography>
        {brokerageView ? (
          <Button size="small" color="inherit" onClick={() => setShowDiagnostics((value) => !value)}>
            {showDiagnostics ? 'Hide diagnostics' : 'Connection diagnostics'}
          </Button>
        ) : null}
      </Box>
      {brokerageView ? (
        <Collapse in={showDiagnostics}>
          <Typography variant="body2" color="text.secondary">
            {broker?.connection.message ?? 'Brokerage data is separate from the demo book.'}{' '}
            {broker?.quotes.message ?? ''} Connection state: {broker?.connection.state ?? 'unknown'}.
          </Typography>
        </Collapse>
      ) : null}
    </Box>
  );
}

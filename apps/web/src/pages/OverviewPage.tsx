import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { Dashboard } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { DemoChip } from '../components/DemoChip';
import { MetricCard } from '../components/MetricCard';
import { formatAction, formatDate, formatSignedUsd, formatSnapshot, formatUsd, pnlColor } from '../lib/format';
import { useAppState } from '../state/AppState';
import { BrokerageOverview } from './BrokeragePages';

const SHORT_CALL_ACTIONS = new Set(['sell_to_open', 'buy_to_close', 'sell_to_close', 'expire']);

export function OverviewPage() {
  const { status, error, dashboard, settings } = useAppState();
  const [showLedger, setShowLedger] = useState(false);

  if (status === 'loading') {
    return (
      <Stack role="status" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center', minHeight: 280 }}>
        <CircularProgress size={28} />
        <Typography>Loading the demo dashboard.</Typography>
      </Stack>
    );
  }

  if (status === 'error' || !dashboard) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        <Typography variant="subtitle2">The demo book did not load.</Typography>
        <Typography variant="body2">{error ?? 'The demo dashboard is unavailable.'}</Typography>
      </Alert>
    );
  }

  if (settings?.portfolioView === 'brokerage') {
    return <BrokerageOverview />;
  }

  const showGreeks = settings?.showGreeks ?? true;
  const dense = settings?.density === 'compact';
  const shortCalls = dashboard.transactions.filter((transaction) => SHORT_CALL_ACTIONS.has(transaction.action));
  const pmccPositions = dashboard.positions.filter((position) => position.strategy === 'pmcc');
  const leapsOnly = dashboard.positions.filter((position) => position.strategy === 'leaps');

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Box>
          <Typography variant="h4" component="h1">
            Overview
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Demo investing snapshot {formatSnapshot(dashboard.asOf)}
          </Typography>
        </Box>
        <DemoChip />
      </Stack>

      <Paper data-testid="home-intro" sx={{ p: { xs: 2, md: 3 }, backgroundImage: 'none' }}>
        <Typography variant="overline" color="primary.main">
          What OptionScout does
        </Typography>
        <Typography variant="h5" component="h2" sx={{ mt: 0.75, maxWidth: 720 }}>
          Compare long-dated calls with rules you saved.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 760 }}>
          This home view is the simulated book: fictional positions, prices, and alerts so you can learn the desk before connecting a
          brokerage. Searches stay on your computer. Matching a rule is never a claim that a trade is profitable.
        </Typography>
        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          }}
        >
          <IntroStep
            step="1"
            title="Read the book"
            body="Overview shows capital, unrealized marks, and upcoming expirations from the demo fixtures."
          />
          <IntroStep
            step="2"
            title="Check one chain"
            body="Find One Stock evaluates the fictional DEMO ticker against your saved hard rules and preferences."
          />
          <IntroStep
            step="3"
            title="Compare a list"
            body="Explore Stocks groups best and near matches. Best means every assessed rule passed."
          />
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" component={RouterLink} to="/leaps">
            Start with one ticker
          </Button>
          <Button variant="outlined" component={RouterLink} to="/discover">
            Compare several companies
          </Button>
          <Button variant="outlined" component={RouterLink} to="/strategies">
            Edit investing rules
          </Button>
        </Stack>
      </Paper>

      <Alert severity="info" icon={false}>
        Positions currently held, capital at work, and risk-review alerts. Matching a strategy or filter is never a claim that a trade is
        profitable. Expand “How this was calculated” for the detailed ledger.
      </Alert>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' },
        }}
      >
        <MetricCard
          label="Positions held"
          value={String(dashboard.summary.openPositions)}
          hint={`${leapsOnly.length} LEAPS · ${pmccPositions.length} PMCC`}
        />
        <MetricCard
          label="Estimated invested capital"
          value={formatUsd(dashboard.summary.leapsCapital)}
          hint="Premium paid for open long calls"
        />
        <MetricCard
          label="Estimated unrealized P/L"
          value={formatSignedUsd(dashboard.summary.estimatedUnrealizedPnl)}
          hint="Mark to market against demo fixture prices"
          valueColor={pnlColor(dashboard.summary.estimatedUnrealizedPnl)}
        />
        <MetricCard
          label="Realized results"
          value={formatSignedUsd(dashboard.summary.realizedPnl)}
          hint="Closed short-call cycles in the fixture"
          valueColor={pnlColor(dashboard.summary.realizedPnl)}
        />
        <MetricCard
          label="Short-call credits collected"
          value={formatUsd(dashboard.summary.shortCallCreditsReceived)}
          hint="Gross credits vs realized short-call profit in the ledger below"
        />
        <MetricCard
          label="Upcoming expirations"
          value={String(dashboard.summary.upcomingExpirationCount)}
          hint="Open contracts inside 90 days — review assignment and roll risk"
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          alignItems: 'start',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1.8fr) minmax(280px, 0.9fr)' },
        }}
      >
        <Stack spacing={2}>
          {pmccPositions.length > 0 ? (
            <Paper sx={{ p: 2 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">PMCC positions</Typography>
                <DemoChip />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Each PMCC has two linked roles: the long LEAPS for upside exposure, and short calls for premium. The long call does not
                remove assignment risk on the short call.
              </Typography>
              <Stack spacing={1.5}>
                {pmccPositions.map((position) => (
                  <Box key={position.id} sx={{ pl: 1.5, borderLeft: '3px solid', borderColor: 'primary.main' }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                      <Typography variant="subtitle2">{position.underlying}</Typography>
                      <Chip size="small" label="PMCC" variant="outlined" />
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      {position.structure}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Capital {formatUsd(position.leapsCapital)} · Unrealized {formatSignedUsd(position.estimatedUnrealizedPnl)} ·
                      Realized {formatSignedUsd(position.realizedPnl)}
                    </Typography>
                    {position.legs?.length ? (
                      <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                        {position.legs.map((leg) => (
                          <Typography key={leg.id} variant="caption" color="text.secondary">
                            {leg.side === 'long' ? 'Long LEAPS' : 'Short call'}: {leg.optionType} ${leg.strike} ·{' '}
                            {formatDate(leg.expiration)}
                          </Typography>
                        ))}
                      </Stack>
                    ) : null}
                  </Box>
                ))}
              </Stack>
            </Paper>
          ) : null}

          <Paper sx={{ overflow: 'auto' }}>
            <Stack direction="row" sx={{ px: 2, py: 1.5, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6">Active positions</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button size="small" onClick={() => setShowLedger((value) => !value)}>
                  {showLedger ? 'Hide how this was calculated' : 'How this was calculated'}
                </Button>
                <DemoChip />
              </Stack>
            </Stack>
            <Table size={dense ? 'small' : 'medium'}>
              <TableHead>
                <TableRow>
                  <TableCell>Underlying</TableCell>
                  <TableCell>Strategy</TableCell>
                  <TableCell>Structure</TableCell>
                  <TableCell align="right">Capital</TableCell>
                  <TableCell align="right">Unrealized</TableCell>
                  <TableCell align="right">Realized</TableCell>
                  {showGreeks ? <TableCell align="right">Net delta</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {dashboard.positions.map((position) => (
                  <TableRow key={position.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{position.underlying}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={position.strategy === 'leaps' ? 'LEAPS' : 'PMCC'}
                        variant="outlined"
                        sx={{ borderColor: 'rgba(46, 196, 182, 0.45)' }}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <Typography variant="body2">{position.structure}</Typography>
                      {position.closedShortSummary ? (
                        <Typography variant="caption" color="text.secondary">
                          {position.closedShortSummary}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatUsd(position.leapsCapital)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: pnlColor(position.estimatedUnrealizedPnl), fontVariantNumeric: 'tabular-nums' }}>
                      {formatSignedUsd(position.estimatedUnrealizedPnl)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: pnlColor(position.realizedPnl), fontVariantNumeric: 'tabular-nums' }}>
                      {formatSignedUsd(position.realizedPnl)}
                    </TableCell>
                    {showGreeks ? (
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {position.netDelta?.toFixed(2) ?? '—'}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Collapse in={showLedger}>
              <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Demo ledger marks use fixture prices. LEAPS capital is premium paid for open long calls. Short-call credits are gross
                  credits from open and closed short cycles; realized P/L reflects closed short-call cycles in the fixture.
                </Typography>
              </Box>
            </Collapse>
          </Paper>

          <Paper sx={{ overflow: 'auto' }}>
            <Stack direction="row" sx={{ px: 2, py: 1.5, justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">Short-call transactions</Typography>
              <DemoChip />
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Underlying</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Contract</TableCell>
                  <TableCell align="right">Cash flow</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shortCalls.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>{formatDate(transaction.occurredOn)}</TableCell>
                    <TableCell>{transaction.underlying}</TableCell>
                    <TableCell>{formatAction(transaction.action)}</TableCell>
                    <TableCell>{transaction.optionSummary}</TableCell>
                    <TableCell align="right" sx={{ color: pnlColor(transaction.cashFlow), fontVariantNumeric: 'tabular-nums' }}>
                      {formatSignedUsd(transaction.cashFlow)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Stack>

        <Stack spacing={2}>
          <BrokerCard dashboard={dashboard} />
          <Panel title="Upcoming expirations">
            <Stack spacing={1.25}>
              {dashboard.upcomingExpirations.map((item) => (
                <Box key={item.legId}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {item.underlying} {item.side} {item.strike} {item.optionType}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(item.expiration)} · {item.daysToExpiration} days · demo contract
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Panel>
          <Panel title="Alerts">
            <Stack spacing={1.25}>
              {dashboard.alerts.map((alert) => (
                <Box
                  key={alert.id}
                  sx={{
                    pl: 1.25,
                    borderLeft: '3px solid',
                    borderColor:
                      alert.severity === 'warning' ? 'warning.main' : alert.severity === 'attention' ? 'primary.main' : 'divider',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {alert.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {alert.message}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Panel>
        </Stack>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' } }}>
        <Panel title="Watchlist">
          <Stack spacing={1.25}>
            {dashboard.watchlist.map((item) => (
              <Box key={item.id}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {item.underlying}
                  </Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatUsd(item.demoLast)}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {item.note}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Panel>
        <Panel title="Research opportunities">
          <Stack spacing={1.25}>
            {dashboard.research.map((item) => (
              <Box key={item.id}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Illustrative premium {formatUsd(item.illustrativePremium)}. {item.criteriaNote}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Panel>
        <Panel title="Journal notes">
          <Stack spacing={1.25}>
            {dashboard.journal.map((entry) => (
              <Box key={entry.id}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {entry.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(entry.createdAt)} · {entry.body}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Panel>
      </Box>
    </Stack>
  );
}

function IntroStep({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', minWidth: 0 }}>
      <Typography variant="caption" color="primary.main" sx={{ fontWeight: 800 }}>
        {step}
      </Typography>
      <Typography variant="subtitle2" sx={{ mt: 0.25 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {body}
      </Typography>
    </Box>
  );
}

function BrokerCard({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Brokerage connection</Typography>
        <DemoChip />
      </Stack>
      <Typography variant="body2" sx={{ fontWeight: 650 }}>
        {dashboard.brokerage.connectionStatus === 'demo-only' ? 'Demo only' : dashboard.brokerage.connectionStatus}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
        {dashboard.brokerage.label}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
        Account: {dashboard.brokerage.accountName}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        OAuth: not configured · Orders: disabled · Live credentials: not required
      </Typography>
    </Paper>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.25 }}>
        <Typography variant="h6">{title}</Typography>
        <DemoChip />
      </Stack>
      {children}
    </Paper>
  );
}

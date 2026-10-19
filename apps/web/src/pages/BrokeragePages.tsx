import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Portfolio, PortfolioPosition } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { confirmPortfolioStrategy, deletePortfolioStrategy, fetchPortfolio } from '../api/client';
import { AttentionList, OpenPositionsTable, PortfolioHeader, SnapshotGrid } from '../components/overview/PortfolioDashboard';
import { calendarDaysUntil, localDateIso } from '../components/overview/overviewModel';
import { ResearchPanel } from '../components/overview/ResearchPanel';
import { formatDate, formatMoney, formatSnapshot } from '../lib/format';
import { useAppState } from '../state/AppState';

export function BrokerageOverview() {
  const portfolio = usePortfolio();
  const [showHealth, setShowHealth] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRealizedAudit, setShowRealizedAudit] = useState(false);
  if (portfolio.kind !== 'ready') return <PortfolioGate state={portfolio} />;
  const { data, reload, notice, setNotice } = portfolio;

  return (
    <Stack spacing={3}>
      <PortfolioHeader portfolio={data} />
      {notice ? <Alert severity="warning">{notice}</Alert> : null}
      <SnapshotGrid portfolio={data} />
      <AttentionList
        portfolio={data}
        onConfirm={(suggestionKey) => {
          const suggestion = data.suggestions.find((item) => `${item.longSymbol}-${item.shortSymbol}` === suggestionKey);
          if (!suggestion) return;
          const short = data.positions.find((position) => position.symbol === suggestion.shortSymbol);
          const cycle = short?.cycles.find((item) => item.side === 'short' && item.status === 'open');
          if (!short || !cycle) {
            setNotice('The open short cycle could not be confirmed.');
            return;
          }
          void confirmPortfolioStrategy({
            underlying: suggestion.underlying,
            longSymbol: suggestion.longSymbol,
            shortCycles: [{ providerSymbol: short.symbol, openingTransactionId: cycle.openingTransactionId }],
          })
            .then(() => reload())
            .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Confirmation failed.'));
        }}
      />

      <Stack spacing={1.25} component="section" aria-label="My open strategies">
        <Typography variant="h5" component="h2" sx={{ fontSize: { xs: '1.25rem', md: '1.5rem' } }}>
          My Open Strategies
        </Typography>
        {data.strategies.length === 0 ? (
          <Typography variant="body1">No confirmed PMCC strategies yet. A shared ticker is not paired until you confirm it.</Typography>
        ) : (
          <Stack spacing={2}>
            {data.strategies.map((strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                positions={data.positions}
                beginner
                onRemove={() =>
                  void deletePortfolioStrategy(strategy.id)
                    .then(() => reload())
                    .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Removal failed.'))
                }
              />
            ))}
          </Stack>
        )}
      </Stack>
      <OpenPositionsTable portfolio={data} />
      <ResearchPanel />
      <Button variant="outlined" onClick={() => setShowAdvanced((value) => !value)} sx={{ alignSelf: 'flex-start' }}>
        {showAdvanced ? 'Hide advanced portfolio details' : 'Advanced Portfolio Details'}
      </Button>
      <Collapse in={showAdvanced}>
      <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6">Realized results audit</Typography>
          <Button size="small" onClick={() => setShowRealizedAudit((value) => !value)}>
            {showRealizedAudit ? 'Hide how this was calculated' : 'How this was calculated'}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {data.realizedAudit.label}
          {data.realizedAudit.includedCycleCount > 0
            ? ` · ${data.realizedAudit.includedCycleCount} included cycle(s)`
            : ''}
          . Gross short opening credits ({formatMoney(data.realizedAudit.grossShortOpeningCredits)}) are not the same as closed short
          realized ({formatMoney(data.realizedAudit.closedShortRealized)}) or closed long realized (
          {formatMoney(data.realizedAudit.closedLongRealized)}). Deposits, withdrawals, and unresolved assignments are not trading
          profit.
        </Typography>
        <Collapse in={showRealizedAudit}>
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            <Typography variant="body2">{data.realizedAudit.howCalculated}</Typography>
            {data.realizedAudit.unknownFeeCount > 0 ? (
              <Alert severity="warning" icon={false}>
                {data.realizedAudit.unknownFeeCount} cycle(s) have incomplete or estimated fees — totals are qualified, not fully
                verified net cash.
              </Alert>
            ) : null}
            {data.realizedAudit.excludedNotes.map((note) => (
              <Typography key={note} variant="caption" color="warning.main" display="block">
                {note}
              </Typography>
            ))}
            {data.realizedAudit.lines.length === 0 ? (
              <Typography variant="body2">No reconstructed option cycles contributed realized cash yet.</Typography>
            ) : (
              data.realizedAudit.lines.map((line) => (
                <Box
                  key={`${line.id}-${line.symbol}-${line.openedAt ?? 'open'}`}
                  sx={{ borderLeft: '3px solid', borderColor: line.includedInTotal ? 'primary.main' : 'divider', pl: 1.25 }}
                >
                  <Typography variant="body2">
                    {line.underlying} {line.side} · {line.symbol.trim()} · {line.status} · realized {formatMoney(line.realized)}
                    {line.includedInTotal ? '' : ' (not in total)'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Entry {line.openedAt ? formatSnapshot(line.openedAt) : '—'} · Exit{' '}
                    {line.closedAt ? formatSnapshot(line.closedAt) : '—'} · Qty {line.originalQuantity ?? '—'}
                    {line.openQuantity != null && line.openQuantity !== line.originalQuantity
                      ? ` (still open ${line.openQuantity})`
                      : ''}{' '}
                    · Mult {line.multiplier ?? '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Opening cash {formatMoney(line.openingCash)} · Closing cash {formatMoney(line.closingCash)} · Known fees{' '}
                    {formatMoney(line.fees)}
                    {line.feesComplete ? '' : ' · fees incomplete'} · {line.note}
                  </Typography>
                </Box>
              ))
            )}
          </Stack>
        </Collapse>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">PMCC candidates still needing confirmation</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          A shared underlying does not save a strategy. Already-confirmed short cycles are not offered again.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {data.suggestions.length === 0 ? <Typography variant="body2">No pending call pair is available.</Typography> : null}
          {data.suggestions.map((suggestion) => (
            <Stack key={`${suggestion.longSymbol}-${suggestion.shortSymbol}`} spacing={0.5}>
              <Typography variant="body2">
                {suggestion.underlying}: long LEAPS {suggestion.longSymbol} · short call {suggestion.shortSymbol}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {suggestion.reason}
              </Typography>
              {suggestion.ambiguous ? (
                <Typography variant="body2">This pair is ambiguous, so it is not offered for confirmation.</Typography>
              ) : (
                <Typography variant="body2">Confirm it from Needs Your Attention. It is not paired automatically.</Typography>
              )}
            </Stack>
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Figures come from imported brokerage transactions and REST quote snapshots. Long remaining basis is known-fee entry cost for
          open quantity; short remaining basis is known-fee net credit still open. Default market value and unrealized P/L use the brokerage
          REST mark for every leg. Midpoint and conservative bid/ask illustrations stay labeled on each confirmed PMCC and are not mixed
          into the headline cards. Opening short-call credits are not realized profit. Partial realized dollars:{' '}
          {formatMoney(data.realizedAudit.totalIncluded)}.
        </Typography>
      </Paper>
      <UnresolvedContracts positions={data.positions.filter((position) => position.status === 'unreconciled' || position.status === 'missing-opening')} />

      <Paper id="data-health" sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Data Health</Typography>
          <Button size="small" onClick={() => setShowHealth((value) => !value)}>
            {showHealth ? 'Hide' : 'Show details'}
          </Button>
        </Stack>
        <Collapse in={showHealth}>
          <DataHealthBody portfolio={data} />
        </Collapse>
      </Paper>
      </Stack>
      </Collapse>
    </Stack>
  );
}

export function PositionsPage() {
  const { settings } = useAppState();
  const portfolio = usePortfolio();
  if (settings?.portfolioView !== 'brokerage') {
    return (
      <Stack spacing={2}>
        <Typography variant="h4" component="h1">
          My Positions
        </Typography>
        <Alert severity="info">The demo book stays on Overview. Choose the brokerage portfolio in Settings, then sign in, to see imported positions.</Alert>
      </Stack>
    );
  }
  if (portfolio.kind !== 'ready') return <PortfolioGate state={portfolio} />;
  return (
    <Stack spacing={2.5}>
      <Typography variant="h4" component="h1">
        My Positions
      </Typography>
      <Alert severity="info">{portfolio.data.disclaimer}</Alert>
      <Paper sx={{ p: 2, overflowX: 'auto' }}>
        <Typography variant="h6">Reconstructed contracts</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          Flat rows are closed cycles or withheld events. They are not added to the open LEAPS or short-call figures.
        </Typography>
        <PositionTable positions={portfolio.data.positions} emptyLabel="No brokerage contracts were reconstructed." />
      </Paper>
    </Stack>
  );
}

export function PositionDetailPage() {
  const { positionId } = useParams();
  const portfolio = usePortfolio();
  const [selected, setSelected] = useState<string[]>([]);
  if (portfolio.kind !== 'ready') return <PortfolioGate state={portfolio} />;
  const position = portfolio.data.positions.find((item) => item.id === positionId);
  if (!position) return <Alert severity="warning">That brokerage position is not in the reconstructed book.</Alert>;
  const longs = portfolio.data.positions.filter((item) => item.underlying === position.underlying && item.direction === 'long' && item.optionRight === 'call');
  const shortStillSuggested = portfolio.data.suggestions.some(
    (row) => row.shortSymbol === position.symbol && row.underlying === position.underlying,
  );
  const underlyingAlreadyConfirmed = portfolio.data.strategies.some((row) => row.underlying === position.underlying);
  // Already-confirmed open short cycles are filtered server-side from suggestions; do not re-offer Confirm for them.
  const shortCycles = position.cycles.filter((cycle) => {
    if (cycle.side !== 'short') return false;
    if (cycle.status === 'open' && underlyingAlreadyConfirmed && !shortStillSuggested) return false;
    return true;
  });
  return (
    <Stack spacing={2.5}>
      <Typography variant="h4" component="h1">
        {position.underlying} {position.direction} {position.optionRight ?? 'contract'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {position.symbol}
      </Typography>
      <Alert severity={position.status === 'complete' ? 'success' : 'warning'}>
        Reconciliation: {position.status}. {position.methodology}
      </Alert>
      <Paper sx={{ p: 2 }}>
        <MetricLine label="Opened" value={position.openedAt ? formatDate(position.openedAt) : 'Unavailable'} />
        <MetricLine label="Expiration" value={position.expiration ? `${formatDate(position.expiration)} · ${calendarDaysUntil(position.expiration, localDateIso()) ?? '—'} days from today` : 'Unavailable'} />
        <MetricLine label="Strike" value={position.strike ?? 'Unavailable'} />
        <MetricLine label="Open contracts" value={position.openQuantity} />
        <MetricLine label="Multiplier" value={position.multiplier ?? 'Unavailable'} />
        <MetricLine label="Gross premium" value={formatMoney(position.originalPremium)} />
        <MetricLine label={position.direction === 'short' ? 'Known-fee net credit' : 'Known-fee entry cost'} value={formatMoney(position.direction === 'short' ? position.remainingBasis : position.entryCost)} />
        <MetricLine label={position.direction === 'short' ? 'Net credit remaining' : 'Remaining cost'} value={formatMoney(position.remainingBasis)} />
        <MetricLine label="Current value or liability" value={formatMoney(position.marketValue)} />
        <MetricLine label="Realized P/L" value={formatMoney(position.realized)} />
        <MetricLine label="Unrealized P/L" value={formatMoney(position.unrealized)} />
        <MetricLine label="Bid / ask / mark" value={`${formatMoney(position.bid)} / ${formatMoney(position.ask)} / ${formatMoney(position.mark)}`} />
        <MetricLine label="Quote" value={`${position.quoteFreshness.replaceAll('_', ' ')} · ${position.entitlement} · ${position.quoteAsOf ? formatSnapshot(position.quoteAsOf) : 'no quote time'}`} />
        <MetricLine label="Broker average open price" value={position.brokerAverageOpenPrice ?? 'Unavailable'} />
        <MetricLine label="FIFO average premium" value={position.calculatedAverageOpenPrice ?? 'Unavailable'} />
        <MetricLine label="Average difference" value={formatMoney(position.averagePriceDifference)} />
      </Paper>
      {position.issues.length > 0 ? (
        <Alert severity="warning">{position.issues.join(' ')}</Alert>
      ) : null}
      <Paper sx={{ p: 2, overflowX: 'auto' }}>
        <Typography variant="h6">Transaction cycles</Typography>
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>Opened</TableCell>
              <TableCell>Side</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Opening cash</TableCell>
              <TableCell align="right">Closing cash</TableCell>
              <TableCell align="right">Fees</TableCell>
              <TableCell align="right">Realized</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {position.cycles.map((cycle) => (
              <TableRow key={cycle.openingTransactionId}>
                <TableCell>{cycle.openedAt ? formatDate(cycle.openedAt) : '—'}</TableCell>
                <TableCell>{cycle.side}</TableCell>
                <TableCell>{cycle.status}</TableCell>
                <TableCell align="right">{formatMoney(cycle.openingCash)}</TableCell>
                <TableCell align="right">{formatMoney(cycle.closingCash)}</TableCell>
                <TableCell align="right">{formatMoney(cycle.fees)}</TableCell>
                <TableCell align="right">{formatMoney(cycle.realized)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {position.cycles.flatMap((cycle) => cycle.notes.map((note) => `${cycle.openingTransactionId}: ${note}`)).map((note) => (
          <Typography key={note} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {note}
          </Typography>
        ))}
      </Paper>
      {shortCycles.length > 0 && longs.length > 0 ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Link short cycles to a long call</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Only the cycles you select are included. Other {position.underlying} trades stay out of the strategy.
          </Typography>
          {shortCycles.map((cycle) => (
            <FormControlLabel
              key={cycle.openingTransactionId}
              control={
                <Checkbox
                  checked={selected.includes(cycle.openingTransactionId)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked ? [...current, cycle.openingTransactionId] : current.filter((id) => id !== cycle.openingTransactionId),
                    );
                  }}
                />
              }
              label={`${cycle.openedAt ? formatDate(cycle.openedAt) : 'Undated'} · ${cycle.status} · credit ${formatMoney(cycle.openingCash)}`}
            />
          ))}
          {longs.map((long) => (
            <Button
              key={long.id}
              variant="outlined"
              disabled={selected.length === 0}
              sx={{ mr: 1, mt: 1 }}
              onClick={() => {
                void confirmPortfolioStrategy({
                  underlying: position.underlying,
                  longSymbol: long.symbol,
                  shortCycles: selected.map((openingTransactionId) => ({ providerSymbol: position.symbol, openingTransactionId })),
                })
                  .then(() => portfolio.reload())
                  .catch((reason: unknown) => portfolio.setNotice(reason instanceof Error ? reason.message : 'Confirmation failed.'));
              }}
            >
              Confirm with {long.expiration ?? long.symbol}
            </Button>
          ))}
        </Paper>
      ) : null}
    </Stack>
  );
}

function DataHealthBody({ portfolio }: { portfolio: Portfolio }) {
  const health = portfolio.health;
  const rows = [
    ['Reconstructed open positions', String(health.reconstructed)],
    ['Open positions', String(health.openPositions)],
    ['Missing openings', String(health.missingOpenings)],
    ['Unreconciled events', String(health.unreconciled)],
    ['Unknown fees', String(health.unknownFees)],
    ['Quotes available', String(health.quotesAvailable)],
    ['Quotes unavailable', String(health.quotesUnavailable)],
    ['Last brokerage sync', health.lastSyncAt ? formatSnapshot(health.lastSyncAt) : 'none'],
    ['Last quote timestamp', health.lastQuoteAt ? formatSnapshot(health.lastQuoteAt) : 'none'],
    ['Confirmed strategies', String(health.confirmedGroups)],
    ['Unconfirmed suggestions', String(health.unconfirmedSuggestions)],
    ['Excluded cash movements', String(health.excludedCashEvents)],
  ];
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2">
        Imported window: {portfolio.history.coverageStart ?? 'none'} to {portfolio.history.coverageEnd ?? 'none'} ({portfolio.history.status}).
        Accounting completeness is {portfolio.history.accountingComplete ? 'complete for the open contracts' : 'not complete'}.
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
        {rows.map(([label, value]) => (
          <Typography key={label} variant="body2">
            {label}: {value}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

function UnresolvedContracts({ positions }: { positions: PortfolioPosition[] }) {
  if (positions.length === 0) return null;
  return (
    <Paper sx={{ p: 2, overflowX: 'auto' }}>
      <Typography variant="h6">Unresolved contracts</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
        Profit is withheld for these contracts. They are not included in open-position totals.
      </Typography>
      <PositionTable positions={positions} emptyLabel="No unresolved contracts." />
    </Paper>
  );
}

function PositionTable({ positions, emptyLabel = 'No open brokerage positions are stored.' }: { positions: PortfolioPosition[]; emptyLabel?: string }) {
  if (positions.length === 0) return <Typography sx={{ mt: 1 }}>{emptyLabel}</Typography>;
  return (
    <Table size="small" sx={{ mt: 1 }}>
      <TableHead>
        <TableRow>
          <TableCell>Contract</TableCell>
          <TableCell>Role</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Cost or net credit</TableCell>
          <TableCell align="right">Value</TableCell>
          <TableCell align="right">Realized</TableCell>
          <TableCell align="right">Unrealized</TableCell>
          <TableCell>Quote</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={position.id}>
            <TableCell>
              <Link to={`/positions/${encodeURIComponent(position.id)}`}>{position.symbol}</Link>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {position.expiration ?? 'No expiration'} · qty {position.openQuantity}
              </Typography>
              {position.issues[0] ? (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                  {position.issues[0]}
                </Typography>
              ) : null}
            </TableCell>
            <TableCell>{position.direction} {position.optionRight ?? ''}</TableCell>
            <TableCell>
              <Chip size="small" label={position.status} color={position.status === 'complete' ? 'success' : 'warning'} />
            </TableCell>
            <TableCell align="right">{formatMoney(position.remainingBasis)}</TableCell>
            <TableCell align="right">{formatMoney(position.marketValue)}</TableCell>
            <TableCell align="right">{formatMoney(position.realized)}</TableCell>
            <TableCell align="right">{formatMoney(position.unrealized)}</TableCell>
            <TableCell>{position.quoteFreshness.replaceAll('_', ' ')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StrategyCard({
  strategy,
  positions,
  onRemove,
  beginner = false,
}: {
  strategy: Portfolio['strategies'][number];
  positions: Portfolio['positions'];
  onRemove: () => void;
  beginner?: boolean;
}) {
  const performance = strategy.performance;
  const [showCalc, setShowCalc] = useState(false);
  const long = positions.find((row) => row.symbol === strategy.longSymbol);
  const shortSymbol = performance.shortSymbols[0] ?? null;
  const short = shortSymbol ? positions.find((row) => row.symbol === shortSymbol) : null;
  const shortPnl =
    performance.unrealized != null && performance.longUnrealized != null
      ? (Number(performance.unrealized) - Number(performance.longUnrealized)).toFixed(2)
      : null;
  const quotesCurrent = [long, short].every((leg) => !leg || leg.quoteFreshness === 'fresh');

  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderColor: 'primary.main' }}>
      <Typography variant="h5" component="h3" sx={{ fontWeight: 750, fontSize: { xs: '1.25rem', md: '1.45rem' } }}>
        {strategy.underlying} — Poor Man&apos;s Covered Call
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        The long call does not remove assignment risk on the short call.
      </Typography>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, mt: 1.5 }}>
        <LegPanel title="Long LEAPS" position={long} pnl={performance.longUnrealized} fallback={strategy.longSymbol} showDays />
        <LegPanel title="Short call" position={short} pnl={shortPnl} fallback={shortSymbol ?? 'No open short linked'} showDays />
      </Box>
      {performance.combined != null ? (
        <Typography variant="h6" sx={{ mt: 1.75, color: !performance.complete || !quotesCurrent ? 'warning.main' : 'text.primary' }}>
          Combined estimate {formatMoney(performance.combined)}
          {!performance.complete || !quotesCurrent ? ' — not a verified current result' : ''}
        </Typography>
      ) : null}
      {!performance.complete ? (
        <Alert severity="warning" sx={{ mt: 1.25 }} icon={false}>
          Incomplete accounting — some totals that need missing data are withheld.
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" variant="outlined" onClick={() => setShowCalc((value) => !value)}>
          {showCalc ? 'Hide strategy details' : 'View strategy details'}
        </Button>
        <Button component={Link} to="/positions" size="small">View Position</Button>
      </Stack>
      <Collapse in={showCalc || !beginner}>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          Valuation: {performance.valuationSourceNote}
          {performance.quoteAsOf ? ` Quote as of ${formatSnapshot(performance.quoteAsOf)}.` : ''}
        </Typography>
        {performance.valuationModes.map((mode) => (
          <Typography key={mode.mode} variant="body2" color="text.secondary">
            {mode.label}: {mode.available ? formatMoney(mode.combinedUnrealized) : 'Unavailable'}
          </Typography>
        ))}
        {performance.warnings.map((item) => (
          <Typography key={item} variant="body2" color="warning.main">{item}</Typography>
        ))}
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          <MetricLine label="Known-fee net opening outlay" value={formatMoney(performance.initialNetDebit)} />
          <MetricLine label="Long LEAPS appreciation (mark)" value={formatMoney(performance.longUnrealized)} />
          <MetricLine label="Open short-call P/L (mark)" value={formatMoney(shortPnl)} />
          <MetricLine label="Combined estimated P/L (mark)" value={formatMoney(performance.combined)} />
          <MetricLine label="Long original investment" value={formatMoney(performance.longOriginalInvestment)} />
          <MetricLine label="Long current value (mark)" value={formatMoney(performance.longCurrentValue)} />
          <MetricLine label="Long realized" value={formatMoney(performance.longRealized)} />
          <MetricLine label="Short credits (gross openings)" value={formatMoney(performance.shortCredits)} />
          <MetricLine label="Paid to close shorts" value={formatMoney(performance.shortCloseCost)} />
          <MetricLine label="Short fees" value={formatMoney(performance.shortFees)} />
          <MetricLine label="Short realized" value={formatMoney(performance.shortRealized)} />
          <MetricLine label="Open short liability (mark)" value={formatMoney(performance.shortOpenLiability)} />
          <MetricLine label="Remaining net value" value={formatMoney(performance.remainingNetValue)} />
          <MetricLine label="Combined realized" value={formatMoney(performance.realized)} />
          <MetricLine label="Combined unrealized (mark)" value={formatMoney(performance.unrealized)} />
          <MetricLine label="Known-fee cash still committed" value={formatMoney(performance.capitalAtRisk)} />
        </Stack>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          {performance.capitalExplanation}
        </Typography>
        {performance.assumptions.map((item) => (
          <Typography key={item} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {item}
          </Typography>
        ))}
        <Button
          size="small"
          color="warning"
          sx={{ mt: 1, alignSelf: 'flex-start' }}
          onClick={() => {
            if (window.confirm(`Remove the confirmed ${strategy.underlying} PMCC link? The option positions stay in the account.`)) onRemove();
          }}
        >
          Remove link
        </Button>
      </Collapse>
    </Paper>
  );
}

function LegPanel({
  title,
  position,
  pnl,
  fallback,
  showDays = false,
}: {
  title: string;
  position: Portfolio['positions'][number] | null | undefined;
  pnl: string | null;
  fallback: string;
  showDays?: boolean;
}) {
  const fresh = position?.quoteFreshness === 'fresh';
  const days = position?.expiration ? calendarDaysUntil(position.expiration, localDateIso()) : null;
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', borderLeft: '4px solid', borderColor: 'primary.main' }}>
      <Typography variant="overline" color="primary.main" sx={{ fontWeight: 750, letterSpacing: 0.4 }}>{title}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 750 }}>
        {position ? `${position.underlying} $${position.strike}` : fallback}
      </Typography>
      <Typography variant="body1">{position?.expiration ? formatDate(position.expiration) : 'Expiration unavailable'}</Typography>
      {showDays ? <Typography variant="body1">{days == null ? 'Days from today unavailable' : `${days} days from today`}</Typography> : null}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Estimated unrealized P/L</Typography>
      <Typography variant="body1" sx={{ color: fresh ? 'text.primary' : 'warning.main', fontWeight: 700 }}>
        {pnl == null ? 'Unavailable' : formatMoney(pnl)}
      </Typography>
      <Typography variant="body2" color="text.secondary">{position ? position.quoteFreshness.replaceAll('_', ' ') : 'Quote unavailable'}</Typography>
    </Box>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <Typography variant="body2">
      {label}: {value}
    </Typography>
  );
}

type PortfolioState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: Portfolio; reload: () => void; notice: string | null; setNotice: (value: string | null) => void };

function usePortfolio(): PortfolioState {
  const { session } = useAppState();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const authenticated = session?.authenticated === true;
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    setLoading(true);
    fetchPortfolio()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Portfolio is unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);
  if (!authenticated) return { kind: 'signed-out' };
  if (loading && !data) return { kind: 'loading' };
  if (!data) return { kind: 'error', message: error ?? 'Portfolio is unavailable.' };
  return {
    kind: 'ready',
    data,
    notice,
    setNotice,
    reload: () => {
      setLoading(true);
      fetchPortfolio()
        .then((next) => {
          setData(next);
          setNotice(null);
        })
        .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : 'Portfolio refresh failed.'))
        .finally(() => setLoading(false));
    },
  };
}

function PortfolioGate({ state }: { state: Exclude<PortfolioState, { kind: 'ready' }> }) {
  if (state.kind === 'loading') {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 4 }}>
        <CircularProgress size={22} />
        <Typography>Loading brokerage accounting.</Typography>
      </Stack>
    );
  }
  if (state.kind === 'signed-out') return <Alert severity="warning">Sign in on Broker & Data before imported positions are shown.</Alert>;
  return <Alert severity="error">{state.message}</Alert>;
}

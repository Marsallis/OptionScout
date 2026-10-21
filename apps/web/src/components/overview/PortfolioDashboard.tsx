import { useState } from 'react';
import type { Portfolio, PortfolioPosition } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { formatDate } from '../../lib/format';
import { buildAttention, buildSnapshot, calendarDaysUntil, localDateIso, portfolioStatusLine, type AttentionItem, type SnapshotCard } from './overviewModel';
import { confirmedShortLeg } from './confirmedShort';

const cardValueSize = { xs: '1.6rem', md: '2rem' };

export function PortfolioHeader({ portfolio }: { portfolio: Portfolio }) {
  const status = portfolioStatusLine(portfolio);
  return (
    <Stack spacing={1.25}>
      <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', md: '2rem' }, fontWeight: 750 }}>
        My Portfolio
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Your options positions, estimates, and upcoming dates.
      </Typography>
      <Paper variant="outlined" sx={{ px: 2, py: 1.25 }}>
        <Typography variant="body1" sx={{ fontWeight: 650 }}>{status.title}</Typography>
        <Typography variant="body2" color="text.secondary">{status.detail}</Typography>
        <Button href="#data-health" size="small" sx={{ mt: 0.5, px: 0 }}>
          Data Health
        </Button>
      </Paper>
    </Stack>
  );
}

export function SnapshotGrid({ portfolio }: { portfolio: Portfolio }) {
  const cards = buildSnapshot(portfolio);
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
      }}
    >
      {cards.map((card) => (
        <SnapshotTile key={card.id} card={card} />
      ))}
    </Box>
  );
}

function SnapshotTile({ card }: { card: SnapshotCard }) {
  const color = card.tone === 'positive' ? 'success.main' : card.tone === 'negative' ? 'error.main' : card.tone === 'warning' ? 'warning.main' : 'text.primary';
  return (
    <Paper sx={{ p: 2.25, minHeight: 148 }}>
      <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 650 }}>
        {card.label}
      </Typography>
      <Typography sx={{ fontFamily: 'var(--os-font-heading)', fontSize: cardValueSize, fontWeight: 750, lineHeight: 1.2, mt: 1, color, fontVariantNumeric: 'tabular-nums' }}>
        {card.value}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {card.detail}
      </Typography>
    </Paper>
  );
}

export function AttentionList({
  portfolio,
  onConfirm,
}: {
  portfolio: Portfolio;
  onConfirm: (suggestionKey: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rank = (item: AttentionItem) => (item.id.startsWith('exp-') ? 0 : item.id === 'missing-quotes' ? 1 : item.action === 'confirm' ? 2 : item.id === 'accounting' ? 3 : 4);
  const items = [...buildAttention(portfolio)].sort((left, right) => rank(left) - rank(right) || Number(right.severity === 'warning') - Number(left.severity === 'warning'));
  const visible = showAll ? items : items.slice(0, 3);
  return (
    <Stack spacing={1.25} component="section" aria-label="Needs your attention">
      <Typography variant="h5" component="h2" sx={{ fontSize: { xs: '1.35rem', md: '1.6rem' }, fontWeight: 750 }}>
        Needs Your Attention
      </Typography>
      {items.length === 0 ? (
        <Alert severity="success" icon={false}>
          No position issues currently identified from available data. This is not a statement that the portfolio is risk-free.
        </Alert>
      ) : (
        visible.map((item) => <AttentionRow key={item.id} item={item} onConfirm={onConfirm} />)
      )}
      {items.length > 3 ? (
        <Button onClick={() => setShowAll((value) => !value)} sx={{ alignSelf: 'flex-start' }}>
          {showAll ? 'Show fewer' : `View all ${items.length} items`}
        </Button>
      ) : null}
    </Stack>
  );
}

function AttentionRow({ item, onConfirm }: { item: AttentionItem; onConfirm: (suggestionKey: string) => void }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Chip size="small" label={item.severity === 'warning' ? 'Review' : 'Note'} color={item.severity === 'warning' ? 'warning' : 'default'} />
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{item.title}</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">{item.detail}</Typography>
        </Box>
        {item.action === 'confirm' && item.suggestionKey ? (
          <Button variant="outlined" onClick={() => onConfirm(item.suggestionKey!)}>Confirm this PMCC</Button>
        ) : item.action === 'health' ? (
          <Button href="#data-health" variant="text">Check Data</Button>
        ) : (
          <Button component={RouterLink} to="/positions" variant="text">Review Position</Button>
        )}
      </Stack>
    </Paper>
  );
}

export function OpenPositionsTable({ portfolio }: { portfolio: Portfolio }) {
  const narrow = useMediaQuery(useTheme().breakpoints.down('md'));
  const open = portfolio.positions.filter((position) => position.direction !== 'flat');
  const groupedIds = new Set<string>();
  const groups = portfolio.strategies.map((strategy) => {
    const leg = confirmedShortLeg(strategy.performance.shortSymbols, portfolio.positions);
    const long = open.find((position) => position.symbol === strategy.longSymbol) ?? null;
    const short = leg.activeSymbol ? open.find((position) => position.symbol === leg.activeSymbol) ?? null : null;
    if (long) groupedIds.add(long.id);
    if (short) groupedIds.add(short.id);
    return { id: strategy.id, underlying: strategy.underlying, long, short, closedShort: leg.closed };
  });
  const rest = open.filter((position) => !groupedIds.has(position.id));
  return (
    <Stack spacing={1.25} component="section" aria-label="My open positions">
      <Typography variant="h5" component="h2" sx={{ fontSize: { xs: '1.25rem', md: '1.5rem' } }}>
        My Open Positions
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Confirmed PMCC legs stay together. Other contracts stay separate. Unrealized P/L uses each leg’s brokerage mark when both the mark and the basis exist.
      </Typography>
      {narrow ? (
        <Stack spacing={1.25}>
          {groups.map((group) => (
            <Paper key={group.id} variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="body1" sx={{ fontWeight: 750, mb: 1 }}>{group.underlying} — Poor Man&apos;s Covered Call</Typography>
              {group.closedShort ? <Typography variant="body2">The confirmed short call is closed. It is not shown as an open leg, and no replacement was assigned.</Typography> : null}
              {group.long ? <PositionSummary position={group.long} /> : null}
              {group.short ? <PositionSummary position={group.short} /> : null}
            </Paper>
          ))}
          {rest.map((position) => (
            <Paper key={position.id} variant="outlined" sx={{ p: 1.5 }}>
              <PositionSummary position={position} />
            </Paper>
          ))}
        </Stack>
      ) : null}
      {narrow ? null : (
      <Paper sx={{ overflowX: 'auto' }}>
        <Table size="medium">
          <TableHead>
            <TableRow>
              <TableCell>Position</TableCell>
              <TableCell>Expiration</TableCell>
              <TableCell>Strike</TableCell>
              <TableCell align="right">
                <HelpLabel label="Mark value" tip="Brokerage REST mark times quantity times multiplier. Missing marks stay blank." />
              </TableCell>
              <TableCell align="right">
                <HelpLabel label="Unrealized P/L" tip="Mark value compared with the known-fee remaining basis for that leg. Not a realized profit." />
              </TableCell>
              <TableCell>Quote</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((group) => (
              <GroupRows key={group.id} underlying={group.underlying} long={group.long} short={group.short} closedShort={group.closedShort} />
            ))}
            {rest.map((position) => (
              <PositionRow key={position.id} position={position} />
            ))}
            {open.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>No open option positions in the imported account.</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
      )}
    </Stack>
  );
}

function PositionSummary({ position }: { position: PortfolioPosition }) {
  const today = localDateIso();
  const days = position.expiration ? calendarDaysUntil(position.expiration, today) : null;
  const role = position.direction === 'short' ? 'Short call' : 'Long call';
  return (
    <Stack spacing={0.4} sx={{ py: 0.75 }}>
      <Typography variant="body1" sx={{ fontWeight: 750 }}>{position.underlying} · {role}</Typography>
      <Typography variant="body2">Strike {position.strike ? `$${position.strike}` : '—'} · {position.expiration ? formatDate(position.expiration) : 'No expiration'}</Typography>
      <Typography variant="body2">{days == null ? 'Days from today unavailable' : `${days} days from today`}</Typography>
      <Typography variant="body2">Mark {position.marketValue ? `$${Number(position.marketValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'Unavailable'}</Typography>
      <Typography variant="body2" color={position.quoteFreshness === 'fresh' ? 'text.primary' : 'warning.main'}>
        {position.unrealized == null ? 'Unrealized P/L unavailable' : `Unrealized ${position.unrealized}`} · {position.quoteFreshness.replaceAll('_', ' ')}
      </Typography>
      <Button component={RouterLink} to={`/positions/${encodeURIComponent(position.id)}`} size="small" aria-label={`View details ${position.symbol}`} sx={{ alignSelf: 'flex-start' }}>
        View details
      </Button>
    </Stack>
  );
}

function GroupRows({
  underlying,
  long,
  short,
  closedShort,
}: {
  underlying: string;
  long: PortfolioPosition | null;
  short: PortfolioPosition | null;
  closedShort: boolean;
}) {
  return (
    <>
      <TableRow>
        <TableCell colSpan={7} sx={{ fontWeight: 750, bgcolor: 'action.hover' }}>
          {underlying} — Poor Man&apos;s Covered Call
          {closedShort ? ' · confirmed short call is closed and is not an open leg' : ''}
        </TableCell>
      </TableRow>
      {long ? <PositionRow position={long} /> : null}
      {short ? <PositionRow position={short} /> : null}
    </>
  );
}

function PositionRow({ position }: { position: PortfolioPosition }) {
  const role = position.direction === 'short' ? 'Short call' : position.direction === 'long' ? 'Long call' : position.direction;
  const fresh = position.quoteFreshness === 'fresh';
  return (
    <TableRow hover>
      <TableCell>
        <Typography variant="body1" sx={{ fontWeight: 750 }}>{position.underlying}</Typography>
        <Typography variant="body2" color="text.secondary">{role}</Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body1">{position.expiration ? formatDate(position.expiration) : '—'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {position.expiration ? `${calendarDaysUntil(position.expiration, localDateIso()) ?? '—'} days from today` : 'Days from today unavailable'}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body1">{position.strike ? `$${position.strike}` : '—'}</Typography>
      </TableCell>
      <TableCell align="right">{position.marketValue ? `$${Number(position.marketValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'Unavailable'}</TableCell>
      <TableCell align="right" sx={{ color: fresh && position.unrealized ? undefined : 'warning.main' }}>
        {position.unrealized == null ? 'Unavailable' : `$${Number(position.unrealized).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
        {!fresh && position.unrealized != null ? (
          <Typography variant="caption" display="block">Not a current quote</Typography>
        ) : null}
      </TableCell>
      <TableCell>{position.quoteFreshness.replaceAll('_', ' ')}</TableCell>
      <TableCell>
        <Button component={RouterLink} to={`/positions/${encodeURIComponent(position.id)}`} size="small" aria-label={`View details ${position.symbol}`}>
          View details
        </Button>
      </TableCell>
    </TableRow>
  );
}

function HelpLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip title={tip} arrow>
      <Box component="span" sx={{ borderBottom: '1px dotted', cursor: 'help' }}>{label}</Box>
    </Tooltip>
  );
}

import {
  buildPlanFitSummary,
  formatContractDisplay,
  formatDelta,
  formatPercentMetric,
  formatUsd,
  type FinderCandidate,
  type StrategyProfile,
} from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import { PlanFitScoreBadge } from './PlanFitScoreBadge';

export type DiscoverListSortKey =
  | 'ticker'
  | 'cost'
  | 'delta'
  | 'intrinsic'
  | 'dte'
  | 'spread'
  | 'eligibility'
  | 'checks'
  | 'freshness';

export function DiscoverResultsList({
  candidates,
  profile,
  selectedIds,
  compareDisabled,
  hiddenIds,
  sortKey,
  sortDir,
  onSort,
  onToggleCompare,
  onReview,
  onSave,
}: {
  candidates: FinderCandidate[];
  profile: StrategyProfile;
  selectedIds: string[];
  compareDisabled: boolean;
  hiddenIds: ReadonlySet<string>;
  sortKey: DiscoverListSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: DiscoverListSortKey) => void;
  onToggleCompare: (id: string, checked: boolean) => void;
  onReview: (id: string) => void;
  onSave: (candidate: FinderCandidate) => void;
}) {
  return (
    <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">Compare</TableCell>
            <SortHeader label="Ticker" active={sortKey === 'ticker'} dir={sortDir} onClick={() => onSort('ticker')} />
            <TableCell>Contract</TableCell>
            <SortHeader label="Cost" active={sortKey === 'cost'} dir={sortDir} onClick={() => onSort('cost')} />
            <SortHeader label="Delta" active={sortKey === 'delta'} dir={sortDir} onClick={() => onSort('delta')} />
            <SortHeader
              label="Intrinsic %"
              active={sortKey === 'intrinsic'}
              dir={sortDir}
              onClick={() => onSort('intrinsic')}
            />
            <SortHeader label="DTE" active={sortKey === 'dte'} dir={sortDir} onClick={() => onSort('dte')} />
            <SortHeader label="Spread" active={sortKey === 'spread'} dir={sortDir} onClick={() => onSort('spread')} />
            <SortHeader
              label="Eligibility"
              active={sortKey === 'eligibility'}
              dir={sortDir}
              onClick={() => onSort('eligibility')}
            />
            <SortHeader label="Checks" active={sortKey === 'checks'} dir={sortDir} onClick={() => onSort('checks')} />
            <SortHeader
              label="Data"
              active={sortKey === 'freshness'}
              dir={sortDir}
              onClick={() => onSort('freshness')}
            />
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {candidates.map((candidate) => {
            const fit = buildPlanFitSummary(candidate, profile);
            const selected = selectedIds.includes(candidate.id);
            const hidden = hiddenIds.has(candidate.id);
            return (
              <TableRow key={candidate.id} hover selected={selected} sx={{ opacity: hidden ? 0.65 : 1 }}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selected}
                    disabled={!selected && compareDisabled}
                    onChange={(event) => onToggleCompare(candidate.id, event.target.checked)}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {candidate.underlying}
                  </Typography>
                  {hidden ? (
                    <Typography variant="caption" color="warning.main">
                      Hidden by filters
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {formatContractDisplay({
                      underlying: candidate.underlying,
                      strike: candidate.strike,
                      optionType: candidate.optionType,
                      expiration: candidate.expiration,
                    })}
                  </Typography>
                </TableCell>
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(candidate.calculations.estimatedPurchaseCost)}
                </TableCell>
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {candidate.greekVerification === 'aligned' ? formatDelta(candidate.delta) : '—'}
                </TableCell>
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercentMetric(candidate.calculations.intrinsicPercent)}
                </TableCell>
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {candidate.calculations.daysToExpiration ?? '—'}
                </TableCell>
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercentMetric(candidate.calculations.bidAskSpreadPercent)}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={fit.eligibility === 'eligible' ? 'Eligible' : fit.eligibilityLabel}
                    color={
                      fit.eligibility === 'eligible'
                        ? 'success'
                        : fit.eligibility === 'cannot-verify'
                          ? 'warning'
                          : 'error'
                    }
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PlanFitScoreBadge fit={fit} size="list" showEligibility={false} dense />
                  </Box>
                </TableCell>
                <TableCell>{fit.dataConfidenceLabel}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => onReview(candidate.id)}>
                      Analyze
                    </Button>
                    <Button size="small" onClick={() => onSave(candidate)}>
                      Save
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <TableCell sortDirection={active ? dir : false}>
      <TableSortLabel active={active} direction={active ? dir : 'asc'} onClick={onClick}>
        {label}
      </TableSortLabel>
    </TableCell>
  );
}

import { useMemo, useState, type ReactNode } from 'react';
import {
  COMPARISON_PRIORITY_LABELS,
  assignRankingBadges,
  buildComparisonSummary,
  buildPlanFitSummary,
  buildPremiumBreakdown,
  buildStrategyFitRows,
  comparisonLeaders,
  explainContractTradeoff,
  formatContractDisplay,
  formatDelta,
  formatPercentMetric,
  formatUsd,
  quoteStatusCopy,
  rankCandidatesForBeginner,
  sortCandidatesByPriority,
  type ComparisonPriority,
  type FinderCandidate,
  type StrategyProfile,
} from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

function title(candidate: FinderCandidate): string {
  return formatContractDisplay({
    underlying: candidate.underlying,
    strike: candidate.strike,
    optionType: candidate.optionType,
    expiration: candidate.expiration,
  });
}

function MetricBar({ value, max, color }: { value: number | null; max: number; color: string }) {
  if (value == null || max <= 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );
  }
  const pct = Math.max(4, Math.min(100, (value / max) * 100));
  return (
    <Box sx={{ width: '100%', bgcolor: 'action.hover', borderRadius: 0.5, height: 8 }}>
      <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: color, borderRadius: 0.5 }} />
    </Box>
  );
}

export function ContractComparisonPanel({
  candidates,
  profile,
  beginnerMode,
}: {
  candidates: FinderCandidate[];
  profile: StrategyProfile;
  beginnerMode: boolean;
}) {
  const [priority, setPriority] = useState<ComparisonPriority>('lowest-cost');
  const limited = candidates.slice(0, 4);
  const ordered = useMemo(
    () =>
      beginnerMode
        ? rankCandidatesForBeginner(limited, profile)
        : sortCandidatesByPriority(limited, priority),
    [limited, priority, beginnerMode, profile],
  );
  const leaders = useMemo(() => comparisonLeaders(ordered), [ordered]);
  const summary = useMemo(() => buildComparisonSummary(ordered), [ordered]);
  const leaderByMetric = useMemo(() => new Map(leaders.map((row) => [row.metric, row])), [leaders]);
  const planFits = useMemo(
    () => new Map(ordered.map((row) => [row.id, buildPlanFitSummary(row, profile)])),
    [ordered, profile],
  );
  const rankingBadges = useMemo(() => assignRankingBadges(ordered, profile), [ordered, profile]);
  const rankingExplanation = useMemo(() => {
    if (!beginnerMode || ordered.length < 2) return null;
    const top = ordered[0];
    const second = ordered[1];
    if (!top || !second) return null;
    const tradeoff = explainContractTradeoff(top, second, profile);
    const badges = rankingBadges.get(top.id) ?? [];
    const badgeText = badges.length ? ` Factual labels: ${badges.join(', ')}.` : '';
    return `Matches to My Strategy groups these evaluated contracts by eligibility; within a group they are ordered by a factual metric (default: lowest cost). ${tradeoff}${badgeText} Labels apply only to this evaluated set — not the full option chain.`;
  }, [beginnerMode, ordered, profile, rankingBadges]);

  const costs = ordered.map((row) => Number(row.calculations.estimatedPurchaseCost)).filter((n) => Number.isFinite(n));
  const maxCost = costs.length ? Math.max(...costs) : 1;
  const deltas = ordered.map((row) => Number(row.delta)).filter((n) => Number.isFinite(n));
  const maxDelta = deltas.length ? Math.max(...deltas) : 1;
  const intrinsics = ordered.map((row) => Number(row.calculations.intrinsicPercent)).filter((n) => Number.isFinite(n));
  const maxIntrinsic = intrinsics.length ? Math.max(...intrinsics) : 1;

  if (limited.length < 2) {
    return <Alert severity="info">Select 2–4 contracts with the Compare checkbox to open this view.</Alert>;
  }

  const ideal = Number(profile.preferences.idealContractCost);

  return (
    <Stack spacing={2}>
      <Typography variant="h6">Side-by-side comparison</Typography>
      <Typography variant="body2" color="text.secondary">
        Factual metric differences only — not buy recommendations. Missing values never win leadership badges.
      </Typography>
      <Alert severity="info" icon={false}>
        {summary}
      </Alert>
      {rankingExplanation ? (
        <Alert severity="success" icon={false}>
          {rankingExplanation}
        </Alert>
      ) : null}
      {!beginnerMode ? (
        <TextField
          select
          size="small"
          label="Prioritize metric"
          value={priority}
          onChange={(event) => setPriority(event.target.value as ComparisonPriority)}
          sx={{ maxWidth: 320 }}
        >
          {(Object.keys(COMPARISON_PRIORITY_LABELS) as ComparisonPriority[]).map((key) => (
            <MenuItem key={key} value={key}>
              {COMPARISON_PRIORITY_LABELS[key]}
            </MenuItem>
          ))}
        </TextField>
      ) : null}

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Metric</TableCell>
              {ordered.map((candidate) => {
                const fit = planFits.get(candidate.id);
                const badges = rankingBadges.get(candidate.id) ?? [];
                return (
                  <TableCell key={candidate.id} sx={{ minWidth: 160 }}>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {title(candidate)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {beginnerMode && fit ? fit.beginnerOutcomeLabel : candidate.label}
                    </Typography>
                    {badges.length > 0 ? (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {badges.map((badge) => (
                          <Chip key={badge} size="small" variant="outlined" color="primary" label={badge} />
                        ))}
                      </Stack>
                    ) : null}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            <CompareRow
              label="Eligibility / group"
              cells={ordered.map((c) => {
                const fit = planFits.get(c.id);
                return {
                  id: c.id,
                  text: fit ? `${fit.eligibilityLabel} · ${fit.matchGroupLabel}` : '—',
                };
              })}
            />
            <CompareRow
              label="Core Plan Fit checklist"
              cells={ordered.map((c) => {
                const fit = planFits.get(c.id);
                return {
                  id: c.id,
                  text: fit
                    ? `${fit.scoreLabel} (P${fit.ringSegments.passed}/F${fit.ringSegments.failed}/N${fit.ringSegments.notAssessed}) — checklist only`
                    : '—',
                };
              })}
            />
            <CompareRow
              label="Hard / preferences"
              cells={ordered.map((c) => {
                const fit = planFits.get(c.id);
                return {
                  id: c.id,
                  text: fit ? `${fit.hardLabel} · ${fit.preferenceLabel}` : '—',
                };
              })}
            />
            <CompareRow
              label="Preference magnitudes"
              cells={ordered.map((c) => {
                const fit = planFits.get(c.id);
                if (!fit) return { id: c.id, text: '—' };
                const misses = fit.preferenceDeviations.filter((d) => d.status === 'missed');
                if (misses.length === 0) return { id: c.id, text: 'All assessed preferences met' };
                return { id: c.id, text: misses.map((d) => d.magnitudeLabel).join(' ') };
              })}
            />
            <CompareRow
              label="Data Confidence"
              cells={ordered.map((c) => {
                const fit = planFits.get(c.id);
                return { id: c.id, text: fit?.dataConfidenceLabel ?? '—' };
              })}
            />
            <CompareRow
              label="Execution Quality"
              cells={ordered.map((c) => {
                const fit = planFits.get(c.id);
                return { id: c.id, text: fit?.executionQualityLabel ?? '—' };
              })}
            />
            <CompareRow
              label="Estimated purchase cost"
              leaderMetric="purchaseCost"
              leaderByMetric={leaderByMetric}
              cells={ordered.map((c) => ({
                id: c.id,
                text: formatUsd(c.calculations.estimatedPurchaseCost),
                bar: (
                  <MetricBar
                    value={c.calculations.estimatedPurchaseCost != null ? Number(c.calculations.estimatedPurchaseCost) : null}
                    max={maxCost}
                    color="primary.main"
                  />
                ),
              }))}
            />
            <CompareRow
              label="vs ideal budget"
              cells={ordered.map((c) => {
                const cost = Number(c.calculations.estimatedPurchaseCost);
                if (!Number.isFinite(cost) || !Number.isFinite(ideal)) return { id: c.id, text: '—' };
                const diff = cost - ideal;
                return {
                  id: c.id,
                  text: diff === 0 ? 'At ideal' : diff > 0 ? `$${diff.toLocaleString('en-US')} above ideal` : `$${Math.abs(diff).toLocaleString('en-US')} below ideal`,
                };
              })}
            />
            <CompareRow
              label="Delta"
              leaderMetric="delta"
              leaderByMetric={leaderByMetric}
              cells={ordered.map((c) => ({
                id: c.id,
                text: formatDelta(c.delta),
                bar: <MetricBar value={c.delta != null ? Number(c.delta) : null} max={maxDelta} color="secondary.main" />,
              }))}
            />
            <CompareRow
              label="Intrinsic %"
              leaderMetric="intrinsicPercent"
              leaderByMetric={leaderByMetric}
              cells={ordered.map((c) => ({
                id: c.id,
                text: formatPercentMetric(c.calculations.intrinsicPercent),
                bar: (
                  <MetricBar
                    value={c.calculations.intrinsicPercent != null ? Number(c.calculations.intrinsicPercent) : null}
                    max={maxIntrinsic}
                    color="success.main"
                  />
                ),
              }))}
            />
            <CompareRow
              label="Extrinsic premium ($ / share)"
              leaderMetric="extrinsicValue"
              leaderByMetric={leaderByMetric}
              cells={ordered.map((c) => ({ id: c.id, text: formatUsd(c.calculations.extrinsicValue) }))}
            />
            <CompareRow
              label="Extrinsic ($ / contract)"
              cells={ordered.map((c) => {
                const breakdown = buildPremiumBreakdown(c);
                return { id: c.id, text: formatUsd(breakdown.extrinsicPerContract) };
              })}
            />
            <CompareRow
              label="Days to expiration"
              leaderMetric="dte"
              leaderByMetric={leaderByMetric}
              cells={ordered.map((c) => ({
                id: c.id,
                text: c.calculations.daysToExpiration != null ? String(c.calculations.daysToExpiration) : '—',
              }))}
            />
            <CompareRow
              label="Spread $ / %"
              leaderMetric="bidAskSpread"
              leaderByMetric={leaderByMetric}
              cells={ordered.map((c) => ({
                id: c.id,
                text:
                  c.calculations.bidAskSpreadDollars == null
                    ? '—'
                    : `${formatUsd(c.calculations.bidAskSpreadDollars)} · ${formatPercentMetric(c.calculations.bidAskSpreadPercent)}`,
              }))}
            />
            <CompareRow
              label="Expiration break-even"
              cells={ordered.map((c) => ({ id: c.id, text: formatUsd(c.calculations.expirationBreakEven) }))}
            />
            <CompareRow
              label="Downside moneyness 15%"
              cells={ordered.map((c) => ({
                id: c.id,
                text: formatPercentMetric(c.calculations.downsideMoneyness15),
              }))}
            />
            <CompareRow
              label="Liquidity (OI / volume)"
              cells={ordered.map((c) => ({
                id: c.id,
                text:
                  c.openInterest == null && c.volume == null
                    ? 'Unassessed'
                    : `${c.openInterest ?? '—'} / ${c.volume ?? '—'}`,
              }))}
            />
            <CompareRow
              label="Strategy requirements"
              cells={ordered.map((c) => {
                const rows = buildStrategyFitRows(c, profile);
                const pass = rows.filter((r) => r.status === 'pass').length;
                const miss = rows.filter((r) => r.status === 'preferred-miss' || r.status === 'hard-fail').length;
                const na = rows.filter((r) => r.status === 'not-assessed').length;
                return { id: c.id, text: `${pass} pass · ${miss} miss · ${na} not assessed` };
              })}
            />
            <CompareRow
              label="Data quality / freshness"
              cells={ordered.map((c) => ({
                id: c.id,
                text: `${c.dataQuality} · ${quoteStatusCopy(c).label}`,
              }))}
            />
            {!beginnerMode
              ? [
                  <CompareRow
                    key="occ"
                    label="OCC symbol"
                    cells={ordered.map((c) => ({ id: c.id, text: c.occSymbol.trim() }))}
                  />,
                ]
              : null}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}

function CompareRow({
  label,
  cells,
  leaderMetric,
  leaderByMetric,
}: {
  label: string;
  cells: Array<{ id: string; text: string; bar?: ReactNode }>;
  leaderMetric?: string;
  leaderByMetric?: Map<string, { leaderId: string; badge: string }>;
}) {
  const leader = leaderMetric && leaderByMetric ? leaderByMetric.get(leaderMetric) : undefined;
  return (
    <TableRow>
      <TableCell sx={{ fontWeight: 550 }}>{label}</TableCell>
      {cells.map((cell) => (
        <TableCell key={cell.id} sx={{ fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' }}>
          <Typography variant="body2">{cell.text}</Typography>
          {cell.bar ? <Box sx={{ mt: 0.5 }}>{cell.bar}</Box> : null}
          {leader && leader.leaderId === cell.id ? (
            <Typography variant="caption" color="primary.main" display="block" sx={{ mt: 0.25 }}>
              {leader.badge}
            </Typography>
          ) : null}
        </TableCell>
      ))}
    </TableRow>
  );
}

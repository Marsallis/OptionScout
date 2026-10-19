import { useMemo, useState } from 'react';
import {
  beginnerDiscoveryGroup,
  BEGINNER_DISCOVERY_GROUP_LABELS,
  bidAskSpreadWarning,
  buildPlanFitSummary,
  formatContractDisplay,
  formatDelta,
  formatObservationDate,
  observationFreshnessLabel,
  formatPercentMetric,
  formatUsd,
  type FinderCandidate,
  type PlanFitRankingBadge,
  type StrategyProfile,
} from '@optionscout/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PlanFitScoreBadge } from './PlanFitScoreBadge';
import { PreferenceTargetRows } from './PreferenceTargetRows';

function biggestFactualDrawback(fit: NonNullable<ReturnType<typeof buildPlanFitSummary>>): string | null {
  if (fit.invalidMarketData) return 'The quote failed a validity check, so strategy fit is not confirmed.';
  if (fit.eligibility === 'not-eligible') {
    const hard = fit.eligibilityHardChecks.find((c) => c.result === 'failed');
    return hard
      ? `Hard rule miss: ${hard.requirement} (${hard.thisContract} vs ${hard.yourTarget})`
      : 'Fails a configured hard requirement.';
  }
  if (fit.eligibility === 'cannot-verify') {
    return 'Cannot verify eligibility — required hard measurement missing or incompatible.';
  }
  const miss = fit.preferenceDeviations.find((d) => d.status === 'missed');
  return miss?.magnitudeLabel ?? null;
}

export function CandidateResultCard({
  candidate,
  selected,
  onToggleCompare,
  onReview,
  onSave,
  compareDisabled,
  companyName,
  showValidationDetails = false,
  profile,
  badges = [],
  beginnerMode = false,
  hiddenByFilter = false,
}: {
  candidate: FinderCandidate;
  selected: boolean;
  onToggleCompare: (checked: boolean) => void;
  onReview: () => void;
  onSave: () => void;
  compareDisabled?: boolean;
  companyName?: string | null;
  showValidationDetails?: boolean;
  profile?: StrategyProfile;
  badges?: PlanFitRankingBadge[];
  beginnerMode?: boolean;
  /** Selected for compare but outside current result filters. */
  hiddenByFilter?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fit = useMemo(
    () => (profile ? buildPlanFitSummary(candidate, profile) : null),
    [candidate, profile],
  );
  const title = formatContractDisplay({
    underlying: candidate.underlying,
    strike: candidate.strike,
    optionType: candidate.optionType,
    expiration: candidate.expiration,
  });
  const deltaLabel =
    candidate.greekVerification === 'aligned'
      ? formatDelta(candidate.delta)
      : candidate.delta != null
        ? `${formatDelta(candidate.delta)} (historical)`
        : 'Not verified';
  const spread =
    candidate.calculations.bidAskSpreadPercent != null
      ? formatPercentMetric(candidate.calculations.bidAskSpreadPercent)
      : candidate.calculations.bidAskSpreadDollars != null
        ? formatUsd(candidate.calculations.bidAskSpreadDollars)
        : '—';
  const drawback = fit ? biggestFactualDrawback(fit) : null;
  const spreadWarning = bidAskSpreadWarning({
    bidAskSpreadPercent: candidate.calculations.bidAskSpreadPercent,
    crossedMarket: candidate.flags.crossedMarket,
    invalidPrice: candidate.flags.invalidPrice,
  });
  const freshnessWarning =
    candidate.observationFreshness === 'current-session'
      ? null
      : `Quote freshness: ${observationFreshnessLabel(candidate.observationFreshness)}.`;
  const conciseVerdict = fit
    ? fit.eligibility === 'eligible' && !drawback
      ? 'Meets hard rules and assessed preferences.'
      : fit.eligibility === 'eligible' && drawback
        ? `Eligible — ${drawback}`
        : fit.verdictLine.split('.')[0] + '.'
    : null;

  return (
    <Paper
      className="os-result-card"
      data-selected={selected ? 'true' : 'false'}
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        opacity: hiddenByFilter ? 0.72 : 1,
        borderStyle: hiddenByFilter ? 'dashed' : 'solid',
      }}
    >
      <Stack spacing={1.25} sx={{ height: '100%' }}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                {companyName ? `${candidate.underlying} · ${companyName}` : candidate.underlying}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--os-font-mono)' }}>
                {title}
              </Typography>
            </Box>
            {fit ? (
              <Chip
                size="small"
                label={BEGINNER_DISCOVERY_GROUP_LABELS[beginnerDiscoveryGroup(fit)]}
                color={
                  fit.eligibility === 'eligible' ? 'success' : fit.eligibility === 'cannot-verify' ? 'warning' : 'error'
                }
                variant="outlined"
              />
            ) : (
              <Chip size="small" label={candidate.label} variant="outlined" />
            )}
          </Stack>
          {hiddenByFilter ? (
            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5, fontWeight: 600 }}>
              Hidden by current filters — still selected for compare
            </Typography>
          ) : null}
          {badges.length > 0 && !beginnerMode ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
              {badges.slice(0, 2).map((badge) => (
                <Chip key={badge} size="small" color="primary" variant="outlined" label={badge} />
              ))}
            </Stack>
          ) : null}
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums', my: 0.25 }}>
          {formatUsd(candidate.calculations.estimatedPurchaseCost)}
        </Typography>

        {fit ? (
          <PlanFitScoreBadge fit={fit} size={beginnerMode ? 'gallery' : 'compact'} showEligibility={false} />
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            columnGap: 1.5,
            rowGap: 0.65,
          }}
        >
          <Metric label="Delta" value={deltaLabel} />
          <Metric label="Intrinsic %" value={formatPercentMetric(candidate.calculations.intrinsicPercent)} />
          <Metric
            label="DTE"
            value={candidate.calculations.daysToExpiration != null ? `${candidate.calculations.daysToExpiration}` : '—'}
          />
          <Metric label="Spread" value={spread} />
          <Metric label="Data" value={fit?.dataConfidenceLabel ?? formatObservationDate(candidate)} />
          <Metric label="Execution" value={fit?.executionQualityLabel ?? '—'} />
        </Box>

        {conciseVerdict ? (
          <Typography variant="body2" sx={{ lineHeight: 1.4, fontWeight: 600 }}>
            {conciseVerdict}
          </Typography>
        ) : null}
        {spreadWarning ? (
          <Typography variant="body2" color="warning.main" sx={{ fontWeight: 650 }}>
            {spreadWarning}
          </Typography>
        ) : null}
        {freshnessWarning ? (
          <Typography variant="body2" color="warning.main">
            {freshnessWarning}
          </Typography>
        ) : null}
        {beginnerMode && drawback && fit?.eligibility === 'eligible' ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Biggest factual gap: {drawback}
          </Typography>
        ) : null}

        {beginnerMode && fit ? (
          <>
            <Button size="small" onClick={() => setDetailsOpen((open) => !open)} sx={{ alignSelf: 'flex-start' }}>
              {detailsOpen ? 'Hide details' : 'Why this fits / What it misses'}
            </Button>
            <Collapse in={detailsOpen}>
              <Stack spacing={1} sx={{ pt: 0.5 }}>
                <PreferenceTargetRows deviations={fit.preferenceDeviations} />
                <Typography variant="caption" color="text.secondary">
                  {fit.rankingScopeNote}
                </Typography>
              </Stack>
            </Collapse>
          </>
        ) : null}

        {showValidationDetails && (candidate.validationIssues?.length ?? 0) > 0 ? (
          <Stack spacing={0.5}>
            {candidate.validationIssues.map((issue) => (
              <Typography key={`${issue.code}-${issue.message}`} variant="caption" color="text.secondary" component="div">
                [{issue.severity}] {issue.code}: {issue.message}
              </Typography>
            ))}
          </Stack>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ mt: 'auto', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
          <Button size="small" variant="contained" onClick={onReview}>
            View Analysis
          </Button>
          <Button size="small" onClick={onSave}>
            Save
          </Button>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={selected}
                disabled={!selected && compareDisabled}
                onChange={(event) => onToggleCompare(event.target.checked)}
              />
            }
            label="Compare"
          />
        </Stack>
      </Stack>
    </Paper>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.1}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
        {value}
      </Typography>
    </Stack>
  );
}

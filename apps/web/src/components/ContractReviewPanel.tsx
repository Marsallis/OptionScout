import { useMemo, useState, type ReactNode } from 'react';
import {
  buildBeginnerContractSummary,
  buildLeapsPlainSummary,
  buildPlanFitSummary,
  buildPremiumBreakdown,
  buildStrategyFitRows,
  expirationPayoffScenarios,
  formatContractDisplay,
  formatDelta,
  formatPercentMetric,
  formatUsd,
  greekVerificationLabel,
  isUnverifiedOrIncompleteCandidate,
  isVerifiedConfiguredMatch,
  observationFreshnessLabel,
  quoteStatusCopy,
  type FinderCandidate,
  type StrategyFitStatus,
  type StrategyProfile,
} from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { GlossaryTip } from './GlossaryTip';
import { PlanFitScoreBadge } from './PlanFitScoreBadge';
import { PmccExplainer } from './PmccExplainer';
import { PreferenceTargetRows } from './PreferenceTargetRows';

function fitChipColor(status: StrategyFitStatus): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'pass') return 'success';
  if (status === 'preferred-miss') return 'warning';
  if (status === 'hard-fail') return 'error';
  return 'default';
}

function fitLabel(status: StrategyFitStatus): string {
  if (status === 'pass') return 'Pass';
  if (status === 'preferred-miss') return 'Preferred target missed';
  if (status === 'hard-fail') return 'Hard requirement failed';
  return 'Not assessed';
}

function contractHeading(candidate: FinderCandidate): string {
  return formatContractDisplay({
    underlying: candidate.underlying,
    strike: candidate.strike,
    optionType: candidate.optionType,
    expiration: candidate.expiration,
  });
}

export function ContractReviewPanel({
  candidate,
  profile,
  beginnerMode,
  onClose,
}: {
  candidate: FinderCandidate;
  profile: StrategyProfile;
  beginnerMode: boolean;
  onClose?: () => void;
}) {
  const [showFormulas, setShowFormulas] = useState(!beginnerMode);
  const [showPayoffChart, setShowPayoffChart] = useState(true);
  const breakdown = useMemo(() => buildPremiumBreakdown(candidate), [candidate]);
  const fitRows = useMemo(() => buildStrategyFitRows(candidate, profile), [candidate, profile]);
  const planFit = useMemo(() => buildPlanFitSummary(candidate, profile), [candidate, profile]);
  const beginnerSummary = useMemo(() => buildBeginnerContractSummary(candidate, profile), [candidate, profile]);
  const payoffs = useMemo(() => expirationPayoffScenarios(candidate), [candidate]);
  const quoteStatus = useMemo(() => quoteStatusCopy(candidate), [candidate]);
  const plain = useMemo(() => buildLeapsPlainSummary(candidate), [candidate]);
  const intrinsicShare = breakdown.intrinsicShareOfPremium ?? 0;
  const extrinsicShare = breakdown.extrinsicShareOfPremium ?? 0;
  const spreadPerShare = candidate.calculations.bidAskSpreadDollars;
  const spreadPerContract =
    spreadPerShare != null && Number.isFinite(Number(spreadPerShare))
      ? (Number(spreadPerShare) * candidate.multiplier).toFixed(2)
      : null;
  const profitValues = payoffs.map((row) => Number(row.profitPerContract));
  const minProfit = profitValues.length ? Math.min(...profitValues) : 0;
  const maxProfit = profitValues.length ? Math.max(...profitValues) : 0;
  const range = Math.max(Math.abs(minProfit), Math.abs(maxProfit), 1);
  const verified = isVerifiedConfiguredMatch(candidate);
  const unverified = isUnverifiedOrIncompleteCandidate(candidate);

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1, alignItems: { sm: 'flex-start' } }}>
        <Box>
          <Typography variant="h5" component="h2">
            Review contract
          </Typography>
          <Typography variant="h6" sx={{ mt: 0.5 }}>
            {contractHeading(candidate)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Strategy: {profile.name} · revision {profile.revision}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Hard: max cost ${Number(profile.hard.maxContractCost).toLocaleString('en-US')}, min DTE {profile.hard.minExpirationDays}, min
            delta {profile.hard.minLongDelta}. Preferences: preferred delta {profile.preferences.preferredLongDelta}, intrinsic{' '}
            {profile.preferences.minIntrinsicPercent}%.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Chip size="small" label={candidate.label} />
          {verified ? <Chip size="small" color="success" variant="outlined" label="Verified match" /> : null}
          {unverified && !verified ? (
            <Chip size="small" color="warning" variant="outlined" label="Unverified / incomplete" />
          ) : null}
          <Chip size="small" label={observationFreshnessLabel(candidate.observationFreshness)} variant="outlined" />
          <Chip
            size="small"
            label={greekVerificationLabel(candidate.greekVerification)}
            variant="outlined"
            color={candidate.greekVerification === 'aligned' ? 'default' : 'warning'}
          />
          {candidate.flags.fromCache ? <Chip size="small" label="Cached observation" variant="outlined" /> : null}
          <Chip size="small" label={quoteStatus.label} variant="outlined" />
          {onClose ? (
            <Button size="small" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </Stack>
      </Stack>

      <Alert severity="warning" icon={false}>
        A long <GlossaryTip term="leaps">LEAPS</GlossaryTip> call can lose its entire purchase premium, even when it starts with substantial{' '}
        <GlossaryTip term="intrinsic">intrinsic value</GlossaryTip>. Matching your strategy rules is not a buy recommendation.
      </Alert>

      <Alert severity="info" icon={false}>
        Observation freshness: {observationFreshnessLabel(candidate.observationFreshness)}. Greek verification:{' '}
        {greekVerificationLabel(candidate.greekVerification)}. {quoteStatus.detail}
      </Alert>

      {!beginnerMode && (candidate.validationIssues?.length ?? 0) > 0 ? (
        <Section title="Validation issues (Advanced)">
          <Stack spacing={0.75}>
            {candidate.validationIssues.map((issue) => (
              <Box key={`${issue.code}-${issue.severity}-${issue.message}`}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  [{issue.severity}] {issue.code}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {issue.message}
                </Typography>
                {issue.details ? (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ fontFamily: 'monospace' }}>
                    {Object.entries(issue.details)
                      .filter(([, value]) => value != null && value !== '')
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(' · ')}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        </Section>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 650, mb: 1 }}>
          Beginner Summary
        </Typography>
        <Stack spacing={1.25}>
          <PlanFitScoreBadge fit={planFit} />
          <Typography variant="body2" color="text.secondary">
            {planFit.matchGroupLabel}
          </Typography>
          {planFit.eligibility === 'cannot-verify' ? (
            <Typography variant="body2" color="warning.main" sx={{ fontWeight: 650 }}>
              Cannot Verify Eligibility — required hard measurements are missing or incompatible (missing is not a pass or fail).
            </Typography>
          ) : null}
          {planFit.eligibility === 'not-eligible' ? (
            <Typography variant="body2" color="error.main" sx={{ fontWeight: 650 }}>
              Not Eligible Under My Strategy — at least one configured hard requirement failed.
            </Typography>
          ) : null}
          <Typography variant="body2">{beginnerSummary.whatItIs}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {planFit.verdictLine}
          </Typography>
          <PreferenceTargetRows deviations={planFit.preferenceDeviations} />
          <Typography variant="caption" color="text.secondary" display="block">
            {planFit.hardLabel} · {planFit.preferenceLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Data Confidence: {planFit.dataConfidenceLabel} · Execution Quality: {planFit.executionQualityLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {planFit.checklistDisclaimer}
          </Typography>
          {planFit.eligibilityHardChecks.filter((c) => !c.core).length > 0 ? (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.35 }}>
                Additional hard requirements (outside the six-check ring; count toward eligibility)
              </Typography>
              <Stack spacing={0.35} component="ul" sx={{ m: 0, pl: 2 }}>
                {planFit.eligibilityHardChecks
                  .filter((c) => !c.core)
                  .map((check) => (
                    <Typography key={check.id} variant="body2" component="li" color="text.secondary">
                      {check.requirement}: {check.result} — {check.thisContract} vs {check.yourTarget}
                    </Typography>
                  ))}
              </Stack>
            </Box>
          ) : null}
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.35 }}>
              Why it may fit
            </Typography>
            <Stack spacing={0.35} component="ul" sx={{ m: 0, pl: 2 }}>
              {beginnerSummary.whyMayFit.map((line) => (
                <Typography key={line} variant="body2" component="li">
                  {line}
                </Typography>
              ))}
            </Stack>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.35 }}>
              Cautions
            </Typography>
            <Stack spacing={0.35} component="ul" sx={{ m: 0, pl: 2 }}>
              {beginnerSummary.cautions.map((line) => (
                <Typography key={line} variant="body2" component="li" color="text.secondary">
                  {line}
                </Typography>
              ))}
            </Stack>
          </Box>
          {beginnerMode ? <PmccExplainer /> : null}
        </Stack>
      </Paper>

      {/* Section A */}
      <Section title="A — Understand this LEAPS">
        <Typography variant="body1">{plain}</Typography>
        <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1.5 }}>
          <Stat label="Stock price" value={formatUsd(candidate.underlyingPrice)} />
          <Stat label="Estimated purchase cost" value={formatUsd(candidate.calculations.estimatedPurchaseCost)} tip="premium" />
          <Stat label="Delta" value={formatDelta(candidate.delta)} tip="delta" />
          <Stat label="Intrinsic %" value={formatPercentMetric(candidate.calculations.intrinsicPercent)} tip="intrinsic" />
          <Stat
            label="Time remaining"
            value={candidate.calculations.daysToExpiration != null ? `${candidate.calculations.daysToExpiration} days` : '—'}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Data completeness and strategy fit are separate. Freshness and Greek verification gate whether delta rules can be assessed.
        </Typography>
      </Section>

      {/* Section B */}
      <Section title="B — Where your money goes">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Ask-based premium breakdown. Per-share figures × {candidate.multiplier} = per-contract figures.
        </Typography>
        <Stack spacing={0.75}>
          <MoneyLine label="Total option premium" perShare={breakdown.askPerShare} perContract={breakdown.costPerContract} />
          <MoneyLine label="Intrinsic value" perShare={breakdown.intrinsicPerShare} perContract={breakdown.intrinsicPerContract} tip="intrinsic" />
          <MoneyLine label="Extrinsic value" perShare={breakdown.extrinsicPerShare} perContract={breakdown.extrinsicPerContract} tip="extrinsic" />
        </Stack>
        {breakdown.intrinsicShareOfPremium != null ? (
          <Box sx={{ mt: 1.5 }}>
            <Box
              sx={{
                display: 'flex',
                height: 18,
                borderRadius: 1,
                overflow: 'hidden',
                bgcolor: 'action.hover',
              }}
            >
              <Box sx={{ width: `${intrinsicShare * 100}%`, bgcolor: 'primary.main' }} />
              <Box sx={{ width: `${extrinsicShare * 100}%`, bgcolor: 'warning.light' }} />
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
              About {((intrinsicShare || 0) * 100).toFixed(0)}% of the premium is intrinsic (in-the-money amount) and{' '}
              {((extrinsicShare || 0) * 100).toFixed(0)}% is extrinsic (time/volatility premium). Intrinsic is not protected money.
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
            Premium shares could not be drawn because ask or intrinsic inputs are incomplete.
          </Typography>
        )}
        <Typography variant="body2" sx={{ mt: 1 }}>
          For this strategy, a high intrinsic percentage usually means more of what you pay already reflects the stock being above the{' '}
          <GlossaryTip term="strike">strike</GlossaryTip>. Extrinsic can still decay even if the stock does not fall.
        </Typography>
      </Section>

      {/* Section C */}
      <Section title="C — How well does this match my strategy?">
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Requirement</TableCell>
                <TableCell>Your target</TableCell>
                <TableCell>This contract</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fitRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.requirement}</TableCell>
                  <TableCell>{row.yourTarget}</TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{row.thisContract}</TableCell>
                  <TableCell>
                    <Chip size="small" label={fitLabel(row.status)} color={fitChipColor(row.status)} variant={row.status === 'pass' ? 'filled' : 'outlined'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          {fitRows.map((row) => (
            <Typography key={`${row.id}-why`} variant="body2" color="text.secondary">
              {row.explanation}
            </Typography>
          ))}
        </Stack>
      </Section>

      {/* Section D */}
      <Section title="D — Understand the risks">
        <Stack spacing={0.75}>
          <Typography variant="body2">
            Total long-call premium at risk: <strong>{formatUsd(candidate.calculations.estimatedPurchaseCost)}</strong> (ask × multiplier,
            before fees).
          </Typography>
          <Typography variant="body2">
            Expiration <GlossaryTip term="breakeven">break-even</GlossaryTip> stock price:{' '}
            <strong>{formatUsd(candidate.calculations.expirationBreakEven)}</strong> (strike + ask per share).
          </Typography>
          <Typography variant="body2">
            Bid/ask friction (unchanged quotes): about {formatUsd(spreadPerContract)} per contract (
            {formatUsd(spreadPerShare)} per share). That is illustrative trading friction, not a realized loss from an actual order.
          </Typography>
        </Stack>
        <Alert severity="info" icon={false} sx={{ mt: 1.5 }}>
          Rows below are hypothetical expiration payoffs only — not pre-expiration model valuations. Pre-expiration pricing needs IV,
          rates, dividends, and exercise assumptions; those are not fabricated here.
        </Alert>
        {payoffs.length === 0 ? (
          <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
            Expiration scenarios need a valid stock price, strike, and ask.
          </Typography>
        ) : (
          <>
            <Button size="small" sx={{ mt: 1 }} onClick={() => setShowPayoffChart((value) => !value)}>
              {showPayoffChart ? 'Hide payoff chart' : 'Show payoff chart'}
            </Button>
            <Collapse in={showPayoffChart}>
              <Box sx={{ mt: 1.5, display: 'grid', gap: 0.75 }}>
                {payoffs.map((point) => {
                  const profit = Number(point.profitPerContract);
                  const width = Math.min(100, (Math.abs(profit) / range) * 50);
                  return (
                    <Stack key={point.label} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ width: 140, flexShrink: 0 }}>
                        {point.label}
                      </Typography>
                      <Box sx={{ flex: 1, position: 'relative', height: 14, bgcolor: 'action.hover', borderRadius: 0.5 }}>
                        <Box
                          sx={{
                            position: 'absolute',
                            left: '50%',
                            top: 0,
                            bottom: 0,
                            width: `${width}%`,
                            ml: profit >= 0 ? 0 : `-${width}%`,
                            bgcolor: profit >= 0 ? 'success.light' : 'error.light',
                            borderRadius: 0.5,
                          }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatUsd(point.profitPerContract)}
                      </Typography>
                    </Stack>
                  );
                })}
              </Box>
            </Collapse>
            <Box sx={{ overflowX: 'auto', mt: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Scenario</TableCell>
                    <TableCell align="right">Stock</TableCell>
                    <TableCell align="right">Call value / share</TableCell>
                    <TableCell align="right">P/L / contract</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payoffs.map((point) => (
                    <TableRow key={`t-${point.label}`}>
                      <TableCell>{point.label}</TableCell>
                      <TableCell align="right">{formatUsd(point.stockPrice)}</TableCell>
                      <TableCell align="right">{formatUsd(point.callValuePerShare)}</TableCell>
                      <TableCell align="right">{formatUsd(point.profitPerContract)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </Section>

      {/* Section E */}
      <Section title="E — Liquidity and execution">
        <Stack spacing={0.5}>
          <Typography variant="body2">
            Bid / ask: {formatUsd(candidate.bid)} / {formatUsd(candidate.ask)}
          </Typography>
          <Typography variant="body2">
            Spread: {formatUsd(spreadPerShare)} per share · {formatUsd(spreadPerContract)} per contract ·{' '}
            {formatPercentMetric(candidate.calculations.bidAskSpreadPercent)}
          </Typography>
          <Typography variant="body2">
            Bid/ask size: Unassessed · <GlossaryTip term="openInterest">Open interest</GlossaryTip>:{' '}
            {candidate.openInterest == null ? 'Unassessed' : candidate.openInterest} · Volume:{' '}
            {candidate.volume == null ? 'Unassessed' : candidate.volume}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Quote: {quoteStatus.label}. Provider event {candidate.providerEventAt ?? '—'} · Received {candidate.receivedAt ?? '—'} ·
            Session {candidate.marketSession}.
          </Typography>
        </Stack>
        {spreadPerContract != null ? (
          <Typography variant="body2" sx={{ mt: 1 }}>
            This contract has a ${Number(spreadPerContract).toLocaleString('en-US')} bid/ask difference per contract. Buying at the
            displayed ask and immediately selling at the displayed bid, with unchanged quotes, would imply approximately $
            {Number(spreadPerContract).toLocaleString('en-US')} of trading friction before fees. That is not a verified execution loss.
          </Typography>
        ) : null}
      </Section>

      {/* Section F */}
      <Section title="F — PMCC compatibility preview">
        <Alert severity="info" icon={false}>
          Short-call chain data for a live 7–21 DTE overlay is not available on this Finder path yet. OptionScout will not invent
          short-call credits, deltas, or assignment outcomes. A <GlossaryTip term="pmcc">PMCC</GlossaryTip> still carries{' '}
          <GlossaryTip term="assignment">assignment risk</GlossaryTip> on any short call you sell — the long LEAPS does not
          automatically eliminate uncovered short-call risk.
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          When short-call quotes are wired in a later step, this panel will list candidate expirations, strikes, estimated credits,
          strike distance above the stock and long-call break-even, and spread notes.
        </Typography>
        {candidate.pmccReason ? (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {candidate.pmccReason}
          </Typography>
        ) : null}
      </Section>

      <Divider />
      <Button size="small" onClick={() => setShowFormulas((value) => !value)}>
        {showFormulas ? 'Hide how numbers were calculated' : 'How this was calculated'}
      </Button>
      <Collapse in={showFormulas}>
        <Stack spacing={0.5}>
          {!beginnerMode ? (
            <Typography variant="caption" color="text.secondary">
              OCC {candidate.occSymbol.trim()} · ×{candidate.multiplier} · {candidate.calculations.quoteSourceLabel}
            </Typography>
          ) : null}
          <Typography variant="body2">Intrinsic / share = max(stock − strike, 0)</Typography>
          <Typography variant="body2">Extrinsic / share = ask − intrinsic</Typography>
          <Typography variant="body2">Intrinsic % = intrinsic / ask × 100</Typography>
          <Typography variant="body2">Contract cost = ask × multiplier</Typography>
          <Typography variant="body2">Expiration break-even = strike + ask</Typography>
          <Typography variant="body2">
            Greeks: Δ {formatDelta(candidate.delta)} · θ {formatDelta(candidate.theta)} · IV{' '}
            {candidate.impliedVolatility ?? '—'}
          </Typography>
        </Stack>
      </Collapse>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 650, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Stat({ label, value, tip }: { label: string; value: string; tip?: 'premium' | 'delta' | 'intrinsic' }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {tip ? <GlossaryTip term={tip}>{label}</GlossaryTip> : label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function MoneyLine({
  label,
  perShare,
  perContract,
  tip,
}: {
  label: string;
  perShare: string | null;
  perContract: string | null;
  tip?: 'intrinsic' | 'extrinsic';
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2">{tip ? <GlossaryTip term={tip}>{label}</GlossaryTip> : label}</Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(perShare)} / share · {formatUsd(perContract)} / contract
      </Typography>
    </Stack>
  );
}

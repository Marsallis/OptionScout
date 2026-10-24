import { useEffect, useMemo, useState } from 'react';
import {
  SAL_PMCC_DEEP_ITM,
  analyzePmcc,
  evaluatePmccRules,
  type DemoChainContract,
  type StrategyProfile,
} from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { createSavedIdea, fetchDemoChain, fetchSavedIdeas, fetchStrategyProfiles, type SavedIdea } from '../api/client';
import { DemoChip } from '../components/DemoChip';
import { formatUsd } from '../lib/format';
import { useAppState } from '../state/AppState';

function label(contract: DemoChainContract): string {
  return `${contract.expiration} ${contract.strike} call · ${contract.daysToExpiration}d · ask ${contract.ask}`;
}

function money(value: string | null): string {
  if (value == null) return 'Unavailable';
  const amount = Number(value);
  return Number.isFinite(amount) ? formatUsd(amount) : value;
}

export function PmccBuilderPage() {
  const { session } = useAppState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<DemoChainContract[]>([]);
  const [spot, setSpot] = useState('100.00');
  const [asOf, setAsOf] = useState('2026-10-15');
  const [longOcc, setLongOcc] = useState('');
  const [shortOcc, setShortOcc] = useState('');
  const [profile, setProfile] = useState<StrategyProfile>(SAL_PMCC_DEEP_ITM);
  const [ideas, setIdeas] = useState<SavedIdea[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchDemoChain(),
      fetchStrategyProfiles().catch(() => null),
      fetchSavedIdeas().catch(() => ({ ideas: [] as SavedIdea[] })),
    ])
      .then(([chain, profiles, saved]) => {
        if (cancelled) return;
        setContracts(chain.contracts);
        setSpot(chain.spot);
        setAsOf(chain.asOf);
        const leaps = chain.contracts.filter((contract) => contract.daysToExpiration >= 180);
        const shorts = chain.contracts.filter((contract) => contract.daysToExpiration > 0 && contract.daysToExpiration < 180);
        setLongOcc(leaps[0]?.occ ?? chain.contracts[0]?.occ ?? '');
        setShortOcc(shorts[0]?.occ ?? '');
        if (profiles && profiles.profiles.length > 0) {
          setProfile(profiles.profiles.find((row) => row.id === profiles.defaultProfileId) ?? profiles.profiles[0]!);
        }
        setIdeas(saved.ideas.filter((idea) => idea.shortOcc));
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'The simulated chain did not load.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.authenticated, session?.publicSimulatedDemo]);

  const long = contracts.find((contract) => contract.occ === longOcc) ?? null;
  const shortChoices = contracts.filter((contract) => !long || (contract.expiration < long.expiration && contract.occ !== long.occ));
  const short = shortChoices.find((contract) => contract.occ === shortOcc) ?? shortChoices[0] ?? null;

  const analysis = useMemo(() => {
    if (!long || !short) return null;
    const longLeg = {
      strike: long.strike.toFixed(2),
      expiration: long.expiration,
      premium: long.ask,
      bid: long.bid,
      ask: long.ask,
      delta: long.delta,
      gamma: long.gamma,
      theta: long.theta,
      vega: long.vega,
      iv: long.iv,
    };
    const shortLeg = {
      strike: short.strike.toFixed(2),
      expiration: short.expiration,
      premium: short.bid,
      bid: short.bid,
      ask: short.ask,
      delta: short.delta,
      gamma: short.gamma,
      theta: short.theta,
      vega: short.vega,
      iv: short.iv,
    };
    return {
      figures: analyzePmcc({ spot, asOf, long: longLeg, short: shortLeg }),
      rules: evaluatePmccRules(profile, { spot, asOf, long: longLeg, short: shortLeg }),
    };
  }, [asOf, long, profile, short, spot]);

  async function savePlan(): Promise<void> {
    if (!long || !short) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await createSavedIdea({
        underlying: 'DEMO',
        longOcc: long.occ,
        shortOcc: short.occ,
        profileId: profile.id,
        profileRevision: profile.revision,
        quoteAsOf: asOf,
        notes: analysis
          ? `Simulated plan. Net debit ${analysis.figures.netDebit}. ${analysis.rules.summary}`
          : 'Simulated plan.',
      });
      setIdeas((current) => [saved, ...current]);
      setNotice('Saved as a planned PMCC. This is research only and does not submit an order.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'The plan could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 4 }}>
        <CircularProgress size={22} />
        <Typography>Loading the simulated chain.</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5} data-testid="pmcc-builder">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between' }}>
        <div>
          <Typography variant="h4" component="h1">PMCC Builder</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            Pair a long LEAPS call with a shorter call on the fictional DEMO chain. Spot {spot}. Nothing on this page places an order.
          </Typography>
        </div>
        <DemoChip />
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={2}>
          <TextField select label="Ticker" value="DEMO" fullWidth>
            <MenuItem value="DEMO">DEMO · simulated spot {spot}</MenuItem>
          </TextField>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField select label="Long LEAPS" value={long?.occ ?? ''} onChange={(event) => setLongOcc(event.target.value)} fullWidth>
              {contracts.filter((contract) => contract.daysToExpiration >= 180).map((contract) => (
                <MenuItem key={contract.occ} value={contract.occ}>{label(contract)}</MenuItem>
              ))}
            </TextField>
            <TextField select label="Short call" value={short?.occ ?? ''} onChange={(event) => setShortOcc(event.target.value)} fullWidth>
              {shortChoices.map((contract) => (
                <MenuItem key={contract.occ} value={contract.occ}>{label(contract)}</MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>
      </Paper>
      {analysis && long && short ? (
        <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
            <Typography variant="h6">Research figures</Typography>
            <Chip size="small" color={analysis.rules.passes ? 'success' : 'warning'} label={analysis.rules.passes ? 'Passes saved rules' : 'Does not pass saved rules'} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{analysis.rules.summary} Profile: {profile.name}, revision {profile.revision}.</Typography>
          <BoxMetrics
            rows={[
              ['Net debit', money(analysis.figures.netDebit)],
              ['Max profit', analysis.figures.maxProfit == null ? 'Not a conventional PMCC' : money(analysis.figures.maxProfit)],
              ['Max loss', money(analysis.figures.maxLoss)],
              ['Breakeven', money(analysis.figures.breakeven)],
              ['Long intrinsic / extrinsic', `${money(analysis.figures.longIntrinsic)} / ${money(analysis.figures.longExtrinsic)}`],
              ['Short intrinsic / extrinsic', `${money(analysis.figures.shortIntrinsic)} / ${money(analysis.figures.shortExtrinsic)}`],
              ['Days to expiration', `${analysis.figures.longDays ?? '—'} long · ${analysis.figures.shortDays ?? '—'} short`],
            ]}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{analysis.figures.structureNote}</Typography>
          <Button sx={{ mt: 2 }} variant="contained" disabled={busy || !analysis.figures.structureOk} onClick={() => void savePlan()}>
            Save planned PMCC
          </Button>
          {notice ? <Alert sx={{ mt: 2 }} severity={notice.startsWith('Saved') ? 'success' : 'warning'}>{notice}</Alert> : null}
        </Paper>
      ) : null}
      <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
        <Typography variant="h6">Saved plans</Typography>
        {ideas.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No planned PMCC yet.</Typography> : (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {ideas.map((idea) => (
              <Typography key={idea.id} variant="body2">{idea.underlying} · {idea.longOcc.trim()} / {idea.shortOcc?.trim()} · {idea.notes}</Typography>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function BoxMetrics({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
      {rows.map(([labelText, value]) => (
        <Paper key={labelText} variant="outlined" sx={{ p: 1.5, minWidth: { xs: '100%', sm: 200 }, flex: '1 1 200px' }}>
          <Typography variant="caption" color="text.secondary">{labelText}</Typography>
          <Typography variant="body1" sx={{ fontWeight: 650 }}>{value}</Typography>
        </Paper>
      ))}
    </Stack>
  );
}

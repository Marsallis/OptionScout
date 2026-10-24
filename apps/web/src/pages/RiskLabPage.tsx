import { useEffect, useMemo, useState } from 'react';
import { netGreeks, pnlSeries, scenarioPnl, spotGrid, type DemoChainContract, type RiskLeg } from '@optionscout/shared';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { fetchDemoChain, fetchSavedIdeas, type SavedIdea } from '../api/client';
import { DemoChip } from '../components/DemoChip';
import { formatSignedUsd } from '../lib/format';
import { useAppState } from '../state/AppState';

interface ScenarioChoice {
  id: string;
  label: string;
  spot: number;
  legs: RiskLeg[];
  ivAssumed: boolean;
}

function contractLeg(contract: DemoChainContract, side: 'long' | 'short'): RiskLeg {
  return {
    side,
    strike: contract.strike,
    daysToExpiration: contract.daysToExpiration,
    entryPremium: Number(side === 'long' ? contract.ask : contract.bid),
    iv: contract.iv == null ? 0.3 : Number(contract.iv),
    delta: contract.delta == null ? null : Number(contract.delta),
    gamma: contract.gamma == null ? null : Number(contract.gamma),
    theta: contract.theta == null ? null : Number(contract.theta),
    vega: contract.vega == null ? null : Number(contract.vega),
  };
}

function Chart({ points, color }: { points: Array<{ spot: number; pnl: number }>; color: string }) {
  if (points.length < 2) return null;
  const width = 640;
  const height = 220;
  const minPnl = Math.min(...points.map((point) => point.pnl), 0);
  const maxPnl = Math.max(...points.map((point) => point.pnl), 0);
  const span = Math.max(1, maxPnl - minPnl);
  const x = (index: number) => (index / (points.length - 1)) * (width - 24) + 12;
  const y = (pnl: number) => 12 + ((maxPnl - pnl) / span) * (height - 24);
  const line = points.map((point, index) => `${x(index)},${y(point.pnl)}`).join(' ');
  const zero = y(0);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Profit and loss chart" style={{ width: '100%', height: 'auto' }}>
      <line x1="12" y1={zero} x2={width - 12} y2={zero} stroke="currentColor" strokeOpacity="0.35" />
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={line} />
    </svg>
  );
}

export function RiskLabPage() {
  const theme = useTheme();
  const { dashboard } = useAppState();
  const [choices, setChoices] = useState<ScenarioChoice[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [priceMove, setPriceMove] = useState(0);
  const [ivChange, setIvChange] = useState(0);
  const [daysPassed, setDaysPassed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDemoChain().catch(() => null), fetchSavedIdeas().catch(() => ({ ideas: [] as SavedIdea[] }))])
      .then(([chain, saved]) => {
        if (cancelled) return;
        const next: ScenarioChoice[] = [];
        if (chain) {
          for (const idea of saved.ideas) {
            if (!idea.shortOcc) continue;
            const long = chain.contracts.find((contract) => contract.occ === idea.longOcc);
            const short = chain.contracts.find((contract) => contract.occ === idea.shortOcc);
            if (!long || !short) continue;
            next.push({
              id: `idea-${idea.id}`,
              label: `Planned PMCC ${idea.underlying} ${long.strike}/${short.strike}`,
              spot: Number(chain.spot),
              legs: [contractLeg(long, 'long'), contractLeg(short, 'short')],
              ivAssumed: long.iv == null || short.iv == null,
            });
          }
        }
        for (const position of dashboard?.positions ?? []) {
          if (position.status !== 'open') continue;
          const openLegs = position.legs.filter((leg) => leg.status === 'open' && leg.optionType === 'call');
          if (openLegs.length === 0) continue;
          const watch = dashboard?.watchlist.find((item) => item.underlying === position.underlying);
          const spot = watch?.demoLast ?? openLegs[0]!.strike + (openLegs[0]!.mark ?? openLegs[0]!.openPremium);
          next.push({
            id: `position-${position.id}`,
            label: `${position.underlying} ${position.strategy.toUpperCase()} in the simulated book`,
            spot,
            ivAssumed: true,
            legs: openLegs.map((leg) => ({
              side: leg.side,
              strike: leg.strike,
              daysToExpiration: Math.max(0, leg.daysToExpiration),
              entryPremium: leg.openPremium,
              iv: 0.3,
              delta: leg.delta,
              gamma: null,
              theta: leg.theta,
              vega: null,
            })),
          });
        }
        setChoices(next);
        setSelectedId(next[0]?.id ?? '');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setNotice(reason instanceof Error ? reason.message : 'Risk scenarios did not load.');
      });
    return () => {
      cancelled = true;
    };
  }, [dashboard]);

  const choice = choices.find((item) => item.id === selectedId) ?? choices[0] ?? null;
  const maxDays = choice ? Math.max(...choice.legs.map((leg) => leg.daysToExpiration), 1) : 1;
  const movedSpot = choice ? Math.max(1, choice.spot * (1 + priceMove / 100)) : 1;
  const current = choice
    ? scenarioPnl({ spot: movedSpot, daysPassed: Math.min(daysPassed, maxDays), ivChangePercent: ivChange, legs: choice.legs })
    : 0;
  const expirationSeries = useMemo(
    () => (choice ? pnlSeries({ spots: spotGrid(choice.spot), daysPassed: maxDays, ivChangePercent: ivChange, legs: choice.legs }) : []),
    [choice, ivChange, maxDays],
  );
  const chosenSeries = useMemo(
    () => (choice ? pnlSeries({ spots: spotGrid(choice.spot), daysPassed: Math.min(daysPassed, maxDays), ivChangePercent: ivChange, legs: choice.legs }) : []),
    [choice, daysPassed, ivChange, maxDays],
  );
  const greeks = choice ? netGreeks(choice.legs) : null;

  return (
    <Stack spacing={2.5} data-testid="risk-lab">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'space-between' }}>
        <div>
          <Typography variant="h4" component="h1">Risk Lab</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            Modeled profit and loss for a simulated position or a planned PMCC. Expiration uses intrinsic value. Earlier dates use a rate-zero Black-Scholes sketch. This is not a quote and not an order.
          </Typography>
        </div>
        <DemoChip />
      </Stack>
      {notice ? <Alert severity="warning">{notice}</Alert> : null}
      {choice == null ? <Alert severity="info">Open a simulated position or save a planned PMCC to run a scenario.</Alert> : (
        <>
          <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
            <TextField select label="Scenario" value={choice.id} onChange={(event) => setSelectedId(event.target.value)} fullWidth>
              {choices.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
            </TextField>
            <Typography sx={{ mt: 2 }} variant="body2">Price move {priceMove}% · modeled spot {movedSpot.toFixed(2)} · P/L {formatSignedUsd(current)}</Typography>
            <Slider aria-label="Price move" value={priceMove} min={-50} max={50} onChange={(_event, value) => setPriceMove(value as number)} />
            <Typography variant="body2">IV change {ivChange}%</Typography>
            <Slider aria-label="IV change" value={ivChange} min={-80} max={150} onChange={(_event, value) => setIvChange(value as number)} />
            <Typography variant="body2">Days passed {Math.min(daysPassed, maxDays)} of {maxDays}</Typography>
            <Slider aria-label="Days passed" value={Math.min(daysPassed, maxDays)} min={0} max={maxDays} onChange={(_event, value) => setDaysPassed(value as number)} />
            {choice.ivAssumed ? <Typography variant="caption" color="text.secondary">Implied volatility is 30% where the simulated book did not store one.</Typography> : null}
          </Paper>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Paper sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1">At expiration</Typography>
              <Chart points={expirationSeries} color={theme.palette.primary.main} />
            </Paper>
            <Paper sx={{ p: 2, flex: 1 }}>
              <Typography variant="subtitle1">At the chosen date</Typography>
              <Chart points={chosenSeries} color={theme.palette.secondary.main} />
            </Paper>
          </Stack>
          <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
            <Typography variant="h6">Greeks summary</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Net of long minus short, from the stored simulated marks. A blank greek was not in the source.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1.5 }}>
              <Metric name="Delta" value={greeks?.delta} />
              <Metric name="Gamma" value={greeks?.gamma} />
              <Metric name="Theta" value={greeks?.theta} />
              <Metric name="Vega" value={greeks?.vega} />
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}

function Metric({ name, value }: { name: string; value: number | null | undefined }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
      <Typography variant="caption" color="text.secondary">{name}</Typography>
      <Typography variant="body1">{value == null || Number.isNaN(value) ? 'Not in the simulated book' : value.toFixed(3)}</Typography>
    </Paper>
  );
}

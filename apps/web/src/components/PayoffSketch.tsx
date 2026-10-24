import { useEffect, useState } from 'react';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { GlossaryTip } from './GlossaryTip';

function prefersStill(): boolean {
  if (import.meta.env.MODE === 'test') return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function CountUp({ value, prefix = '$' }: { value: number; prefix?: string }) {
  const still = prefersStill();
  const [shown, setShown] = useState(still ? value : 0);

  useEffect(() => {
    if (still) {
      setShown(value);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 700);
      setShown(Math.round(value * progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [still, value]);

  return (
    <span>
      {prefix}
      {shown.toLocaleString('en-US')}
    </span>
  );
}

/** A labeled teaching picture. The numbers are an example, not a quote. */
export function PayoffSketch({ strike = 100, premium = 5 }: { strike?: number; premium?: number }) {
  const theme = useTheme();
  const maxLoss = premium * 100;
  const breakeven = strike + premium;
  const spots = Array.from({ length: 21 }, (_, index) => strike - 20 + index * 3);
  const pnl = (spot: number) => Math.max(spot - strike, 0) * 100 - maxLoss;
  const values = spots.map(pnl);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(1, max - min);
  const width = 640;
  const height = 180;
  const x = (index: number) => (index / (spots.length - 1)) * (width - 24) + 12;
  const y = (amount: number) => 12 + ((max - amount) / span) * (height - 24);
  const line = values.map((amount, index) => `${x(index)},${y(amount)}`).join(' ');

  return (
    <Paper className="os-card" sx={{ p: { xs: 2, md: 2.5 } }} component="section" aria-label="Long call payoff example">
      <Typography variant="h6" component="h2">
        Risk and reward, in one sentence
      </Typography>
      <Typography variant="body1" sx={{ mt: 1, maxWidth: 760 }}>
        If you buy one call for ${premium} a share, the most you can lose is the{' '}
        <CountUp value={maxLoss} /> premium. At expiration the share price has to finish above the{' '}
        <GlossaryTip term="breakeven">breakeven</GlossaryTip> of ${breakeven} before the contract is worth more than you paid. Below the{' '}
        <GlossaryTip term="strike">strike</GlossaryTip> of ${strike}, the call expires worthless and the loss stays at that premium.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Max loss
          </Typography>
          <Typography variant="h6">
            <CountUp value={maxLoss} />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The premium you paid. It does not grow just because the stock falls.
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Breakeven at expiration
          </Typography>
          <Typography variant="h6">${breakeven}</Typography>
          <Typography variant="body2" color="text.secondary">
            Strike plus the premium per share, before fees. Selling earlier can change the result.
          </Typography>
        </Paper>
      </Stack>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Example long-call payoff chart" style={{ width: '100%', height: 'auto', marginTop: 12 }}>
        <line x1="12" y1={y(0)} x2={width - 12} y2={y(0)} stroke="currentColor" strokeOpacity="0.35" />
        <polyline className="os-line-draw" fill="none" stroke={theme.palette.primary.main} strokeWidth="2.5" points={line} />
      </svg>
      <Typography variant="caption" color="text.secondary">
        Illustration only, using a ${strike} strike and a ${premium} premium. It is not a quote and not a recommendation.
      </Typography>
    </Paper>
  );
}

import type { PlanFitSummary } from '@optionscout/shared';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

function eligibilityChipColor(
  eligibility: PlanFitSummary['eligibility'],
): 'success' | 'warning' | 'error' | 'default' {
  if (eligibility === 'eligible') return 'success';
  if (eligibility === 'cannot-verify') return 'warning';
  return 'error';
}

export type ChecklistRingSize = 'gallery' | 'list' | 'compact';

const RING_PX: Record<ChecklistRingSize, number> = {
  gallery: 92,
  list: 40,
  compact: 56,
};

const STROKE_PX: Record<ChecklistRingSize, number> = {
  gallery: 10,
  list: 5,
  compact: 7,
};

/**
 * Segmented checklist ring with resolved palette colors (SVG stroke must be concrete colors —
 * MUI theme token strings on sx.stroke often fail to paint).
 */
function SegmentedRing({
  passed,
  failed,
  notAssessed,
  variant,
}: {
  passed: number;
  failed: number;
  notAssessed: number;
  variant: ChecklistRingSize;
}) {
  const theme = useTheme();
  const size = RING_PX[variant];
  const stroke = STROKE_PX[variant];
  const total = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = variant === 'list' ? 1.5 : 3;
  const usable = circumference - gap * total;
  const segLen = usable / total;

  const passColor = theme.palette.success.main;
  const failColor = theme.palette.error.main;
  const naColor = theme.palette.mode === 'dark' ? theme.palette.grey[600] : theme.palette.grey[400];

  const colors = [
    ...Array.from({ length: passed }, () => passColor),
    ...Array.from({ length: failed }, () => failColor),
    ...Array.from({ length: notAssessed }, () => naColor),
  ].slice(0, total);
  while (colors.length < total) colors.push(naColor);

  let offset = 0;
  const aria = `Core checklist: ${passed} of 6 checks passed, ${failed} failed, ${notAssessed} not assessed. Checklist only, not an investment rating.`;

  return (
    <Box
      sx={{ position: 'relative', width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
      role="img"
      aria-label={aria}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden>
        {colors.map((color, index) => {
          const dashoffset = -offset;
          offset += segLen + gap;
          return (
            <circle
              key={`seg-${index}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              strokeDashoffset={dashoffset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <Typography
          component="span"
          sx={{
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            fontSize: variant === 'gallery' ? '1.35rem' : variant === 'list' ? '0.7rem' : '1rem',
            lineHeight: 1,
          }}
        >
          {passed}/6
        </Typography>
        {variant !== 'list' ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: variant === 'gallery' ? 11 : 10, lineHeight: 1.1, mt: 0.25 }}>
            Checks passed
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

export function PlanFitScoreBadge({
  fit,
  size = 'compact',
  showEligibility = true,
  dense = false,
}: {
  fit: PlanFitSummary;
  size?: ChecklistRingSize | number;
  showEligibility?: boolean;
  dense?: boolean;
}) {
  const { passed, failed, notAssessed } = fit.ringSegments;
  const variant: ChecklistRingSize =
    typeof size === 'number' ? (size >= 80 ? 'gallery' : size <= 44 ? 'list' : 'compact') : size;
  const theme = useTheme();

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <SegmentedRing passed={passed} failed={failed} notAssessed={notAssessed} variant={variant} />
      <Stack spacing={0.35} sx={{ minWidth: 0 }}>
        {!dense ? (
          <Typography variant="body2" sx={{ fontWeight: 650 }}>
            Core Checks: {passed}/6
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" display="block">
          Checklist only — not an investment rating
        </Typography>
        {showEligibility ? (
          <Chip
            size="small"
            label={fit.eligibilityLabel}
            color={eligibilityChipColor(fit.eligibility)}
            variant="outlined"
          />
        ) : null}
        <Typography variant="caption" color="text.secondary" display="block">
          Hard Rules: {fit.eligibilityHardPassed}/{fit.eligibilityHardTotal} · Preferences:{' '}
          {fit.prefPassed}/{fit.prefAssessed || 0} assessed
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
          <LegendDot color={theme.palette.success.main} label={`Pass ${passed}`} />
          <LegendDot color={theme.palette.error.main} label={`Fail ${failed}`} />
          <LegendDot
            color={theme.palette.mode === 'dark' ? theme.palette.grey[600] : theme.palette.grey[400]}
            label={`N/A ${notAssessed}`}
          />
        </Stack>
      </Stack>
    </Stack>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

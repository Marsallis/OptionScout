import type { PreferenceDeviation } from '@optionscout/shared';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

function statusLabel(status: PreferenceDeviation['status']): string {
  if (status === 'met') return 'Met';
  if (status === 'missed') return 'Missed';
  return 'Unassessed';
}

function formatTarget(dev: PreferenceDeviation): string {
  if (dev.target == null) return '—';
  if (dev.id === 'ideal-cost') return `$${dev.target.toLocaleString('en-US')}`;
  if (dev.id === 'intrinsic') return `${dev.target}%`;
  return String(dev.target);
}

function formatActual(dev: PreferenceDeviation): string {
  if (dev.actual == null) return '—';
  if (dev.id === 'ideal-cost') return `$${dev.actual.toLocaleString('en-US')}`;
  if (dev.id === 'intrinsic') return `${dev.actual.toFixed(2)}%`;
  if (dev.id === 'preferred-delta') return dev.actual.toFixed(4);
  return String(dev.actual);
}

/** Compact factual target-vs-actual rows (no clipped bar scales). */
export function PreferenceTargetRows({
  deviations,
  focusId,
}: {
  deviations: PreferenceDeviation[];
  /** Highlight this preference when the user sorted by a related metric. */
  focusId?: PreferenceDeviation['id'] | null;
}) {
  return (
    <Stack spacing={0.75}>
      {deviations.map((dev) => {
        const focused = focusId != null && dev.id === focusId;
        return (
          <Box
            key={dev.id}
            sx={{
              borderLeft: 3,
              borderColor:
                dev.status === 'missed' ? 'warning.main' : dev.status === 'met' ? 'success.main' : 'divider',
              pl: 1,
              bgcolor: focused ? 'action.selected' : 'transparent',
              borderRadius: 0.5,
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block">
              {dev.label} · {statusLabel(dev.status)}
              {focused ? ' · sort focus' : ''}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Preferred {formatTarget(dev)} · Actual {formatActual(dev)}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: dev.status === 'missed' ? 650 : 400,
                color: dev.status === 'missed' ? 'warning.main' : 'text.secondary',
                lineHeight: 1.35,
              }}
            >
              {dev.magnitudeLabel}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useColorMode } from '../brand/ColorMode';
import { COLORWAY_CHOICES } from '../brand/tokens';

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { colorway, setColorway } = useColorMode();
  return (
    <Stack spacing={0.75} sx={{ px: compact ? 0 : 1.5, pb: compact ? 0 : 1 }}>
      {compact ? null : (
        <Typography variant="caption" color="text.secondary" id="colorway-label">
          Colorway
        </Typography>
      )}
      <ToggleButtonGroup
        exclusive
        size="small"
        value={colorway}
        aria-labelledby={compact ? undefined : 'colorway-label'}
        aria-label="Colorway"
        onChange={(_event, next: string | null) => {
          if (next) setColorway(next as typeof colorway);
        }}
        sx={{ flexWrap: 'wrap', gap: 0.5 }}
      >
        {COLORWAY_CHOICES.map((choice) => (
          <ToggleButton key={choice.id} value={choice.id} aria-label={choice.label} sx={{ minHeight: 44, px: 1.25 }}>
            {choice.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}

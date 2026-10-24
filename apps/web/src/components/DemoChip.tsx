import Chip from '@mui/material/Chip';
import { useTheme } from '@mui/material/styles';

export function DemoChip() {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  return (
    <Chip
      label="DEMO"
      size="small"
      variant="outlined"
      sx={{
        height: 22,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: dark ? '#8EE0D6' : 'primary.dark',
        borderColor: dark ? 'rgba(45, 212, 191, 0.55)' : 'rgba(15, 118, 110, 0.45)',
        backgroundColor: dark ? 'rgba(45, 212, 191, 0.08)' : 'rgba(15, 118, 110, 0.06)',
      }}
    />
  );
}

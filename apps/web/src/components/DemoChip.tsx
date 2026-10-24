import Chip from '@mui/material/Chip';
import { useTheme } from '@mui/material/styles';

export function DemoChip() {
  const theme = useTheme();
  return (
    <Chip
      label="DEMO"
      size="small"
      variant="outlined"
      sx={{
        height: 28,
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: theme.palette.text.primary,
        borderColor: 'divider',
        backgroundColor: 'action.hover',
      }}
    />
  );
}

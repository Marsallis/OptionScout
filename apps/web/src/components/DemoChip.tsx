import Chip from '@mui/material/Chip';

export function DemoChip() {
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
        color: '#8EE0D6',
        borderColor: 'rgba(46, 196, 182, 0.55)',
        backgroundColor: 'rgba(46, 196, 182, 0.08)',
      }}
    />
  );
}

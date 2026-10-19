import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export function CompareTray({
  selectedCount,
  max = 4,
  onCompare,
  onClear,
}: {
  selectedCount: number;
  max?: number;
  onCompare: () => void;
  onClear: () => void;
}) {
  if (selectedCount <= 0) return null;
  return (
    <Paper
      elevation={6}
      sx={{
        position: 'sticky',
        bottom: 12,
        zIndex: 20,
        mt: 2,
        px: 2,
        py: 1.25,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
            {selectedCount} selected for compare
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Select up to {max} contracts. Comparison is factual only — not a buy list.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={onClear}>
            Clear
          </Button>
          <Button size="small" variant="contained" disabled={selectedCount < 2} onClick={onCompare}>
            Compare
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/** Educational boundary. Distinct from the simulated-data disclaimer. */
export function AdviceNote() {
  return (
    <Box
      role="note"
      data-testid="advice-note"
      sx={{
        px: { xs: 2, md: 3 },
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="body2" color="text.secondary">
        <Box component="strong" sx={{ color: 'text.primary', fontWeight: 700 }}>
          Educational. Not financial advice.
        </Box>{' '}
        OptionScout is educational research software. It does not place orders and it does not tell you what to buy.
      </Typography>
    </Box>
  );
}

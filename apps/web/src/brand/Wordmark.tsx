import Box from '@mui/material/Box';
import { AppMark } from './AppMark';

export function Wordmark({
  compact = false,
  researching = false,
}: {
  compact?: boolean;
  researching?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
      <AppMark size={compact ? 28 : 40} researching={researching} />
      {compact ? null : (
        <Box sx={{ minWidth: 0 }}>
          <Box
            component="div"
            sx={{
              fontFamily: 'var(--os-font-heading)',
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              color: 'text.primary',
            }}
          >
            Option
            <Box component="span" sx={{ color: 'primary.main' }}>
              Scout
            </Box>
          </Box>
          <Box
            component="div"
            sx={{
              mt: 0.5,
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'text.secondary',
              fontFamily: 'var(--os-font-body)',
            }}
          >
            DISCOVER · ANALYZE · LEARN
          </Box>
        </Box>
      )}
    </Box>
  );
}
